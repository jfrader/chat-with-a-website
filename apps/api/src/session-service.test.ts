import {
  createSessionRequestSchema,
  sessionSchema,
  sessionStreamEventSchema,
} from "@profound/contracts"
import { describe, expect, it, vi } from "vitest"
import { createApiApp } from "./app"
import { SessionPipelineError } from "./session-errors"
import { SessionEventHub } from "./session-events"
import {
  type CreateSessionResult,
  type SessionRecord,
  type SessionRepository,
  type SessionUpdate,
  UNAUTHENTICATED_WORKSPACE_ID,
} from "./session-repository"
import { SessionCapacityError, SessionService, toSessionDto } from "./session-service"

const sessionId = "11111111-1111-4111-8111-111111111111"
const attemptId = "22222222-2222-4222-8222-222222222222"
const request = createSessionRequestSchema.parse({
  url: "https://example.com/article",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
})
const fetchedHtml = `<!doctype html>
  <html>
    <head>
      <title>Source title</title>
      <meta property="og:site_name" content="Source site">
      <meta name="description" content="A source description.">
      <link rel="canonical" href="https://example.com/canonical">
    </head>
    <body>
      <article>
        <p>The source opens with a complete factual sentence about the topic.</p>
        <p>A second complete sentence provides enough context for a useful summary.</p>
        <p>The final sentence captures the consequence described by the source.</p>
      </article>
    </body>
  </html>`

class MemorySessionRepository implements SessionRepository {
  readonly records = new Map<string, SessionRecord>()
  readonly #idempotency = new Map<string, string>()

  async claimForRecovery(
    workspaceId: string,
    id: string,
    expectedAttemptId: string,
    staleAfterMs: number,
    update: SessionUpdate,
  ): Promise<SessionRecord | null> {
    const session = await this.findById(workspaceId, id)
    const now = update.updatedAt ?? new Date()
    if (
      !session ||
      session.currentAttemptId !== expectedAttemptId ||
      session.updatedAt.getTime() > now.getTime() - staleAfterMs ||
      session.status === "complete" ||
      session.status === "failed"
    ) {
      return null
    }

    const updated = { ...session, ...update }
    this.records.set(id, updated)
    return updated
  }

  async createOrGet(workspaceId: string, input: typeof request): Promise<CreateSessionResult> {
    const key = `${workspaceId}:${input.idempotencyKey}`
    const existingId = this.#idempotency.get(key)
    if (existingId) {
      const existing = this.records.get(existingId)
      if (!existing) throw new Error("Missing in-memory session")
      return { created: false, session: existing }
    }

    const timestamp = new Date("2026-08-26T00:00:00.000Z")
    const canonicalUrl = new URL(input.url).toString()
    const id =
      this.records.size === 0
        ? sessionId
        : `00000000-0000-4000-8000-${String(this.records.size).padStart(12, "0")}`
    const session: SessionRecord = {
      id,
      workspaceId,
      idempotencyKey: input.idempotencyKey,
      originalUrl: input.url,
      canonicalUrl,
      finalUrl: null,
      host: new URL(canonicalUrl).hostname,
      title: null,
      siteName: null,
      description: null,
      sourceText: "",
      sourceHash: null,
      sourceWordCount: 0,
      sourceTruncated: false,
      summary: "",
      status: "fetching",
      failureStage: null,
      failureCode: null,
      provider: null,
      model: null,
      promptVersion: null,
      currentAttemptId: attemptId,
      attemptNumber: 1,
      inputTokens: null,
      outputTokens: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }
    this.records.set(session.id, session)
    this.#idempotency.set(key, session.id)
    return { created: true, session }
  }

  async findById(workspaceId: string, id: string): Promise<SessionRecord | null> {
    const session = this.records.get(id)
    return session?.workspaceId === workspaceId ? session : null
  }

  async updateForAttempt(
    workspaceId: string,
    id: string,
    attemptId: string,
    update: SessionUpdate,
  ): Promise<SessionRecord | null> {
    const session = await this.findById(workspaceId, id)
    if (!session || session.currentAttemptId !== attemptId) return null
    const updated = { ...session, ...update }
    this.records.set(id, updated)
    return updated
  }
}

const collectEvents = async (events: AsyncIterable<unknown>) => {
  const collected = []
  for await (const event of events) collected.push(sessionStreamEventSchema.parse(event))
  return collected
}

describe("SessionService", () => {
  it("persists the complete pipeline once and replays all progress to late subscribers", async () => {
    const repository = new MemorySessionRepository()
    const fetchPage = vi.fn(async () => ({
      finalUrl: "https://example.com/redirected",
      html: fetchedHtml,
    }))
    const service = new SessionService({ repository, fetchPage })

    const first = await service.create(request)
    const second = await service.create(request)
    await service.waitForIdle(first.session.id)

    expect(first.created).toBe(true)
    expect(first.session.status).toBe("fetching")
    expect(second.created).toBe(false)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(repository.records.get(sessionId)?.workspaceId).toBe(UNAUTHENTICATED_WORKSPACE_ID)

    const completed = await service.get(sessionId)
    expect(completed).toMatchObject({
      status: "complete",
      finalUrl: "https://example.com/redirected",
      canonicalUrl: "https://example.com/canonical",
      title: "Source title",
      siteName: "Source site",
      description: "A source description.",
      provider: "local",
      model: "extractive-v1",
      failureCode: null,
      failureStage: null,
    })
    expect(completed?.summary).toContain("The source opens")
    expect(completed?.sourceWordCount).toBeGreaterThan(20)
    expect(sessionSchema.parse(completed).completedAt).not.toBeNull()

    const stream = await service.stream(sessionId)
    if (!stream) throw new Error("Expected a stream")
    const events = await collectEvents(stream.events)
    expect(events.map(({ type }) => type)).toEqual([
      "session.created",
      "stage.changed",
      "stage.changed",
      "stage.changed",
      "summary.delta",
      "session.completed",
    ])
    expect(
      events
        .filter((event) => event.type === "summary.delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe(completed?.summary)
  })

  it("persists and emits safe failures at the active stage", async () => {
    const repository = new MemorySessionRepository()
    const service = new SessionService({
      repository,
      fetchPage: async () => {
        throw new SessionPipelineError("URL_NOT_ALLOWED", {
          cause: new Error("secret network details"),
        })
      },
    })

    const created = await service.create(request)
    await service.waitForIdle(created.session.id)

    const failed = await service.get(sessionId)
    expect(failed).toMatchObject({
      status: "failed",
      failureStage: "fetching",
      failureCode: "URL_NOT_ALLOWED",
    })
    const stream = await service.stream(sessionId)
    if (!stream) throw new Error("Expected a stream")
    const events = await collectEvents(stream.events)
    const failedEvent = events.at(-1)
    expect(failedEvent?.type).toBe("session.failed")
    if (failedEvent?.type !== "session.failed") throw new Error("Expected a failure event")
    expect(failedEvent.error.code).toBe("URL_NOT_ALLOWED")
    expect(failedEvent.error.message).not.toContain("secret")
  })

  it("bounds retained event history by event and session counts", async () => {
    const repository = new MemorySessionRepository()
    const record = (await repository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)).session
    const completedRecord: SessionRecord = {
      ...record,
      status: "complete",
      summary: "A summary.",
      completedAt: new Date("2026-08-26T00:00:01.000Z"),
      updatedAt: new Date("2026-08-26T00:00:01.000Z"),
    }
    const completedDto = toSessionDto(completedRecord)
    const eventHub = new SessionEventHub({ maxEventsPerSession: 2, maxRetainedSessions: 1 })

    eventHub.publish(sessionId, {
      type: "session.created",
      attemptId,
      session: toSessionDto(record),
    })
    eventHub.publish(sessionId, { type: "stage.changed", attemptId, stage: "extracting" })
    eventHub.publish(sessionId, {
      type: "session.completed",
      attemptId,
      session: completedDto,
    })

    expect(
      (await collectEvents(eventHub.subscribe(completedRecord, completedDto))).map(
        ({ type }) => type,
      ),
    ).toEqual(["stage.changed", "session.completed"])

    const secondRecord: SessionRecord = {
      ...completedRecord,
      id: "44444444-4444-4444-8444-444444444444",
      currentAttemptId: "55555555-5555-4555-8555-555555555555",
    }
    const secondDto = toSessionDto(secondRecord)
    eventHub.publish(secondRecord.id, {
      type: "session.completed",
      attemptId: secondRecord.currentAttemptId,
      session: secondDto,
    })

    expect(
      (await collectEvents(eventHub.subscribe(completedRecord, completedDto))).map(
        ({ type }) => type,
      ),
    ).toEqual(["session.completed"])
  })

  it("closes a waiting event subscription on disconnect", async () => {
    const repository = new MemorySessionRepository()
    const record = (await repository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)).session
    const eventHub = new SessionEventHub()
    const subscription = eventHub.subscribe(record, toSessionDto(record))
    const iterator = subscription[Symbol.asyncIterator]()

    expect((await iterator.next()).value?.type).toBe("session.created")
    expect((await iterator.next()).value?.type).toBe("stage.changed")
    const waiting = iterator.next()
    subscription.close()

    await expect(waiting).resolves.toEqual({ done: true, value: undefined })
  })

  it("bounds queued events for slow subscribers", async () => {
    const repository = new MemorySessionRepository()
    const record = (await repository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)).session
    const eventHub = new SessionEventHub({ maxEventsPerSession: 2 })
    const subscription = eventHub.subscribe(record, toSessionDto(record))
    const iterator = subscription[Symbol.asyncIterator]()

    expect((await iterator.next()).value?.type).toBe("session.created")
    expect((await iterator.next()).value?.type).toBe("stage.changed")
    eventHub.publish(sessionId, { type: "summary.delta", attemptId, delta: "old" })
    eventHub.publish(sessionId, { type: "summary.delta", attemptId, delta: "new" })
    eventHub.publish(sessionId, {
      type: "session.completed",
      attemptId,
      session: toSessionDto({ ...record, status: "complete" }),
    })

    expect((await iterator.next()).value).toMatchObject({ type: "summary.delta", delta: "new" })
    expect((await iterator.next()).value?.type).toBe("session.completed")
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it("replays terminal state and restarts interrupted work after an event-hub restart", async () => {
    const repository = new MemorySessionRepository()
    const originalService = new SessionService({
      repository,
      fetchPage: async () => ({ finalUrl: request.url, html: fetchedHtml }),
    })
    const created = await originalService.create(request)
    await originalService.waitForIdle(created.session.id)

    const restartedService = new SessionService({ repository })
    const terminalStream = await restartedService.stream(sessionId)
    if (!terminalStream) throw new Error("Expected a terminal stream")
    expect((await collectEvents(terminalStream.events)).map(({ type }) => type)).toEqual([
      "session.completed",
    ])

    const currentRepository = new MemorySessionRepository()
    const interrupted = await currentRepository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)
    currentRepository.records.set(sessionId, {
      ...interrupted.session,
      canonicalUrl: "https://declared-canonical.example/other",
      status: "summarizing",
    })
    const fetchPage = vi.fn(async () => ({ finalUrl: request.url, html: fetchedHtml }))
    const currentService = new SessionService({ repository: currentRepository, fetchPage })
    const currentStream = await currentService.stream(sessionId)
    if (!currentStream) throw new Error("Expected a current-state stream")
    expect((await collectEvents(currentStream.events)).map(({ type }) => type)).toEqual([
      "session.created",
      "stage.changed",
      "stage.changed",
      "stage.changed",
      "summary.delta",
      "session.completed",
    ])
    expect(fetchPage).toHaveBeenCalledOnce()
    expect(fetchPage).toHaveBeenCalledWith(request.url)
    expect((await currentService.get(sessionId))?.attemptNumber).toBe(2)
  })

  it("does not steal a fresh attempt owned by another process", async () => {
    const repository = new MemorySessionRepository()
    await repository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)
    const fetchPage = vi.fn(async () => ({ finalUrl: request.url, html: fetchedHtml }))
    const service = new SessionService({
      repository,
      fetchPage,
      clock: () => new Date("2026-08-26T00:00:10.000Z"),
      pollIntervalMs: 1,
    })

    const stream = await service.stream(sessionId)
    if (!stream) throw new Error("Expected a current-state stream")
    const events = collectEvents(stream.events)
    setTimeout(() => {
      const current = repository.records.get(sessionId)
      if (!current) return
      repository.records.set(sessionId, {
        ...current,
        status: "complete",
        summary: "Completed by the owning process.",
        completedAt: new Date("2026-08-26T00:00:11.000Z"),
        updatedAt: new Date("2026-08-26T00:00:11.000Z"),
      })
    }, 5)

    expect((await events).map(({ type }) => type)).toEqual([
      "session.created",
      "stage.changed",
      "session.completed",
    ])
    expect(fetchPage).not.toHaveBeenCalled()
    expect((await service.get(sessionId))?.attemptNumber).toBe(1)
  })

  it("recovers persisted work when its owning process stops updating it", async () => {
    const repository = new MemorySessionRepository()
    await repository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)
    let now = new Date("2026-08-26T00:00:10.000Z")
    const fetchPage = vi.fn(async () => ({ finalUrl: request.url, html: fetchedHtml }))
    const service = new SessionService({
      repository,
      fetchPage,
      clock: () => now,
      pollIntervalMs: 1,
      recoveryRetryIntervalMs: 1,
    })

    const stream = await service.stream(sessionId)
    if (!stream) throw new Error("Expected a persisted stream")
    now = new Date("2026-08-26T00:00:31.000Z")
    await collectEvents(stream.events)
    await service.waitForIdle(sessionId)

    expect(fetchPage).toHaveBeenCalledOnce()
    expect(await service.get(sessionId)).toMatchObject({ status: "complete", attemptNumber: 2 })
  })

  it("disconnects subscribers when another attempt fences the local pipeline", async () => {
    const repository = new MemorySessionRepository()
    let resolveFetch: (page: { finalUrl: string; html: string }) => void = () => undefined
    const fetchPage = vi.fn(
      () =>
        new Promise<{ finalUrl: string; html: string }>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const service = new SessionService({ repository, fetchPage })
    const created = await service.create(request)
    const stream = await service.stream(created.session.id)
    if (!stream) throw new Error("Expected an active stream")
    const iterator = stream.events[Symbol.asyncIterator]()

    expect((await iterator.next()).value?.type).toBe("session.created")
    expect((await iterator.next()).value?.type).toBe("stage.changed")
    const current = repository.records.get(sessionId)
    if (!current) throw new Error("Expected a persisted session")
    repository.records.set(sessionId, {
      ...current,
      currentAttemptId: "66666666-6666-4666-8666-666666666666",
      attemptNumber: 2,
    })
    const waiting = iterator.next()
    resolveFetch({ finalUrl: request.url, html: fetchedHtml })
    await service.waitForIdle(sessionId)

    await expect(waiting).resolves.toEqual({ done: true, value: undefined })
  })

  it("rejects new work when the process pipeline capacity is exhausted", async () => {
    const repository = new MemorySessionRepository()
    let resolveFetch: (page: { finalUrl: string; html: string }) => void = () => undefined
    const service = new SessionService({
      repository,
      maxConcurrentPipelines: 1,
      fetchPage: () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    })
    const created = await service.create(request)
    const secondRequest = createSessionRequestSchema.parse({
      ...request,
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    })

    await expect(service.create(secondRequest)).rejects.toBeInstanceOf(SessionCapacityError)
    resolveFetch({ finalUrl: request.url, html: fetchedHtml })
    await service.waitForIdle(created.session.id)
  })

  it("starts every pipeline admitted concurrently up to capacity", async () => {
    const repository = new MemorySessionRepository()
    const pendingFetches: Array<(page: { finalUrl: string; html: string }) => void> = []
    const fetchPage = vi.fn(
      () =>
        new Promise<{ finalUrl: string; html: string }>((resolve) => {
          pendingFetches.push(resolve)
        }),
    )
    const service = new SessionService({
      repository,
      maxConcurrentPipelines: 8,
      fetchPage,
    })
    const requests = Array.from({ length: 8 }, (_value, index) =>
      createSessionRequestSchema.parse({
        url: `https://example.com/article-${index}`,
        idempotencyKey: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      }),
    )

    const created = await Promise.all(requests.map((input) => service.create(input)))

    expect(fetchPage).toHaveBeenCalledTimes(8)
    for (const resolve of pendingFetches) resolve({ finalUrl: request.url, html: fetchedHtml })
    await service.waitForAll()
    const completed = await Promise.all(created.map(({ session }) => service.get(session.id)))
    expect(completed).toHaveLength(8)
    expect(completed.every((session) => session?.status === "complete")).toBe(true)
  })

  it("bounds active streams and rejects stream registration during shutdown", async () => {
    const repository = new MemorySessionRepository()
    const created = await repository.createOrGet(UNAUTHENTICATED_WORKSPACE_ID, request)
    repository.records.set(sessionId, {
      ...created.session,
      status: "complete",
      completedAt: new Date("2026-08-26T00:00:01.000Z"),
    })
    const service = new SessionService({ repository, maxConcurrentStreams: 1 })
    const first = await service.stream(sessionId)
    if (!first) throw new Error("Expected a terminal stream")

    await expect(service.stream(sessionId)).rejects.toBeInstanceOf(SessionCapacityError)
    service.closeStreams()
    await expect(first.events[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
    await expect(service.stream(sessionId)).rejects.toBeInstanceOf(SessionCapacityError)
  })

  it("serves completion replay through POST, GET, and SSE without a database", async () => {
    const repository = new MemorySessionRepository()
    const service = new SessionService({
      repository,
      fetchPage: async () => ({ finalUrl: request.url, html: fetchedHtml }),
    })
    const app = createApiApp({ sessionService: service })
    const post = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
    const accepted = sessionSchema.parse(await post.json())
    await service.waitForIdle(accepted.id)

    const get = await app.request(`/api/sessions/${accepted.id}`)
    const stream = await app.request(`/api/sessions/${accepted.id}/stream`)
    const streamBody = await stream.text()

    expect(post.status).toBe(202)
    expect(get.status).toBe(200)
    expect(sessionSchema.parse(await get.json()).status).toBe("complete")
    expect(stream.headers.get("content-type")).toContain("text/event-stream")
    expect(streamBody).toContain("event: stage.changed")
    expect(streamBody).toContain("event: summary.delta")
    expect(streamBody).toContain("event: session.completed")
  })
})
