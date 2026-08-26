import { apiErrorSchema, sessionSchema, sessionStreamEventSchema } from "@profound/contracts"
import { describe, expect, it, vi } from "vitest"
import { createApiApp } from "./app"
import { SessionCapacityError, type SessionServiceApi } from "./session-service"

const sessionId = "11111111-1111-4111-8111-111111111111"
const attemptId = "22222222-2222-4222-8222-222222222222"
const idempotencyKey = "33333333-3333-4333-8333-333333333333"

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
  attemptId,
  attemptNumber: 1,
  inputTokens: null,
  outputTokens: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  completedAt: null,
})

const createFakeService = (overrides: Partial<SessionServiceApi> = {}): SessionServiceApi => ({
  create: vi.fn(async () => ({ created: true, session })),
  get: vi.fn(async () => session),
  stream: vi.fn(async () => null),
  ...overrides,
})

const postSession = (app: ReturnType<typeof createApiApp>, body: unknown) =>
  app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("session API routes", () => {
  it.each([
    null,
    {},
    { url: "file:///etc/passwd", idempotencyKey },
    { url: "https://example.com", idempotencyKey: "not-a-uuid" },
  ])("rejects invalid create requests without invoking the service", async (body) => {
    const service = createFakeService()
    const response = await postSession(createApiApp({ sessionService: service }), body)

    expect(response.status).toBe(400)
    expect(apiErrorSchema.parse(await response.json()).code).toBe("INVALID_URL")
    expect(service.create).not.toHaveBeenCalled()
  })

  it("returns 202 for a new session and 200 for an idempotent existing session", async () => {
    const create = vi
      .fn<SessionServiceApi["create"]>()
      .mockResolvedValueOnce({ created: true, session })
      .mockResolvedValueOnce({ created: false, session })
    const app = createApiApp({ sessionService: createFakeService({ create }) })
    const request = { url: session.originalUrl, idempotencyKey }

    const first = await postSession(app, request)
    const second = await postSession(app, request)

    expect(first.status).toBe(202)
    expect(second.status).toBe(200)
    expect(sessionSchema.parse(await first.json())).toEqual(session)
    expect(sessionSchema.parse(await second.json())).toEqual(session)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("rejects oversized create bodies before parsing or invoking the service", async () => {
    const service = createFakeService()
    const response = await postSession(createApiApp({ sessionService: service }), {
      url: `https://example.com/${"a".repeat(5_000)}`,
      idempotencyKey,
    })

    expect(response.status).toBe(413)
    expect(apiErrorSchema.parse(await response.json()).code).toBe("INVALID_URL")
    expect(service.create).not.toHaveBeenCalled()
  })

  it("returns a retryable 429 when pipeline capacity is exhausted", async () => {
    const service = createFakeService({
      create: vi.fn(async () => {
        throw new SessionCapacityError()
      }),
    })
    const response = await postSession(createApiApp({ sessionService: service }), {
      url: session.originalUrl,
      idempotencyKey,
    })
    const error = apiErrorSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true })
  })

  it("returns sessions and structured not-found errors", async () => {
    const found = await createApiApp({ sessionService: createFakeService() }).request(
      `/api/sessions/${sessionId}`,
    )
    const missing = await createApiApp({
      sessionService: createFakeService({ get: vi.fn(async () => null) }),
    }).request(`/api/sessions/${sessionId}`)
    const malformed = await createApiApp({ sessionService: createFakeService() }).request(
      "/api/sessions/not-a-uuid",
    )

    expect(found.status).toBe(200)
    expect(sessionSchema.parse(await found.json())).toEqual(session)
    expect(missing.status).toBe(404)
    expect(apiErrorSchema.parse(await missing.json()).code).toBe("SESSION_NOT_FOUND")
    expect(malformed.status).toBe(404)
  })

  it("writes contract-valid events as an SSE response", async () => {
    const events = [
      sessionStreamEventSchema.parse({ type: "stage.changed", attemptId, stage: "summarizing" }),
      sessionStreamEventSchema.parse({ type: "summary.delta", attemptId, delta: "A summary." }),
      sessionStreamEventSchema.parse({
        type: "session.completed",
        attemptId,
        session: { ...session, status: "complete", summary: "A summary." },
      }),
    ]
    const service = createFakeService({
      stream: vi.fn(async () => ({
        close: vi.fn(),
        session,
        events: {
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event
          },
        },
      })),
    })
    const response = await createApiApp({ sessionService: service }).request(
      `/api/sessions/${sessionId}/stream`,
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(body).toContain("event: stage.changed")
    expect(body).toContain("event: summary.delta")
    expect(body).toContain("event: session.completed")
    const parsedEvents = body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => sessionStreamEventSchema.parse(JSON.parse(line.slice(6))))
    expect(parsedEvents).toEqual(events)
  })

  it("returns a retryable 429 when stream capacity is exhausted", async () => {
    const service = createFakeService({
      stream: vi.fn(async () => {
        throw new SessionCapacityError()
      }),
    })
    const response = await createApiApp({ sessionService: service }).request(
      `/api/sessions/${sessionId}/stream`,
    )
    const error = apiErrorSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true })
  })
})
