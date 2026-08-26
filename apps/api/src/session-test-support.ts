import { randomUUID } from "node:crypto"
import type {
  CreateSessionRequest,
  ListSessionsQuery,
  MessageRole,
  MessageStatus,
} from "@profound/contracts"
import type { Llm, LlmRequest } from "./llm"
import { LlmError } from "./llm"
import { ServiceError } from "./session-errors"
import type {
  CreateMessagesResult,
  CreateSessionResult,
  MessageRecord,
  MessageUpdate,
  SessionPage,
  SessionRecord,
  SessionRepository,
  SessionUpdate,
} from "./session-repository"
import { UNAUTHENTICATED_WORKSPACE_ID } from "./session-repository"

const baseTime = new Date("2026-08-26T00:00:00.000Z")

export class MemorySessionRepository implements SessionRepository {
  readonly messagesById = new Map<string, MessageRecord>()
  readonly records = new Map<string, SessionRecord>()
  readonly #sessionKeys = new Map<string, string>()

  async createOrGet(input: CreateSessionRequest): Promise<CreateSessionResult> {
    const existingId = this.#sessionKeys.get(input.idempotencyKey)
    if (existingId) {
      const existing = this.records.get(existingId)
      if (!existing) throw new Error("Missing idempotent session")
      if (new URL(existing.originalUrl).toString() !== new URL(input.url).toString()) {
        throw new ServiceError("IDEMPOTENCY_CONFLICT")
      }
      return { created: false, session: existing }
    }
    const canonicalUrl = new URL(input.url).toString()
    const timestamp = new Date(baseTime.getTime() + this.records.size)
    const session: SessionRecord = {
      id: randomUUID(),
      workspaceId: UNAUTHENTICATED_WORKSPACE_ID,
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
      currentAttemptId: randomUUID(),
      attemptNumber: 1,
      generationVersion: 0,
      inputTokens: null,
      outputTokens: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }
    this.records.set(session.id, session)
    this.#sessionKeys.set(input.idempotencyKey, session.id)
    return { created: true, session }
  }

  async findById(id: string): Promise<SessionRecord | null> {
    return this.records.get(id) ?? null
  }

  async update(id: string, update: SessionUpdate): Promise<SessionRecord | null> {
    const current = this.records.get(id)
    if (!current) return null
    const updated = { ...current, ...update, updatedAt: new Date(current.updatedAt.getTime() + 1) }
    this.records.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<boolean> {
    const session = this.records.get(id)
    const deleted = this.records.delete(id)
    if (session) this.#sessionKeys.delete(session.idempotencyKey)
    for (const [messageId, message] of this.messagesById) {
      if (message.sessionId === id) this.messagesById.delete(messageId)
    }
    return deleted
  }

  async list(query: ListSessionsQuery): Promise<SessionPage> {
    const lowered = query.query.toLowerCase()
    const all = [...this.records.values()]
      .filter((session) =>
        lowered
          ? [session.title, session.originalUrl, session.canonicalUrl, session.summary].some(
              (value) => value?.toLowerCase().includes(lowered),
            )
          : true,
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      )
    const start = query.cursor ? Number(Buffer.from(query.cursor, "base64url").toString()) : 0
    const page = all.slice(start, start + query.limit)
    return {
      sessions: page,
      nextCursor:
        start + query.limit < all.length
          ? Buffer.from(String(start + query.limit)).toString("base64url")
          : null,
    }
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    return [...this.messagesById.values()]
      .filter((message) => message.sessionId === sessionId)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
      )
  }

  async createMessages(
    sessionId: string,
    requestId: string,
    content: string,
  ): Promise<CreateMessagesResult> {
    const existing = (await this.listMessages(sessionId)).filter(
      (message) => message.requestId === requestId,
    )
    if (existing.length) {
      const user = existing.find((message) => message.role === "user")
      const assistant = existing.find((message) => message.role === "assistant")
      if (!user || !assistant) throw new Error("Incomplete idempotent chat")
      if (user.content !== content) throw new ServiceError("IDEMPOTENCY_CONFLICT")
      return { created: false, userMessage: user, assistantMessage: assistant }
    }
    const now = new Date(baseTime.getTime() + this.messagesById.size * 2)
    const make = (
      role: MessageRole,
      status: MessageStatus,
      messageContent: string,
    ): MessageRecord => ({
      id: randomUUID(),
      sessionId,
      requestId,
      role,
      content: messageContent,
      status,
      failureCode: null,
      provider: null,
      model: null,
      currentAttemptId: role === "assistant" ? randomUUID() : null,
      attemptNumber: 1,
      inputTokens: null,
      outputTokens: null,
      createdAt: new Date(now.getTime() + (role === "assistant" ? 1 : 0)),
      updatedAt: new Date(now.getTime() + (role === "assistant" ? 1 : 0)),
      completedAt: role === "user" ? now : null,
    })
    const userMessage = make("user", "complete", content)
    const assistantMessage = make("assistant", "streaming", "")
    this.messagesById.set(userMessage.id, userMessage)
    this.messagesById.set(assistantMessage.id, assistantMessage)
    return { created: true, userMessage, assistantMessage }
  }

  async updateMessage(id: string, update: MessageUpdate): Promise<MessageRecord | null> {
    const current = this.messagesById.get(id)
    if (!current) return null
    const updated = { ...current, ...update, updatedAt: new Date(current.updatedAt.getTime() + 1) }
    this.messagesById.set(id, updated)
    return updated
  }

  async reconcileInterrupted(): Promise<void> {
    for (const [id, session] of this.records) {
      if (session.status !== "complete" && session.status !== "failed") {
        this.records.set(id, {
          ...session,
          status: "failed",
          failureCode: "GENERATION_INTERRUPTED",
          completedAt: new Date(),
        })
      }
    }
    for (const [id, message] of this.messagesById) {
      if (message.status === "streaming") {
        this.messagesById.set(id, {
          ...message,
          status: "failed",
          failureCode: "GENERATION_INTERRUPTED",
          completedAt: new Date(),
        })
      }
    }
  }
}

export type FakeLlmResponse =
  | Array<string | Error>
  | ((request: LlmRequest) => AsyncIterable<string>)

export class FakeLlm implements Llm {
  readonly model = "fake-model"
  readonly provider = "fake"
  readonly requests: LlmRequest[] = []
  readonly #responses: FakeLlmResponse[]

  constructor(...responses: FakeLlmResponse[]) {
    this.#responses = responses.length ? responses : [["A fake summary."]]
  }

  async *stream(request: LlmRequest): AsyncIterable<string> {
    this.requests.push(request)
    const response = this.#responses.shift() ?? ["A fake response."]
    if (typeof response === "function") {
      yield* response(request)
      return
    }
    for (const item of response) {
      if (request.signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
      if (item instanceof Error) throw item
      yield item
    }
  }
}

export const fetchedHtml = `<!doctype html><html><head><title>Source title</title>
  <link rel="canonical" href="https://example.com/canonical"></head><body><article>
  <p>The source opens with a complete factual sentence about the topic.</p>
  <p>A second complete sentence provides enough context for a useful answer.</p>
  </article></body></html>`
