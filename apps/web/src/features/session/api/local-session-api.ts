import type { ListSessionsResponse, MessageDto, SessionDto } from "@chat-with-a-website/contracts"
import type { SessionApi } from "./session-client"
import { sessionApi as remoteApi } from "./session-client"

const STORAGE_KEY = "chat-with-a-website:local-sessions:v1"

type Stored = {
  sessions: Record<string, SessionDto & { sourceText?: string }>
  messages: Record<string, MessageDto[]>
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sessions: {}, messages: {} }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.sessions === "object" && typeof parsed.messages === "object") {
      return parsed
    }
  } catch {
    // preserve raw
  }
  return { sessions: {}, messages: {} }
}

function save(data: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err: unknown) {
    if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
      throw new Error("Local storage quota exceeded. Delete older sessions to continue.")
    }
    throw err
  }
}

function withSource(session: SessionDto): SessionDto & { sourceText?: string } {
  return session as SessionDto & { sourceText?: string }
}

export class LocalSessionApi implements SessionApi {
  private data = load()

  private persist() {
    save(this.data)
  }

  async list(query = "", cursor?: string, limit = 20): Promise<ListSessionsResponse> {
    let list = Object.values(this.data.sessions)
    if (query) {
      const q = query.toLowerCase()
      list = list.filter((s) =>
        [s.title, s.originalUrl, s.canonicalUrl, s.summary].some((v) =>
          v?.toLowerCase().includes(q),
        ),
      )
    }
    list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    const start = cursor ? parseInt(cursor, 10) || 0 : 0
    const page = list.slice(start, start + limit)
    const nextCursor = start + limit < list.length ? String(start + limit) : null
    return { sessions: page, nextCursor }
  }

  async create(url: string, idempotencyKey = crypto.randomUUID()): Promise<SessionDto> {
    const stub: SessionDto = {
      id: crypto.randomUUID(),
      originalUrl: url,
      canonicalUrl: url,
      finalUrl: null,
      host: new URL(url).hostname,
      title: null,
      siteName: null,
      description: null,
      summary: "",
      tagline: null,
      suggestedPrompts: [],
      status: "fetching",
      failureStage: null,
      failureCode: null,
      sourceWordCount: 0,
      sourceTruncated: false,
      provider: null,
      model: null,
      attemptId: crypto.randomUUID(),
      attemptNumber: 1,
      generationVersion: 0,
      inputTokens: null,
      outputTokens: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    }
    this.data.sessions[stub.id] = withSource(stub)
    this.data.messages[stub.id] = []
    this.persist()

    const created = await remoteApi.create(url, idempotencyKey)
    this.data.sessions[created.id] = withSource(created)
    this.persist()
    return created
  }

  async get(id: string): Promise<SessionDto> {
    const local = this.data.sessions[id]
    if (local) return local as SessionDto
    return remoteApi.get(id)
  }

  async delete(id: string): Promise<void> {
    delete this.data.sessions[id]
    delete this.data.messages[id]
    this.persist()
    try {
      await remoteApi.delete(id)
    } catch {}
  }

  async messages(id: string): Promise<MessageDto[]> {
    if (this.data.messages[id]) return this.data.messages[id]
    try {
      const fromRemote = await remoteApi.messages(id)
      this.data.messages[id] = fromRemote
      this.persist()
      return fromRemote
    } catch {
      return []
    }
  }

  async regenerate(id: string): Promise<SessionDto> {
    const updated = await remoteApi.regenerate(id)
    this.data.sessions[id] = withSource(updated)
    this.persist()
    return updated
  }

  async chat(
    id: string,
    content: string,
    onEvent: (event: unknown) => void,
    signal: AbortSignal,
    idempotencyKey = crypto.randomUUID(),
  ): Promise<void> {
    await remoteApi.chat(
      id,
      content,
      (event) => {
        onEvent(event)
        if (event.type === "chat.created") {
          const msgs = this.data.messages[id] || []
          this.data.messages[id] = [...msgs, event.userMessage, event.assistantMessage]
        } else if (event.type === "chat.completed" || event.type === "chat.failed") {
          const msgs = this.data.messages[id] || []
          const idx = msgs.findIndex((m) => m.id === event.message.id)
          if (idx >= 0) msgs[idx] = event.message
          else msgs.push(event.message)
          this.data.messages[id] = msgs
        }
        this.persist()
      },
      signal,
      idempotencyKey,
    )
  }

  async stream(id: string, onEvent: (event: unknown) => void, signal: AbortSignal): Promise<void> {
    await remoteApi.stream(
      id,
      (event) => {
        onEvent(event)
        if (event.session) {
          this.data.sessions[id] = withSource(event.session)
          this.persist()
        }
      },
      signal,
    )
  }
}

export const localSessionApi = new LocalSessionApi()
