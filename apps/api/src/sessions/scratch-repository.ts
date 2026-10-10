import { randomUUID } from "node:crypto"
import type { CreateSessionRequest, MessageDto, SessionDto } from "@chat-with-a-website/contracts"
import { ServiceError } from "../errors"
import type {
  CreateMessagesResult,
  MessageRecord,
  MessageUpdate,
  SessionRecord,
  SessionRepository,
  SessionUpdate,
} from "./repository"

export const browserWorkspaceId = "browser"

export function sessionRecord(session: SessionDto): SessionRecord {
  const { attemptId, completedAt, createdAt, updatedAt, ...data } = session
  return {
    ...data,
    sourceText: session.sourceText ?? "",
    currentAttemptId: attemptId,
    completedAt: completedAt ? new Date(completedAt) : null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    idempotencyKey: session.id,
    promptVersion: null,
    sourceHash: null,
    workspaceId: browserWorkspaceId,
  }
}

const messageRecord = (message: MessageDto): MessageRecord => {
  const { attemptId, completedAt, createdAt, updatedAt, ...data } = message
  return {
    ...data,
    currentAttemptId: attemptId,
    completedAt: completedAt ? new Date(completedAt) : null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  }
}

export class ScratchRepository implements SessionRepository {
  #session: SessionRecord | null
  #messages: MessageRecord[]

  constructor(session: SessionDto, messages: MessageDto[] = []) {
    this.#session = sessionRecord(session)
    this.#messages = messages.map(messageRecord)
  }

  dispose(): void {
    this.#session = null
    this.#messages = []
  }
  async reconcileInterrupted(): Promise<void> {}
  async createOrGet(_workspaceId: string, _request: CreateSessionRequest) {
    if (!this.#session) throw new ServiceError("SESSION_NOT_FOUND")
    return { created: true, session: this.#session }
  }
  async findById(workspaceId: string, id: string) {
    return workspaceId === browserWorkspaceId && this.#session?.id === id ? this.#session : null
  }
  async update(id: string, update: SessionUpdate) {
    if (this.#session?.id !== id) return null
    this.#session = { ...this.#session, ...update, updatedAt: new Date() }
    return this.#session
  }
  async delete(workspaceId: string, id: string) {
    if (!(await this.findById(workspaceId, id))) return false
    this.dispose()
    return true
  }
  async list() {
    return { sessions: this.#session ? [this.#session] : [], nextCursor: null }
  }
  async listMessages(sessionId: string) {
    return this.#session?.id === sessionId ? [...this.#messages] : []
  }
  async createMessages(
    sessionId: string,
    requestId: string,
    content: string,
  ): Promise<CreateMessagesResult> {
    const existing = this.#messages.filter((message) => message.requestId === requestId)
    const user = existing.find((message) => message.role === "user")
    const assistant = existing.find((message) => message.role === "assistant")
    if (user && assistant) {
      if (user.content !== content) throw new ServiceError("IDEMPOTENCY_CONFLICT")
      return { created: false, userMessage: user, assistantMessage: assistant }
    }
    const now = new Date()
    const base = {
      sessionId,
      requestId,
      reasoningContent: null,
      reasoningMs: null,
      failureCode: null,
      provider: null,
      model: null,
      attemptNumber: 1,
      inputTokens: null,
      outputTokens: null,
      createdAt: now,
      updatedAt: now,
    }
    const userMessage: MessageRecord = {
      ...base,
      id: randomUUID(),
      role: "user",
      content,
      status: "complete",
      completedAt: now,
      currentAttemptId: null,
    }
    const assistantMessage: MessageRecord = {
      ...base,
      id: randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
      completedAt: null,
      currentAttemptId: randomUUID(),
    }
    this.#messages.push(userMessage, assistantMessage)
    return { created: true, userMessage, assistantMessage }
  }
  async updateMessage(id: string, update: MessageUpdate) {
    const index = this.#messages.findIndex((message) => message.id === id)
    const current = this.#messages[index]
    if (!current) return null
    const updated = { ...current, ...update, updatedAt: new Date() }
    this.#messages[index] = updated
    return updated
  }
}
