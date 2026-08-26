import {
  type ApiErrorCode,
  apiErrorSchema,
  createSessionRequestSchema,
  type SessionDto,
  sessionSchema,
  type SessionStreamEvent,
  sessionStreamEventSchema,
} from "@profound/contracts"

export class SessionApiError extends Error {
  readonly code: ApiErrorCode
  readonly retryable: boolean

  constructor(code: ApiErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = "SessionApiError"
    this.code = code
    this.retryable = retryable
  }
}

export interface SessionApi {
  create(url: string, idempotencyKey?: string): Promise<SessionDto>
  get(id: string): Promise<SessionDto>
  stream(
    id: string,
    onEvent: (event: SessionStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<void>
}

async function throwResponseError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null)
  const error = apiErrorSchema.safeParse(body)

  if (error.success) {
    throw new SessionApiError(error.data.code, error.data.message, error.data.retryable)
  }

  throw new SessionApiError(
    "INTERNAL_ERROR",
    "The summarization service returned an unexpected response.",
    true,
  )
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

function parseSseBlock(block: string): SessionStreamEvent | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")

  return data ? sessionStreamEventSchema.parse(JSON.parse(data)) : undefined
}

async function stream(
  id: string,
  onEvent: (event: SessionStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/stream`, {
    headers: { Accept: "text/event-stream" },
    signal,
  })

  if (!response.ok) return throwResponseError(response)
  if (!response.body) {
    throw new SessionApiError("GENERATION_INTERRUPTED", "Live progress was interrupted.", true)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let pendingCarriageReturn = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      let decoded: string = `${pendingCarriageReturn ? "\r" : ""}${decoder.decode(value, { stream: !done })}`
      pendingCarriageReturn = !done && decoded.endsWith("\r")
      if (pendingCarriageReturn) decoded = decoded.slice(0, -1)
      buffer += decoded.replaceAll("\r\n", "\n").replaceAll("\r", "\n")

      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const event = parseSseBlock(buffer.slice(0, boundary))
        if (event) onEvent(event)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")
      }

      if (done) break
    }

    const finalEvent = parseSseBlock(buffer)
    if (finalEvent) onEvent(finalEvent)
  } finally {
    reader.releaseLock()
  }
}

export const sessionApi: SessionApi = { create, get, stream }
