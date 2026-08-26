import { randomUUID } from "node:crypto"
import {
  type CreateSessionRequest,
  type SessionDto,
  sessionSchema,
  type SessionStage,
  type SessionStreamEvent,
  sessionStreamEventSchema,
} from "@profound/contracts"
import { extractReadableContent, splitSummaryDeltas, summarizeExtractively } from "./content"
import { fetchPublicPage, type FetchedPage } from "./secure-fetch"
import { createApiError, asPipelineFailure } from "./session-errors"
import {
  createSessionSnapshotEvents,
  SessionEventHub,
  type SessionEventSubscription,
} from "./session-events"
import {
  type SessionRecord,
  type SessionRepository,
  type SessionUpdate,
  UNAUTHENTICATED_WORKSPACE_ID,
} from "./session-repository"

export type SessionCreation = {
  created: boolean
  session: SessionDto
}

export type SessionEventStream = {
  close(): void
  events: AsyncIterable<SessionStreamEvent>
  session: SessionDto
}

export type SessionServiceApi = {
  create(request: CreateSessionRequest): Promise<SessionCreation>
  get(id: string): Promise<SessionDto | null>
  stream(id: string): Promise<SessionEventStream | null>
}

export type SessionServiceOptions = {
  clock?: () => Date
  eventHub?: SessionEventHub
  fetchPage?: (url: string) => Promise<FetchedPage>
  maxConcurrentPipelines?: number
  maxConcurrentStreams?: number
  pollIntervalMs?: number
  recoveryRetryIntervalMs?: number
  repository: SessionRepository
}

export const toSessionDto = (session: SessionRecord): SessionDto =>
  sessionSchema.parse({
    id: session.id,
    originalUrl: session.originalUrl,
    canonicalUrl: session.canonicalUrl,
    finalUrl: session.finalUrl,
    host: session.host,
    title: session.title,
    siteName: session.siteName,
    description: session.description,
    summary: session.summary,
    status: session.status,
    failureStage: session.failureStage,
    failureCode: session.failureCode,
    sourceWordCount: session.sourceWordCount,
    sourceTruncated: session.sourceTruncated,
    provider: session.provider,
    model: session.model,
    attemptId: session.currentAttemptId,
    attemptNumber: session.attemptNumber,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  })

const recoveryStaleMs = 30_000
const defaultMaxConcurrentPipelines = 8
const defaultMaxConcurrentStreams = 64
const defaultPollIntervalMs = 500
const defaultRecoveryRetryIntervalMs = recoveryStaleMs / 2

type PipelineOwnership = {
  followPersisted: boolean
  owned: boolean
  session: SessionRecord
}

class AttemptSupersededError extends Error {}

export class SessionCapacityError extends Error {
  constructor() {
    super("The session pipeline is at capacity")
    this.name = "SessionCapacityError"
  }
}

export class SessionService implements SessionServiceApi {
  readonly #clock: () => Date
  readonly #eventHub: SessionEventHub
  readonly #fetchPage: (url: string) => Promise<FetchedPage>
  readonly #maxConcurrentPipelines: number
  readonly #maxConcurrentStreams: number
  readonly #pollIntervalMs: number
  readonly #recoveryRetryIntervalMs: number
  readonly #repository: SessionRepository
  readonly #activeStreams = new Set<() => void>()
  readonly #running = new Map<string, Promise<void>>()
  readonly #starting = new Map<string, Promise<PipelineOwnership>>()
  #acceptingStreams = true
  #admissions = 0
  #streamAdmissions = 0

  constructor(options: SessionServiceOptions) {
    this.#clock = options.clock ?? (() => new Date())
    this.#eventHub = options.eventHub ?? new SessionEventHub()
    this.#fetchPage = options.fetchPage ?? fetchPublicPage
    this.#maxConcurrentPipelines = Math.max(
      1,
      options.maxConcurrentPipelines ?? defaultMaxConcurrentPipelines,
    )
    this.#maxConcurrentStreams = Math.max(
      1,
      options.maxConcurrentStreams ?? defaultMaxConcurrentStreams,
    )
    this.#pollIntervalMs = Math.max(1, options.pollIntervalMs ?? defaultPollIntervalMs)
    this.#recoveryRetryIntervalMs = Math.max(
      1,
      options.recoveryRetryIntervalMs ?? defaultRecoveryRetryIntervalMs,
    )
    this.#repository = options.repository
  }

  async create(request: CreateSessionRequest): Promise<SessionCreation> {
    if (!this.#hasPipelineCapacity()) throw new SessionCapacityError()

    this.#admissions += 1
    try {
      const result = await this.#repository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)
      const { session } = await this.#ensureRunning(result.session, !result.created, true)
      return { created: result.created, session: toSessionDto(session) }
    } finally {
      this.#admissions -= 1
    }
  }

  async get(id: string): Promise<SessionDto | null> {
    const session = await this.#repository.findById(UNAUTHENTICATED_WORKSPACE_ID, id)
    return session ? toSessionDto(session) : null
  }

  async stream(id: string): Promise<SessionEventStream | null> {
    if (
      !this.#acceptingStreams ||
      this.#activeStreams.size + this.#streamAdmissions >= this.#maxConcurrentStreams
    ) {
      throw new SessionCapacityError()
    }

    this.#streamAdmissions += 1
    try {
      const persistedSession = await this.#repository.findById(UNAUTHENTICATED_WORKSPACE_ID, id)
      if (!persistedSession) return null
      if (!this.#acceptingStreams) throw new SessionCapacityError()

      const { followPersisted, owned, session } = await this.#ensureRunning(persistedSession, true)
      if (!this.#acceptingStreams) throw new SessionCapacityError()

      const dto = toSessionDto(session)
      const terminal = session.status === "complete" || session.status === "failed"
      const events = followPersisted
        ? this.#subscribeToPersistedSession(session)
        : this.#eventHub.subscribe(session, dto, owned && !terminal)
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        events.close()
        this.#activeStreams.delete(close)
      }
      this.#activeStreams.add(close)
      return { session: dto, events, close }
    } finally {
      this.#streamAdmissions -= 1
    }
  }

  async waitForIdle(id: string): Promise<void> {
    await this.#starting.get(id)
    await this.#running.get(id)
  }

  async waitForAll(): Promise<void> {
    while (this.#starting.size > 0 || this.#running.size > 0) {
      await Promise.allSettled([...this.#starting.values(), ...this.#running.values()])
    }
  }

  closeStreams(): void {
    this.#acceptingStreams = false
    for (const close of [...this.#activeStreams]) close()
  }

  #hasPipelineCapacity(): boolean {
    const activeSessionIds = new Set([...this.#running.keys(), ...this.#starting.keys()])
    return activeSessionIds.size + this.#admissions < this.#maxConcurrentPipelines
  }

  #subscribeToPersistedSession(initialSession: SessionRecord): SessionEventSubscription {
    let closed = false
    let wake: (() => void) | null = null
    const close = () => {
      closed = true
      wake?.()
      wake = null
    }
    const waitForPoll = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timeout)
          wake = null
          resolve()
        }
        const timeout = setTimeout(finish, this.#pollIntervalMs)
        wake = finish
      })
    const repository = this.#repository
    const service = this

    return {
      close,
      async *[Symbol.asyncIterator]() {
        let session = initialSession
        let lastRecoveryAttempt = Date.now()

        try {
          for (const event of createSessionSnapshotEvents(session, toSessionDto(session))) {
            if (closed) return
            yield event
          }

          while (!closed && session.status !== "complete" && session.status !== "failed") {
            await waitForPoll()
            if (closed) return

            let latest = await repository.findById(UNAUTHENTICATED_WORKSPACE_ID, session.id)
            if (!latest) return
            if (Date.now() - lastRecoveryAttempt >= service.#recoveryRetryIntervalMs) {
              lastRecoveryAttempt = Date.now()
              const ownership = await service.#ensureRunning(latest, true)
              if (ownership.owned) return
              latest = ownership.session
            }
            const unchanged =
              latest.currentAttemptId === session.currentAttemptId &&
              latest.status === session.status &&
              latest.updatedAt.getTime() === session.updatedAt.getTime()
            if (unchanged) continue

            session = latest
            for (const event of createSessionSnapshotEvents(session, toSessionDto(session))) {
              if (closed) return
              yield event
            }
          }
        } finally {
          close()
        }
      },
    }
  }

  async #ensureRunning(
    session: SessionRecord,
    restart: boolean,
    admitted = false,
  ): Promise<PipelineOwnership> {
    if (session.status === "complete" || session.status === "failed") {
      return { followPersisted: false, owned: false, session }
    }

    const starting = this.#starting.get(session.id)
    if (starting) return starting
    if (this.#running.has(session.id)) return { followPersisted: false, owned: true, session }
    if (!admitted && !this.#hasPipelineCapacity()) {
      return { followPersisted: true, owned: false, session }
    }

    const start = this.#startPipeline(session, restart)
    this.#starting.set(session.id, start)
    try {
      return await start
    } finally {
      this.#starting.delete(session.id)
    }
  }

  async #startPipeline(session: SessionRecord, restart: boolean): Promise<PipelineOwnership> {
    const now = this.#clock()
    const pipelineSession = restart
      ? await this.#repository.claimForRecovery(
          UNAUTHENTICATED_WORKSPACE_ID,
          session.id,
          session.currentAttemptId,
          recoveryStaleMs,
          {
            attemptNumber: session.attemptNumber + 1,
            canonicalUrl: new URL(session.originalUrl).toString(),
            completedAt: null,
            currentAttemptId: randomUUID(),
            description: null,
            failureCode: null,
            failureStage: null,
            finalUrl: null,
            inputTokens: null,
            model: null,
            outputTokens: null,
            promptVersion: null,
            provider: null,
            siteName: null,
            sourceHash: null,
            sourceText: "",
            sourceTruncated: false,
            sourceWordCount: 0,
            status: "fetching",
            summary: "",
            title: null,
            updatedAt: now,
          },
        )
      : session

    if (!pipelineSession) {
      const current = await this.#repository.findById(UNAUTHENTICATED_WORKSPACE_ID, session.id)
      return { followPersisted: true, owned: false, session: current ?? session }
    }

    this.#eventHub.reset(session.id)
    const dto = toSessionDto(pipelineSession)
    this.#publish(pipelineSession, { type: "session.created", session: dto })
    this.#publish(pipelineSession, { type: "stage.changed", stage: "fetching" })
    const processing = this.#runPipeline(pipelineSession).finally(() => {
      this.#running.delete(pipelineSession.id)
    })
    this.#running.set(pipelineSession.id, processing)
    return { followPersisted: false, owned: true, session: pipelineSession }
  }

  async #updateAttempt(session: SessionRecord, update: SessionUpdate): Promise<SessionRecord> {
    const updated = await this.#repository.updateForAttempt(
      UNAUTHENTICATED_WORKSPACE_ID,
      session.id,
      session.currentAttemptId,
      update,
    )
    if (!updated) throw new AttemptSupersededError()
    return updated
  }

  #publish(
    session: SessionRecord,
    event:
      | { type: "session.created" | "session.completed"; session: SessionDto }
      | { type: "session.failed"; session: SessionDto; error: ReturnType<typeof createApiError> }
      | { type: "stage.changed"; stage: SessionStage }
      | { type: "summary.delta"; delta: string },
  ): void {
    this.#eventHub.publish(
      session.id,
      sessionStreamEventSchema.parse({ ...event, attemptId: session.currentAttemptId }),
    )
  }

  async #runPipeline(initialSession: SessionRecord): Promise<void> {
    let session = initialSession
    let stage: SessionStage = "fetching"

    try {
      const fetched = await this.#fetchPage(session.canonicalUrl)
      stage = "extracting"
      session = await this.#updateAttempt(session, {
        finalUrl: fetched.finalUrl,
        status: "extracting",
        updatedAt: this.#clock(),
      })
      this.#publish(session, { type: "stage.changed", stage })

      const extracted = extractReadableContent(fetched.html, fetched.finalUrl)
      stage = "summarizing"
      session = await this.#updateAttempt(session, {
        ...extracted,
        status: "summarizing",
        summary: "",
        provider: "local",
        model: "extractive-v1",
        promptVersion: "extractive-v1",
        updatedAt: this.#clock(),
      })
      this.#publish(session, { type: "stage.changed", stage })

      const summary = summarizeExtractively(extracted.sourceText)
      let accumulatedSummary = ""
      for (const delta of splitSummaryDeltas(summary)) {
        accumulatedSummary += delta
        session = await this.#updateAttempt(session, {
          summary: accumulatedSummary,
          updatedAt: this.#clock(),
        })
        this.#publish(session, { type: "summary.delta", delta })
      }

      session = await this.#updateAttempt(session, {
        status: "complete",
        completedAt: this.#clock(),
        updatedAt: this.#clock(),
      })
      this.#publish(session, { type: "session.completed", session: toSessionDto(session) })
    } catch (error) {
      if (error instanceof AttemptSupersededError) {
        this.#eventHub.disconnect(session.id)
        return
      }
      const failure = asPipelineFailure(error, stage)
      try {
        const failedSession = await this.#repository.updateForAttempt(
          UNAUTHENTICATED_WORKSPACE_ID,
          session.id,
          session.currentAttemptId,
          {
            status: "failed",
            failureStage: failure.stage,
            failureCode: failure.code,
            completedAt: this.#clock(),
            updatedAt: this.#clock(),
          },
        )
        if (!failedSession) {
          this.#eventHub.disconnect(session.id)
          return
        }
        this.#publish(failedSession, {
          type: "session.failed",
          session: toSessionDto(failedSession),
          error: createApiError(failure.code),
        })
      } catch (persistenceError) {
        this.#eventHub.disconnect(session.id)
        console.error("Failed to persist session pipeline failure", persistenceError)
      }
    }
  }
}
