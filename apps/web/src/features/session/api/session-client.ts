import {
  type ApiErrorCode,
  apiErrorSchema,
  type ChatStreamEvent,
  chatStreamEventSchema,
  createChatRequestSchema,
  createSessionRequestSchema,
  type ListSessionsResponse,
  listSessionsResponseSchema,
  type MessageDto,
  messagesResponseSchema,
  type SessionDto,
  type SummaryStreamEvent,
  sessionSchema,
  summaryStreamEventSchema,
} from "@profound/contracts"
import { createParser } from "eventsource-parser"

export class SessionApiError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.name = "SessionApiError"
    this.code = code
  }
}

export interface SessionApi {
  list(query?: string, cursor?: string, limit?: number): Promise<ListSessionsResponse>
  create(url: string, idempotencyKey?: string): Promise<SessionDto>
  get(id: string): Promise<SessionDto>
  delete(id: string): Promise<void>
  messages(id: string): Promise<MessageDto[]>
  regenerate(id: string): Promise<SessionDto>
  chat(
    id: string,
    content: string,
    onEvent: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
    idempotencyKey?: string,
  ): Promise<void>
  stream(
    id: string,
    onEvent: (event: SummaryStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<void>
}

async function throwResponseError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null)
  const error = apiErrorSchema.safeParse(body)

  if (error.success) {
    throw new SessionApiError(error.data.code, error.data.message)
  }

  throw new SessionApiError(
    "INTERNAL_ERROR",
    "The summarization service returned an unexpected response.",
  )
}

async function parseEventStream<T>(
  response: Response,
  parse: (input: unknown) => T,
  onEvent: (event: T) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!response.body) {
    throw new SessionApiError("INTERNAL_ERROR", "The live response could not be read.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let parseError: Error | undefined
  const parser = createParser({
    onEvent(event) {
      try {
        onEvent(parse(JSON.parse(event.data)))
      } catch {
        parseError = new SessionApiError("INTERNAL_ERROR", "The live response was interrupted.")
      }
    },
    onError() {
      parseError = new SessionApiError("INTERNAL_ERROR", "The live response was interrupted.")
    },
  })

  const abort = () => void reader.cancel()
  signal.addEventListener("abort", abort, { once: true })
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
      if (parseError) throw parseError
    }
    parser.feed(decoder.decode())
    if (parseError) throw parseError
  } finally {
    signal.removeEventListener("abort", abort)
    reader.releaseLock()
  }
}

async function list(query = "", cursor?: string, limit = 100): Promise<ListSessionsResponse> {
  const search = new URLSearchParams({ query, limit: String(limit) })
  if (cursor) search.set("cursor", cursor)
  const response = await fetch(`/api/sessions?${search}`)
  if (!response.ok) return throwResponseError(response)
  return listSessionsResponseSchema.parse(await response.json())
}

async function create(url: string, idempotencyKey = crypto.randomUUID()): Promise<SessionDto> {
  const request = createSessionRequestSchema.parse({ url, idempotencyKey })
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })

  if (!response.ok) return throwResponseError(response)
  return sessionSchema.parse(await response.json())
}

async function get(id: string): Promise<SessionDto> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`)
  if (!response.ok) return throwResponseError(response)
  return sessionSchema.parse(await response.json())
}

async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" })
  if (!response.ok) return throwResponseError(response)
  if (response.status !== 204) {
    throw new SessionApiError("INTERNAL_ERROR", "The service returned an unexpected response.")
  }
}

async function regenerate(id: string): Promise<SessionDto> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/regenerate`, {
    method: "POST",
  })
  if (!response.ok) return throwResponseError(response)
  return sessionSchema.parse(await response.json())
}

async function messages(id: string): Promise<MessageDto[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/messages`)
  if (!response.ok) return throwResponseError(response)
  return messagesResponseSchema.parse(await response.json()).messages
}

async function chat(
  id: string,
  content: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
  idempotencyKey = crypto.randomUUID(),
): Promise<void> {
  const request = createChatRequestSchema.parse({ content, idempotencyKey })
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) return throwResponseError(response)
  let terminalReceived = false
  await parseEventStream(
    response,
    (input) => chatStreamEventSchema.parse(input),
    (event) => {
      terminalReceived = event.type === "chat.completed" || event.type === "chat.failed"
      onEvent(event)
    },
    signal,
  )
  if (!signal.aborted && !terminalReceived) {
    throw new SessionApiError("INTERNAL_ERROR", "The chat response was interrupted. Try again.")
  }
}

function stream(
  id: string,
  onEvent: (event: SummaryStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const source = new EventSource(`/api/sessions/${encodeURIComponent(id)}/stream`)
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      source.close()
      signal.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => finish()

    source.onmessage = (message) => {
      try {
        const event = summaryStreamEventSchema.parse(JSON.parse(message.data))
        onEvent(event)
        if (event.type === "summary.completed" || event.type === "summary.failed") finish()
      } catch {
        finish(new SessionApiError("INTERNAL_ERROR", "Live progress was interrupted."))
      }
    }
    source.onerror = () => {
      finish(new SessionApiError("INTERNAL_ERROR", "Live progress was interrupted."))
    }

    if (signal.aborted) finish()
    else signal.addEventListener("abort", onAbort, { once: true })
  })
}

export const sessionApi: SessionApi = {
  list,
  create,
  get,
  delete: deleteSession,
  messages,
  regenerate,
  chat,
  stream,
}
