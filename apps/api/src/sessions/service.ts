import {
  type ChatStreamEvent,
  type CreateChatRequest,
  type CreateSessionRequest,
  chatStreamEventSchema,
  type ListSessionsQuery,
  type ListSessionsResponse,
  type MessageDto,
  messageSchema,
  type SessionDto,
  type SessionStage,
  type SessionStreamEvent,
  sessionSchema,
  sessionStreamEventSchema,
} from "@profound/contracts"
import { asPipelineFailure, createApiError, ServiceError, SessionPipelineError } from "../errors"
import type { Llm, LlmMessage } from "../llm/client"
import { LlmError } from "../llm/client"
import {
  CHAT_SYSTEM_PROMPT,
  COMPLETION_EXTRAS_SYSTEM_PROMPT,
  METADATA_SUMMARY_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from "../llm/prompts"
import { extractReadableContent } from "../webpage/content"
import { type FetchedPage, fetchPublicPage, type SecureFetchOptions } from "../webpage/secure-fetch"
import { ChatEventHub, type ChatEventStream } from "./chat-event-hub"
import { SessionEventHub } from "./events"
import { KeyedSerialExecutor } from "./keyed-serial-executor"
import type { MessageRecord, SessionRecord, SessionRepository, SessionUpdate } from "./repository"

const SUMMARY_PROMPT_VERSION = "summary-v2"
const MAX_RECENT_MESSAGES = 12
const MAX_CONVERSATION_CHARACTERS = 24_000
const MAX_SUMMARY_OUTPUT_TOKENS = 1_800
const MAX_CHAT_OUTPUT_TOKENS = 800
const CHAT_LINKED_PAGE_MAX_CHARACTERS = 8_000

export function findLinkedUrl(content: string, baseUrl: string): string | null {
  const absolute = content.match(/https?:\/\/[^\s)>"'\]]+/i)
  if (absolute) return absolute[0]
  const path = content.match(/(?:^|\s)(\/[\w~-][\w./~-]*)/)
  if (!path?.[1]) return null
  try {
    return new URL(path[1], baseUrl).toString()
  } catch {
    return null
  }
}

export type { ChatEventStream } from "./chat-event-hub"

export type SessionCreation = { created: boolean; session: SessionDto }
export type SessionEventStream = { close(): void; events: AsyncIterable<SessionStreamEvent> }

export type SessionServiceApi = {
  chat(workspaceId: string, id: string, request: CreateChatRequest): Promise<ChatEventStream | null>
  create(workspaceId: string, request: CreateSessionRequest): Promise<SessionCreation>
  delete(workspaceId: string, id: string): Promise<boolean>
  get(workspaceId: string, id: string): Promise<SessionDto | null>
  initialize(): Promise<void>
  list(workspaceId: string, query: ListSessionsQuery): Promise<ListSessionsResponse>
  messages(workspaceId: string, id: string): Promise<MessageDto[] | null>
  regenerate(workspaceId: string, id: string): Promise<SessionDto | null>
  stream(workspaceId: string, id: string): Promise<SessionEventStream | null>
}

export type SessionServiceOptions = {
  eventHub?: SessionEventHub
  fetchPage?: (url: string, options?: SecureFetchOptions) => Promise<FetchedPage>
  llm: Llm
  maxConcurrentGenerations?: number
  partialWriteIntervalMs?: number
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
    tagline: session.tagline,
    suggestedPrompts: session.suggestedPrompts,
    status: session.status,
    failureStage: session.failureStage,
    failureCode: session.failureCode,
    sourceWordCount: session.sourceWordCount,
    sourceTruncated: session.sourceTruncated,
    provider: session.provider,
    model: session.model,
    attemptId: session.currentAttemptId,
    attemptNumber: session.attemptNumber,
    generationVersion: session.generationVersion,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  })

export const toMessageDto = (message: MessageRecord): MessageDto =>
  messageSchema.parse({
    id: message.id,
    sessionId: message.sessionId,
    requestId: message.requestId,
    role: message.role,
    content: message.content,
    reasoningContent: message.reasoningContent,
    reasoningMs: message.reasoningMs,
    status: message.status,
    failureCode: message.failureCode,
    provider: message.provider,
    model: message.model,
    attemptId: message.currentAttemptId,
    attemptNumber: message.attemptNumber,
    inputTokens: message.inputTokens,
    outputTokens: message.outputTokens,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    completedAt: message.completedAt?.toISOString() ?? null,
  })

const summaryEvent = (session: SessionRecord): SessionStreamEvent => {
  const dto = toSessionDto(session)
  const base = {
    eventId: `${session.generationVersion}:${session.summary.length}:${session.status}`,
    offset: session.summary.length,
    session: dto,
    version: session.generationVersion,
  }
  if (session.status === "complete") {
    return sessionStreamEventSchema.parse({ ...base, type: "summary.completed" })
  }
  if (session.status === "failed") {
    return sessionStreamEventSchema.parse({
      ...base,
      type: "summary.failed",
      error: createApiError(session.failureCode ?? "INTERNAL_ERROR"),
    })
  }
  return sessionStreamEventSchema.parse({ ...base, type: "summary.snapshot" })
}

const generationCode = (error: unknown) => {
  if (error instanceof LlmError) return error.code
  if (error instanceof SessionPipelineError || error instanceof ServiceError) return error.code
  return "INTERNAL_ERROR" as const
}

const completeChatHistory = (messages: MessageRecord[], currentRequestId: string): LlmMessage[] => {
  const pairs = new Map<string, { assistant?: MessageRecord; user?: MessageRecord }>()
  for (const message of messages) {
    if (message.requestId === currentRequestId) continue
    const pair = pairs.get(message.requestId) ?? {}
    if (message.role === "user") pair.user = message
    else pair.assistant = message
    pairs.set(message.requestId, pair)
  }

  const completePairs = [...pairs.values()]
    .filter(
      (pair): pair is { assistant: MessageRecord; user: MessageRecord } =>
        pair.user?.status === "complete" && pair.assistant?.status === "complete",
    )
    .slice(-Math.floor(MAX_RECENT_MESSAGES / 2))
  const recent: LlmMessage[] = []
  let conversationCharacters = 0
  for (const pair of completePairs.reverse()) {
    const pairCharacters = pair.user.content.length + pair.assistant.content.length
    if (conversationCharacters + pairCharacters > MAX_CONVERSATION_CHARACTERS) break
    conversationCharacters += pairCharacters
    recent.unshift(
      { role: "user", content: pair.user.content },
      { role: "assistant", content: pair.assistant.content },
    )
  }
  return recent
}

export class SessionService implements SessionServiceApi {
  #acceptingWork = true
  readonly #chatHub = new ChatEventHub()
  readonly #controllers = new Map<string, Set<AbortController>>()
  readonly #createOperations = new KeyedSerialExecutor()
  readonly #eventHub: SessionEventHub
  readonly #fetchPage: NonNullable<SessionServiceOptions["fetchPage"]>
  readonly #llm: Llm
  readonly #maxConcurrentGenerations: number
  readonly #partialWriteIntervalMs: number
  readonly #repository: SessionRepository
  readonly #running = new Map<string, Promise<void>>()
  readonly #sessionOperations = new KeyedSerialExecutor()
  readonly #activeStreams = new Set<() => void>()

  constructor(options: SessionServiceOptions) {
    this.#eventHub = options.eventHub ?? new SessionEventHub()
    this.#fetchPage = options.fetchPage ?? fetchPublicPage
    this.#llm = options.llm
    this.#maxConcurrentGenerations = Math.max(1, options.maxConcurrentGenerations ?? 4)
    this.#partialWriteIntervalMs = Math.max(0, options.partialWriteIntervalMs ?? 150)
    this.#repository = options.repository
  }

  async initialize(): Promise<void> {
    await this.#repository.reconcileInterrupted()
  }

  async create(workspaceId: string, request: CreateSessionRequest): Promise<SessionCreation> {
    this.#assertAcceptingWork()
    return this.#createOperations.run(`${workspaceId}:${request.idempotencyKey}`, async () => {
      const result = await this.#repository.createOrGet(workspaceId, request)
      return this.#sessionOperations.run(result.session.id, async () => {
        if (!this.#acceptingWork) {
          if (result.created) {
            await this.#repository.delete(workspaceId, result.session.id)
            this.#eventHub.clear(result.session.id)
          }
          throw new ServiceError("GENERATION_INTERRUPTED")
        }

        const current = await this.#repository.findById(workspaceId, result.session.id)
        if (!current) throw new ServiceError("GENERATION_INTERRUPTED")
        if (!this.#acceptingWork) {
          if (result.created) {
            await this.#repository.delete(workspaceId, current.id)
            this.#eventHub.clear(current.id)
          }
          throw new ServiceError("GENERATION_INTERRUPTED")
        }
        if (result.created && !this.#startSummary(current)) {
          const deleted = await this.#repository.delete(workspaceId, current.id)
          this.#eventHub.clear(current.id)
          if (!deleted) throw new Error("Failed to remove an unadmitted session")
          throw new ServiceError("RATE_LIMITED")
        }
        return { created: result.created, session: toSessionDto(current) }
      })
    })
  }

  async get(workspaceId: string, id: string): Promise<SessionDto | null> {
    const session = await this.#repository.findById(workspaceId, id)
    return session ? toSessionDto(session) : null
  }

  async regenerate(workspaceId: string, id: string): Promise<SessionDto | null> {
    this.#assertAcceptingWork()
    return this.#sessionOperations.run(id, async () => {
      const current = await this.#repository.findById(workspaceId, id)
      if (!current) return null
      if (current.status !== "complete" && current.status !== "failed") {
        return toSessionDto(current)
      }
      const reset = await this.#updateSession(id, {
        status: "fetching",
        summary: "",
        tagline: null,
        suggestedPrompts: [],
        failureCode: null,
        failureStage: null,
        completedAt: null,
        attemptNumber: current.attemptNumber + 1,
        currentAttemptId: crypto.randomUUID(),
      })
      if (!this.#startSummary(reset)) {
        await this.#repository.update(id, {
          status: current.status,
          summary: current.summary,
          tagline: current.tagline,
          suggestedPrompts: current.suggestedPrompts,
          failureCode: current.failureCode,
          failureStage: current.failureStage,
          completedAt: current.completedAt,
          attemptNumber: current.attemptNumber,
        })
        throw new ServiceError("RATE_LIMITED")
      }
      return toSessionDto(reset)
    })
  }

  async list(workspaceId: string, query: ListSessionsQuery): Promise<ListSessionsResponse> {
    const page = await this.#repository.list(workspaceId, query)
    return { nextCursor: page.nextCursor, sessions: page.sessions.map(toSessionDto) }
  }

  async messages(workspaceId: string, id: string): Promise<MessageDto[] | null> {
    if (!(await this.#repository.findById(workspaceId, id))) return null
    return (await this.#repository.listMessages(id)).map(toMessageDto)
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.#sessionOperations.run(id, async () => {
      if (!(await this.#repository.findById(workspaceId, id))) return false
      for (const controller of this.#controllers.get(id) ?? []) controller.abort()
      this.#controllers.delete(id)
      const messageIds = (await this.#repository.listMessages(id)).map(
        ({ id: messageId }) => messageId,
      )
      const deleted = await this.#repository.delete(workspaceId, id)
      if (deleted) {
        this.#eventHub.clear(id)
        for (const messageId of messageIds) this.#chatHub.clear(messageId)
      }
      return deleted
    })
  }

  async stream(workspaceId: string, id: string): Promise<SessionEventStream | null> {
    this.#assertAcceptingWork()
    const persisted = await this.#repository.findById(workspaceId, id)
    this.#assertAcceptingWork()
    if (!persisted) return null
    const subscription = this.#eventHub.subscribe(
      id,
      summaryEvent(persisted),
      this.#running.has(id),
    )
    const latest = await this.#repository.findById(workspaceId, id)
    if (!this.#acceptingWork) {
      subscription.close()
      this.#assertAcceptingWork()
    }
    if (latest && (latest.status === "complete" || latest.status === "failed")) {
      const terminal = summaryEvent(latest)
      this.#eventHub.publish(id, terminal)
      subscription.close()
      const terminalSubscription = this.#eventHub.subscribe(id, terminal, false)
      return this.#trackStream({
        close: terminalSubscription.close,
        events: terminalSubscription,
      })
    }
    return this.#trackStream({ close: subscription.close, events: subscription })
  }

  async chat(
    workspaceId: string,
    id: string,
    request: CreateChatRequest,
  ): Promise<ChatEventStream | null> {
    this.#assertAcceptingWork()
    return this.#sessionOperations.run(id, async () => {
      this.#assertAcceptingWork()
      const session = await this.#repository.findById(workspaceId, id)
      this.#assertAcceptingWork()
      if (!session) return null
      if (session.status !== "complete") throw new ServiceError("GENERATION_INTERRUPTED")

      const pair = await this.#repository.createMessages(
        id,
        request.idempotencyKey,
        request.content,
      )
      const assistantId = pair.assistantMessage.id
      if (!this.#acceptingWork) {
        if (pair.created) {
          await this.#repository.updateMessage(assistantId, {
            status: "failed",
            failureCode: "GENERATION_INTERRUPTED",
            completedAt: new Date(),
          })
        }
        this.#assertAcceptingWork()
      }
      if (pair.created) {
        if (this.#running.size >= this.#maxConcurrentGenerations) {
          const failed = await this.#repository.updateMessage(assistantId, {
            status: "failed",
            failureCode: "RATE_LIMITED",
            completedAt: new Date(),
          })
          if (!failed) throw new Error("Failed to persist chat rate limit")
          this.#assertAcceptingWork()
          return this.#trackStream(
            this.#chatHub.subscribe(assistantId, this.#chatFailedEvent(failed), false),
          )
        }
        const subscription = this.#chatHub.subscribe(
          assistantId,
          this.#chatInitialEvent(pair.userMessage, pair.assistantMessage),
          true,
        )
        if (!this.#startChat(session, pair.userMessage, pair.assistantMessage)) {
          subscription.close()
          throw new Error("Chat admission changed before generation started")
        }
        return this.#trackStream(subscription)
      }

      const messages = await this.#repository.listMessages(id)
      this.#assertAcceptingWork()
      let current = messages.find((message) => message.id === assistantId) ?? pair.assistantMessage
      const running = this.#running.has(`chat:${assistantId}`)
      if (!running && current.status === "streaming") {
        const refreshed = await this.#repository.listMessages(id)
        this.#assertAcceptingWork()
        current = refreshed.find((message) => message.id === assistantId) ?? current
      }
      const initial = this.#chatInitialEvent(pair.userMessage, current)
      const subscription = this.#chatHub.subscribe(assistantId, initial, running)
      if (running) {
        const refreshed = await this.#repository.listMessages(id)
        this.#assertAcceptingWork()
        const latest = refreshed.find((message) => message.id === assistantId)
        if (latest && (latest.status === "complete" || latest.status === "failed")) {
          this.#chatHub.publish(assistantId, this.#chatInitialEvent(pair.userMessage, latest))
        }
      }
      return this.#trackStream(subscription)
    })
  }

  async waitForAll(): Promise<void> {
    while (this.#running.size > 0) await Promise.allSettled(this.#running.values())
  }

  closeStreams(): void {
    for (const close of [...this.#activeStreams]) close()
  }

  abortAll(): void {
    for (const controllers of this.#controllers.values()) {
      for (const controller of controllers) controller.abort()
    }
  }

  shutdown(): void {
    this.#acceptingWork = false
    this.closeStreams()
    this.abortAll()
  }

  #assertAcceptingWork(): void {
    if (!this.#acceptingWork) throw new ServiceError("GENERATION_INTERRUPTED")
  }

  #trackStream<Event, T extends { close(): void; events: AsyncIterable<Event> }>(stream: T): T {
    const originalClose = stream.close.bind(stream)
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      originalClose()
      this.#activeStreams.delete(close)
    }
    this.#activeStreams.add(close)
    return { ...stream, close }
  }

  #registerController(sessionId: string, controller: AbortController): () => void {
    const controllers = this.#controllers.get(sessionId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.#controllers.set(sessionId, controllers)
    return () => {
      controllers.delete(controller)
      if (controllers.size === 0) this.#controllers.delete(sessionId)
    }
  }

  #startSummary(session: SessionRecord): boolean {
    if (this.#running.size >= this.#maxConcurrentGenerations) return false
    const controller = new AbortController()
    const unregister = this.#registerController(session.id, controller)
    const job = Promise.resolve()
      .then(() => this.#runSummary(session, controller.signal))
      .finally(() => {
        unregister()
        this.#running.delete(session.id)
      })
    this.#running.set(session.id, job)
    this.#eventHub.publish(session.id, summaryEvent(session))
    return true
  }

  async #updateSession(id: string, update: SessionUpdate): Promise<SessionRecord> {
    const session = await this.#repository.update(id, update)
    if (!session) throw new ServiceError("SESSION_NOT_FOUND")
    return session
  }

  async #runSummary(initial: SessionRecord, signal: AbortSignal): Promise<void> {
    let session = initial
    let stage: SessionStage = "fetching"
    let accumulated = ""
    try {
      const fetched = await this.#fetchPage(session.canonicalUrl, { signal })
      if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
      stage = "extracting"
      session = await this.#updateSession(session.id, {
        finalUrl: fetched.finalUrl,
        status: "extracting",
      })
      this.#eventHub.publish(session.id, summaryEvent(session))

      const extracted = extractReadableContent(fetched.html, fetched.finalUrl)
      stage = "summarizing"
      session = await this.#updateSession(session.id, {
        canonicalUrl: extracted.canonicalUrl,
        description: extracted.description,
        generationVersion: session.generationVersion + 1,
        model: this.#llm.model,
        promptVersion: SUMMARY_PROMPT_VERSION,
        provider: this.#llm.provider,
        siteName: extracted.siteName,
        sourceText: extracted.sourceText,
        sourceTruncated: extracted.sourceTruncated,
        sourceWordCount: extracted.sourceWordCount,
        status: "summarizing",
        summary: "",
        title: extracted.title,
      })
      this.#eventHub.publish(session.id, summaryEvent(session))

      let lastWrite = Date.now()
      const stream = this.#llm.stream({
        signal,
        maxOutputTokens: MAX_SUMMARY_OUTPUT_TOKENS,
        messages: [
          {
            role: "system",
            content: extracted.metadataOnly
              ? METADATA_SUMMARY_SYSTEM_PROMPT
              : SUMMARY_SYSTEM_PROMPT,
          },
          { role: "user", content: extracted.sourceText },
        ],
      })
      for await (const streamed of stream) {
        if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
        if (streamed.type !== "content") continue
        const delta = streamed.text
        const offset = accumulated.length
        accumulated += delta
        this.#eventHub.publish(
          session.id,
          sessionStreamEventSchema.parse({
            type: "summary.delta",
            eventId: `${session.generationVersion}:${offset}:delta`,
            version: session.generationVersion,
            offset,
            delta,
            session: { ...toSessionDto(session), summary: accumulated },
          }),
        )
        if (Date.now() - lastWrite >= this.#partialWriteIntervalMs) {
          session = await this.#updateSession(session.id, { summary: accumulated })
          lastWrite = Date.now()
        }
      }
      if (!accumulated.trim()) throw new SessionPipelineError("EMPTY_CONTENT")
      const extras = await this.#generateCompletionExtras(accumulated, extracted.title, signal)
      session = await this.#updateSession(session.id, {
        status: "complete",
        summary: accumulated,
        suggestedPrompts: extras.suggestedPrompts,
        tagline: extras.tagline,
        completedAt: new Date(),
      })
      this.#eventHub.publish(session.id, summaryEvent(session))
    } catch (error) {
      const failure = asPipelineFailure(
        error instanceof LlmError ? new SessionPipelineError(error.code, { cause: error }) : error,
        stage,
      )
      try {
        const failed = await this.#repository.update(session.id, {
          status: "failed",
          summary: accumulated || session.summary,
          failureStage: failure.stage,
          failureCode: failure.code,
          completedAt: new Date(),
        })
        if (failed) this.#eventHub.publish(session.id, summaryEvent(failed))
        else this.#eventHub.clear(session.id)
      } catch (persistenceError) {
        this.#eventHub.clear(session.id)
        console.error("Failed to persist session pipeline failure", persistenceError)
      }
    }
  }

  #startChat(session: SessionRecord, user: MessageRecord, assistant: MessageRecord): boolean {
    if (this.#running.size >= this.#maxConcurrentGenerations) return false
    const controller = new AbortController()
    const unregister = this.#registerController(session.id, controller)
    const key = `chat:${assistant.id}`
    const job = Promise.resolve()
      .then(() => this.#runChat(session, user, assistant, controller.signal))
      .finally(() => {
        unregister()
        this.#running.delete(key)
      })
    this.#running.set(key, job)
    return true
  }

  #chatInitialEvent(user: MessageRecord, assistant: MessageRecord): ChatStreamEvent {
    if (assistant.status === "complete") {
      return chatStreamEventSchema.parse({
        type: "chat.completed",
        eventId: `${assistant.requestId}:${assistant.content.length}:complete`,
        requestId: assistant.requestId,
        offset: assistant.content.length,
        message: toMessageDto(assistant),
      })
    }
    if (assistant.status === "failed") return this.#chatFailedEvent(assistant)
    return chatStreamEventSchema.parse({
      type: "chat.created",
      eventId: `${assistant.requestId}:0:created`,
      requestId: assistant.requestId,
      offset: 0,
      userMessage: toMessageDto(user),
      assistantMessage: toMessageDto(assistant),
    })
  }

  #chatFailedEvent(message: MessageRecord): ChatStreamEvent {
    return chatStreamEventSchema.parse({
      type: "chat.failed",
      eventId: `${message.requestId}:${message.content.length}:failed`,
      requestId: message.requestId,
      offset: message.content.length,
      message: toMessageDto(message),
      error: createApiError(message.failureCode ?? "INTERNAL_ERROR"),
    })
  }

  async #generateCompletionExtras(
    summary: string,
    title: string | null,
    signal: AbortSignal,
  ): Promise<{ suggestedPrompts: string[]; tagline: string | null }> {
    const empty = { suggestedPrompts: [], tagline: null }
    try {
      let raw = ""
      for await (const streamed of this.#llm.stream({
        signal,
        maxOutputTokens: 260,
        messages: [
          {
            role: "system",
            content: COMPLETION_EXTRAS_SYSTEM_PROMPT,
          },
          { role: "user", content: `${title ? `Title: ${title}\n` : ""}Summary:\n${summary}` },
        ],
      })) {
        if (streamed.type === "content") raw += streamed.text
      }
      const match = raw.match(/\{[\s\S]*\}/) ?? raw.match(/\[[\s\S]*\]/)
      if (!match) return empty
      const parsed: unknown = JSON.parse(match[0])
      const cleanQuestions = (items: unknown) =>
        Array.isArray(items)
          ? items
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter((item) => item.length > 0 && item.length <= 80)
              .slice(0, 3)
          : []
      if (Array.isArray(parsed)) return { suggestedPrompts: cleanQuestions(parsed), tagline: null }
      if (typeof parsed !== "object" || parsed === null) return empty
      const shape = parsed as { tagline?: unknown; questions?: unknown }
      const tagline =
        typeof shape.tagline === "string" && shape.tagline.trim().length > 0
          ? shape.tagline.trim().slice(0, 60)
          : null
      return { suggestedPrompts: cleanQuestions(shape.questions), tagline }
    } catch {
      return empty
    }
  }

  async #loadLinkedPage(url: string, signal: AbortSignal): Promise<string> {
    try {
      const fetched = await this.#fetchPage(url, { signal })
      const extracted = extractReadableContent(fetched.html, fetched.finalUrl)
      const truncated = extracted.sourceText.length > CHAT_LINKED_PAGE_MAX_CHARACTERS
      const text = extracted.sourceText.slice(0, CHAT_LINKED_PAGE_MAX_CHARACTERS)
      const title = extracted.title ? ` (${extracted.title})` : ""
      return `Loaded page ${url}${title}:\n${text}${truncated ? "\n[content shortened]" : ""}`
    } catch (error) {
      const reason =
        error instanceof SessionPipelineError || error instanceof ServiceError
          ? error.code
          : "unreachable"
      return `The page ${url} could not be loaded (${reason}). Tell the user it could not be read.`
    }
  }

  async #runChat(
    session: SessionRecord,
    user: MessageRecord,
    initialAssistant: MessageRecord,
    signal: AbortSignal,
  ): Promise<void> {
    let assistant = initialAssistant
    let accumulated = assistant.content
    try {
      assistant =
        (await this.#repository.updateMessage(initialAssistant.id, {
          provider: this.#llm.provider,
          model: this.#llm.model,
        })) ?? initialAssistant
      accumulated = assistant.content
      this.#chatHub.publish(assistant.id, this.#chatInitialEvent(user, assistant))
      const recent = completeChatHistory(
        await this.#repository.listMessages(session.id),
        user.requestId,
      )
      const linkedUrl = findLinkedUrl(user.content, session.finalUrl ?? session.canonicalUrl)
      const loadedPage = linkedUrl ? await this.#loadLinkedPage(linkedUrl, signal) : null
      const messages: LlmMessage[] = [
        {
          role: "system",
          content: CHAT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Source:\n${session.sourceText}\n\nSummary:\n${session.summary}`,
        },
        { role: "assistant", content: "I am ready to answer questions about this webpage." },
        ...recent,
        ...(loadedPage ? [{ role: "user", content: loadedPage } as LlmMessage] : []),
        { role: "user", content: user.content },
      ]
      let lastWrite = Date.now()
      let reasoning = assistant.reasoningContent ?? ""
      let reasoningMs = assistant.reasoningMs
      let reasoningStartedAt: number | undefined
      for await (const streamed of this.#llm.stream({
        messages,
        signal,
        maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS,
      })) {
        if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
        if (streamed.type === "reasoning") {
          reasoningStartedAt ??= Date.now()
          const offset = reasoning.length
          reasoning += streamed.text
          this.#chatHub.publish(
            assistant.id,
            chatStreamEventSchema.parse({
              type: "chat.reasoning",
              eventId: `${assistant.requestId}:${offset}:reasoning`,
              requestId: assistant.requestId,
              offset,
              messageId: assistant.id,
              delta: streamed.text,
            }),
          )
          continue
        }
        if (reasoningStartedAt !== undefined && reasoningMs === null) {
          reasoningMs = Date.now() - reasoningStartedAt
        }
        const delta = streamed.text
        const offset = accumulated.length
        accumulated += delta
        this.#chatHub.publish(
          assistant.id,
          chatStreamEventSchema.parse({
            type: "chat.delta",
            eventId: `${assistant.requestId}:${offset}:delta`,
            requestId: assistant.requestId,
            offset,
            messageId: assistant.id,
            delta,
          }),
        )
        if (Date.now() - lastWrite >= this.#partialWriteIntervalMs) {
          assistant =
            (await this.#repository.updateMessage(assistant.id, {
              content: accumulated,
              reasoningContent: reasoning || null,
              reasoningMs,
            })) ?? assistant
          lastWrite = Date.now()
        }
      }
      if (!accumulated.trim()) throw new SessionPipelineError("EMPTY_CONTENT")
      const completed = await this.#repository.updateMessage(assistant.id, {
        content: accumulated,
        reasoningContent: reasoning || null,
        reasoningMs,
        status: "complete",
        completedAt: new Date(),
      })
      if (!completed) {
        this.#chatHub.clear(assistant.id)
        return
      }
      this.#chatHub.publish(completed.id, this.#chatInitialEvent(user, completed))
    } catch (error) {
      const code = generationCode(error)
      try {
        const failed = await this.#repository.updateMessage(assistant.id, {
          content: accumulated,
          status: "failed",
          failureCode: code,
          completedAt: new Date(),
        })
        if (failed) this.#chatHub.publish(failed.id, this.#chatFailedEvent(failed))
        else this.#chatHub.clear(assistant.id)
      } catch (persistenceError) {
        this.#chatHub.clear(assistant.id)
        console.error("Failed to persist chat failure", persistenceError)
      }
    }
  }
}
