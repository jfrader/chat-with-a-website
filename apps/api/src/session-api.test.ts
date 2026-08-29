import {
  apiErrorSchema,
  chatStreamEventSchema,
  listSessionsResponseSchema,
  messagesResponseSchema,
  sessionSchema,
  sessionStreamEventSchema,
} from "@profound/contracts"
import { describe, expect, it, vi } from "vitest"
import { createApiApp } from "./app"
import { ServiceError } from "./session-errors"
import type { SessionServiceApi } from "./session-service"

const sessionId = "11111111-1111-4111-8111-111111111111"
const messageId = "22222222-2222-4222-8222-222222222222"
const requestId = "33333333-3333-4333-8333-333333333333"
const session = sessionSchema.parse({
  id: sessionId,
  originalUrl: "https://example.com/article",
  canonicalUrl: "https://example.com/article",
  finalUrl: null,
  host: "example.com",
  title: null,
  siteName: null,
  description: null,
  summary: "",
  status: "fetching",
  failureStage: null,
  failureCode: null,
  sourceWordCount: 0,
  sourceTruncated: false,
  provider: null,
  model: null,
  attemptId: "44444444-4444-4444-8444-444444444444",
  attemptNumber: 1,
  generationVersion: 0,
  inputTokens: null,
  outputTokens: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  completedAt: null,
})
const message = {
  id: messageId,
  sessionId,
  requestId,
  role: "assistant" as const,
  content: "Answer",
  reasoningContent: null,
  reasoningMs: null,
  status: "complete" as const,
  failureCode: null,
  provider: "fake",
  model: "fake",
  attemptId: "55555555-5555-4555-8555-555555555555",
  attemptNumber: 1,
  inputTokens: null,
  outputTokens: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:01.000Z",
  completedAt: "2026-08-26T00:00:01.000Z",
}

const iterable = <T>(events: T[]) => ({
  close: vi.fn(),
  events: {
    async *[Symbol.asyncIterator]() {
      yield* events
    },
  },
})

const fakeService = (overrides: Partial<SessionServiceApi> = {}): SessionServiceApi => ({
  chat: vi.fn(async () => null),
  create: vi.fn(async () => ({ created: true, session })),
  delete: vi.fn(async () => true),
  get: vi.fn(async () => session),
  initialize: vi.fn(async () => undefined),
  list: vi.fn(async () => ({ sessions: [session], nextCursor: null })),
  messages: vi.fn(async () => [message]),
  stream: vi.fn(async () => null),
  ...overrides,
})

describe("session API routes", () => {
  it("supports create, list/search, detail, messages, and delete", async () => {
    const service = fakeService()
    const app = createApiApp({ sessionService: service })
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: session.originalUrl, idempotencyKey: requestId }),
    })
    const listed = await app.request("/api/sessions?query=article&limit=10")
    const detail = await app.request(`/api/sessions/${sessionId}`)
    const messages = await app.request(`/api/sessions/${sessionId}/messages`)
    const deleted = await app.request(`/api/sessions/${sessionId}`, { method: "DELETE" })

    expect(created.status).toBe(202)
    expect(sessionSchema.parse(await created.json())).toEqual(session)
    expect(listSessionsResponseSchema.parse(await listed.json()).sessions).toEqual([session])
    expect(service.list).toHaveBeenCalledWith({ query: "article", limit: 10 })
    expect(sessionSchema.parse(await detail.json())).toEqual(session)
    expect(messagesResponseSchema.parse(await messages.json()).messages).toEqual([message])
    expect(deleted.status).toBe(204)
    expect(service.delete).toHaveBeenCalledWith(sessionId)
  })

  it.each([
    [new ServiceError("IDEMPOTENCY_CONFLICT"), 409],
    [new ServiceError("RATE_LIMITED"), 429],
    [new ServiceError("LLM_UNAVAILABLE"), 503],
  ])("maps safe service errors", async (error, status) => {
    const app = createApiApp({
      sessionService: fakeService({ create: vi.fn(async () => Promise.reject(error)) }),
    })
    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: session.originalUrl, idempotencyKey: requestId }),
    })
    expect(response.status).toBe(status)
    const body = apiErrorSchema.parse(await response.json())
    expect(body.code).toBe(error.code)
    expect(body.retryable).toBe(error.code !== "IDEMPOTENCY_CONFLICT")
  })

  it("streams typed summary events with SSE event IDs", async () => {
    const event = sessionStreamEventSchema.parse({
      type: "summary.completed",
      eventId: "1:7:complete",
      version: 1,
      offset: 7,
      session: { ...session, status: "complete", summary: "Summary" },
    })
    const app = createApiApp({
      sessionService: fakeService({ stream: vi.fn(async () => iterable([event])) }),
    })
    const response = await app.request(`/api/sessions/${sessionId}/stream`)
    const body = await response.text()
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(body).toContain("id: 1:7:complete")
    const data = body.split("\n").find((line) => line.startsWith("data: "))
    if (!data) throw new Error("Expected SSE data")
    expect(sessionStreamEventSchema.parse(JSON.parse(data.slice(6)))).toEqual(event)
  })

  it("validates and streams chat events", async () => {
    const event = chatStreamEventSchema.parse({
      type: "chat.completed",
      eventId: `${requestId}:6:complete`,
      requestId,
      offset: 6,
      message,
    })
    const chat = vi.fn(async () => iterable([event]))
    const app = createApiApp({ sessionService: fakeService({ chat }) })
    const response = await app.request(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Question?", idempotencyKey: requestId }),
    })
    expect(response.status).toBe(200)
    expect(chat).toHaveBeenCalledWith(sessionId, {
      content: "Question?",
      idempotencyKey: requestId,
    })
    expect(await response.text()).toContain("chat.completed")
  })

  it("returns safe validation and not-found errors", async () => {
    const service = fakeService({ get: vi.fn(async () => null), delete: vi.fn(async () => false) })
    const app = createApiApp({ sessionService: service })
    const invalidChat = await app.request(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "", idempotencyKey: requestId }),
    })
    const missing = await app.request(`/api/sessions/${sessionId}`)
    const deleted = await app.request(`/api/sessions/${sessionId}`, { method: "DELETE" })
    expect(apiErrorSchema.parse(await invalidChat.json()).code).toBe("INVALID_MESSAGE")
    expect(missing.status).toBe(404)
    expect(deleted.status).toBe(404)
  })

  it("returns a safe 400 when cursor decoding fails", async () => {
    const app = createApiApp({
      sessionService: fakeService({
        list: vi.fn(async () => Promise.reject(new ServiceError("INVALID_URL"))),
      }),
    })

    const response = await app.request("/api/sessions?cursor=malformed")
    expect(response.status).toBe(400)
    expect(apiErrorSchema.parse(await response.json())).toMatchObject({
      code: "INVALID_URL",
      message: "That doesn’t look like a webpage address.",
    })
  })
})
