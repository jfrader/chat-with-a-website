import {
  type BrowserRecord,
  type ChatStreamEvent,
  type MessageDto,
  type SessionDto,
  type SummaryStreamEvent,
  browserChatRequestSchema,
  browserLimits,
  browserRecordSchema,
  browserSessionSchema,
  browserSummaryRequestSchema,
  chatStreamEventSchema,
  createBrowserSession,
  createChatRequestSchema,
  createSessionRequestSchema,
  listSessionsQuerySchema,
  summaryStreamEventSchema,
} from "@chat-with-a-website/contracts"
import {
  parseEventStream,
  type SessionApi,
  SessionApiError,
  throwResponseError,
} from "./session-client"

const RECORD_PREFIX = "chat-with-a-website:session:v2:"
const LEGACY_KEY = "chat-with-a-website:local-sessions:v1"
const interrupted = () =>
  new SessionApiError("GENERATION_INTERRUPTED", "The response was interrupted. Try again.")
const missing = () => new SessionApiError("SESSION_NOT_FOUND", "This session was deleted.")

type ActiveOperation = { controller: AbortController; revision: string; cleanup?: () => void }

export class LocalSessionApi implements SessionApi {
  readonly #storage: () => Storage
  readonly #fetch: typeof fetch
  readonly #active = new Map<string, ActiveOperation>()
  readonly #pending = new Set<string>()

  constructor(
    storage: () => Storage = () => localStorage,
    fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    this.#storage = storage
    this.#fetch = fetcher
  }

  #access<T>(operation: (storage: Storage) => T): T {
    try {
      return operation(this.#storage())
    } catch (error) {
      if (error instanceof SessionApiError) throw error
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "QuotaExceededError"
      ) {
        throw new SessionApiError(
          "INTERNAL_ERROR",
          "Browser storage is full. Delete older sessions and retry.",
        )
      }
      throw new SessionApiError(
        "INTERNAL_ERROR",
        "Browser storage is unavailable. Allow site storage and retry.",
      )
    }
  }

  #ids(): string[] {
    return this.#access((storage) => {
      if (storage.getItem(LEGACY_KEY) !== null) {
        throw new SessionApiError(
          "INTERNAL_ERROR",
          "Saved history has an unsupported format. Export site storage before clearing it.",
        )
      }
      return Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => key?.startsWith(RECORD_PREFIX) === true)
        .map((key) => key.slice(RECORD_PREFIX.length))
    })
  }

  #read(id: string): BrowserRecord {
    const raw = this.#access((storage) => storage.getItem(RECORD_PREFIX + id))
    if (raw === null) throw missing()
    try {
      const record = browserRecordSchema.parse(JSON.parse(raw))
      if (record.session.id !== id) throw new Error("Invalid record identity")
      return record
    } catch {
      throw new SessionApiError(
        "INTERNAL_ERROR",
        "Saved history could not be read. Export site storage before clearing it.",
      )
    }
  }

  #recover(record: BrowserRecord): BrowserRecord {
    if (this.#active.has(record.session.id) || this.#pending.has(record.session.id)) return record
    const completedAt = new Date().toISOString()
    return {
      ...record,
      session:
        record.session.status === "complete" || record.session.status === "failed"
          ? record.session
          : {
              ...record.session,
              status: "failed",
              failureCode: "GENERATION_INTERRUPTED",
              completedAt,
            },
      messages: record.messages.map((message) =>
        message.status === "streaming"
          ? { ...message, status: "failed", failureCode: "GENERATION_INTERRUPTED", completedAt }
          : message,
      ),
    }
  }

  #write(record: BrowserRecord, expectedRevision?: string): void {
    browserRecordSchema.parse(record)
    if (expectedRevision && this.#read(record.session.id).revision !== expectedRevision)
      throw interrupted()
    this.#access((storage) =>
      storage.setItem(RECORD_PREFIX + record.session.id, JSON.stringify(record)),
    )
  }

  async list(query = "", cursor?: string, limit = 20) {
    const parsed = listSessionsQuerySchema.parse({ query, cursor, limit })
    const start = cursor ? Number(cursor) : 0
    if (!Number.isSafeInteger(start) || start < 0)
      throw new SessionApiError("INVALID_URL", "Invalid history page.")
    const search = parsed.query.toLocaleLowerCase()
    const sessions = this.#ids()
      .map((id) => this.#recover(this.#read(id)).session)
      .filter((session) =>
        [session.title, session.originalUrl, session.canonicalUrl, session.summary].some((value) =>
          value?.toLocaleLowerCase().includes(search),
        ),
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      )
    return {
      sessions: sessions.slice(start, start + parsed.limit),
      nextCursor: start + parsed.limit < sessions.length ? String(start + parsed.limit) : null,
    }
  }

  async create(url: string, idempotencyKey = crypto.randomUUID()): Promise<SessionDto> {
    const request = createSessionRequestSchema.parse({ url, idempotencyKey })
    const ids = this.#ids()
    if (ids.includes(idempotencyKey)) {
      const current = this.#read(idempotencyKey).session
      if (new URL(current.originalUrl).href !== new URL(request.url).href) {
        throw new SessionApiError(
          "IDEMPOTENCY_CONFLICT",
          "This request was already used for another URL.",
        )
      }
      return this.#recover(this.#read(idempotencyKey)).session
    }
    const session = createBrowserSession({
      id: idempotencyKey,
      url: request.url,
      attemptNumber: 1,
      generationVersion: 0,
      createdAt: new Date().toISOString(),
    })
    this.#write({ version: 2, revision: crypto.randomUUID(), session, messages: [] })
    this.#pending.add(session.id)
    return session
  }

  async get(id: string) {
    return this.#recover(this.#read(id)).session
  }
  async messages(id: string) {
    return this.#recover(this.#read(id)).messages
  }
  async delete(id: string): Promise<void> {
    this.#read(id)
    this.#access((storage) => storage.removeItem(RECORD_PREFIX + id))
    this.#active.get(id)?.controller.abort()
    this.#active.get(id)?.cleanup?.()
    this.#active.delete(id)
    this.#pending.delete(id)
  }

  async regenerate(id: string): Promise<SessionDto> {
    const current = this.#recover(this.#read(id))
    this.#active.get(id)?.controller.abort()
    const session = createBrowserSession({
      id,
      url: current.session.originalUrl,
      attemptNumber: current.session.attemptNumber + 1,
      generationVersion: current.session.generationVersion,
      createdAt: current.session.createdAt,
    })
    this.#write({ ...current, revision: crypto.randomUUID(), session }, current.revision)
    this.#active.get(id)?.cleanup?.()
    this.#active.delete(id)
    this.#pending.add(id)
    return session
  }

  #begin(record: BrowserRecord, signal: AbortSignal) {
    if (signal.aborted) throw interrupted()
    if (this.#active.has(record.session.id)) throw interrupted()
    const operation: ActiveOperation = {
      controller: new AbortController(),
      revision: crypto.randomUUID(),
    }
    const working = { ...record, revision: operation.revision }
    this.#write(working, record.revision)
    this.#active.set(record.session.id, operation)
    if (typeof window !== "undefined") {
      const changed = (event: StorageEvent) => {
        if (event.key === RECORD_PREFIX + record.session.id || event.key === null)
          operation.controller.abort()
      }
      window.addEventListener("storage", changed)
      operation.cleanup = () => window.removeEventListener("storage", changed)
    }
    return { working, operation, signal: AbortSignal.any([signal, operation.controller.signal]) }
  }

  #assertCurrent(id: string, operation: ActiveOperation): void {
    if (operation.controller.signal.aborted || this.#read(id).revision !== operation.revision) {
      operation.controller.abort()
      throw interrupted()
    }
  }

  #finish(record: BrowserRecord, operation: ActiveOperation): void {
    try {
      const raw = this.#access((storage) => storage.getItem(RECORD_PREFIX + record.session.id))
      if (raw === null) return
      if (this.#read(record.session.id).revision !== operation.revision) return
      this.#write({ ...record, revision: crypto.randomUUID() }, operation.revision)
    } finally {
      operation.cleanup?.()
      if (this.#active.get(record.session.id) === operation) {
        this.#active.delete(record.session.id)
        this.#pending.delete(record.session.id)
      }
    }
  }

  async #post<T>(
    path: string,
    body: unknown,
    parse: (input: unknown) => T,
    onEvent: (event: T) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.#fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) return throwResponseError(response)
    await parseEventStream(response, parse, onEvent, signal)
  }

  async stream(
    id: string,
    onEvent: (event: SummaryStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    await Promise.resolve()
    if (signal.aborted) return
    const record = this.#read(id)
    if (record.session.status === "complete" || record.session.status === "failed") {
      onEvent(
        summaryStreamEventSchema.parse({
          type: "summary.snapshot",
          eventId: `${record.revision}:snapshot`,
          version: record.session.generationVersion,
          offset: record.session.summary.length,
          session: record.session,
        }),
      )
      return
    }
    const { working, operation, signal: combined } = this.#begin(record, signal)
    let terminal = false
    try {
      const request = browserSummaryRequestSchema.parse({
        id,
        url: record.session.originalUrl,
        attemptNumber: record.session.attemptNumber,
        generationVersion: record.session.generationVersion,
        createdAt: record.session.createdAt,
      })
      await this.#post(
        "/api/browser/summary",
        request,
        (input) => summaryStreamEventSchema.parse(input),
        (event) => {
          this.#assertCurrent(id, operation)
          if (event.session.id !== id) throw interrupted()
          working.session = browserSessionSchema.parse(event.session)
          terminal = event.type === "summary.completed" || event.type === "summary.failed"
          if (terminal) this.#write(working, operation.revision)
          onEvent(event)
        },
        combined,
      )
      if (!terminal) throw interrupted()
    } finally {
      if (!terminal)
        working.session = {
          ...working.session,
          status: "failed",
          failureCode: "GENERATION_INTERRUPTED",
          completedAt: new Date().toISOString(),
        }
      this.#finish(working, operation)
    }
  }

  async chat(
    id: string,
    content: string,
    onEvent: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
    idempotencyKey = crypto.randomUUID(),
  ): Promise<void> {
    const record = this.#recover(this.#read(id))
    const request = createChatRequestSchema.parse({ content, idempotencyKey })
    const user = record.messages.find(
      (message) => message.requestId === idempotencyKey && message.role === "user",
    )
    const assistant = record.messages.find(
      (message) => message.requestId === idempotencyKey && message.role === "assistant",
    )
    if (user && assistant) {
      if (user.content !== request.content)
        throw new SessionApiError(
          "IDEMPOTENCY_CONFLICT",
          "This request was already used for another message.",
        )
      if (assistant.status === "complete") {
        onEvent({
          type: "chat.completed",
          eventId: `${idempotencyKey}:complete`,
          requestId: idempotencyKey,
          offset: assistant.content.length,
          message: assistant,
        })
        return
      }
      throw interrupted()
    }
    if (record.messages.length >= browserLimits.storedMessages)
      throw new SessionApiError(
        "INVALID_MESSAGE",
        "This conversation is full. Create a new session.",
      )
    const history: MessageDto[] = []
    let characters = 0
    for (const message of [...record.messages].reverse()) {
      if (message.status !== "complete") continue
      const pair = record.messages.filter((item) => item.requestId === message.requestId)
      if (
        pair.length !== 2 ||
        pair.some((item) => item.status !== "complete") ||
        history.some((item) => item.requestId === message.requestId)
      )
        continue
      const size = pair.reduce((total, item) => total + item.content.length, 0)
      if (
        history.length + 2 > browserLimits.requestMessages ||
        characters + size > browserLimits.historyCharacters
      )
        break
      characters += size
      history.unshift(...pair.map((item) => ({ ...item, reasoningContent: null })))
    }
    const body = browserChatRequestSchema.parse({
      session: record.session,
      messages: history,
      request,
    })
    const { working, operation, signal: combined } = this.#begin(record, signal)
    let terminal = false
    try {
      await this.#post(
        "/api/browser/chat",
        body,
        (input) => chatStreamEventSchema.parse(input),
        (event) => {
          this.#assertCurrent(id, operation)
          if (event.requestId !== idempotencyKey) throw interrupted()
          if (event.type === "chat.created") {
            if (event.userMessage.sessionId !== id || event.assistantMessage.sessionId !== id)
              throw interrupted()
            working.messages.push(event.userMessage, event.assistantMessage)
            this.#write(working, operation.revision)
          } else if (event.type === "chat.completed" || event.type === "chat.failed") {
            if (event.message.sessionId !== id) throw interrupted()
            const index = working.messages.findIndex((message) => message.id === event.message.id)
            if (index < 0) throw interrupted()
            working.messages[index] = event.message
            terminal = true
            this.#write(working, operation.revision)
          } else {
            const message = working.messages.find((item) => item.id === event.messageId)
            if (!message) throw interrupted()
            if (event.type === "chat.delta") message.content += event.delta
            else message.reasoningContent = (message.reasoningContent ?? "") + event.delta
          }
          onEvent(event)
        },
        combined,
      )
      if (!terminal) throw interrupted()
    } finally {
      if (!terminal)
        working.messages = working.messages.map((message) =>
          message.status === "streaming"
            ? {
                ...message,
                status: "failed",
                failureCode: "GENERATION_INTERRUPTED",
                completedAt: new Date().toISOString(),
              }
            : message,
        )
      this.#finish(working, operation)
    }
  }
}

export const localSessionApi: SessionApi = new LocalSessionApi()
