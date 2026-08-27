import { describe, expect, it } from "vitest"
import {
  apiErrorSchema,
  chatStreamEventSchema,
  createChatRequestSchema,
  createSessionRequestSchema,
  httpUrlSchema,
  listSessionsQuerySchema,
  sessionSchema,
  sessionStreamEventSchema,
} from "./index"

const session = sessionSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  originalUrl: "https://example.com/article",
  canonicalUrl: "https://example.com/article",
  finalUrl: null,
  host: "example.com",
  title: null,
  siteName: null,
  description: null,
  summary: "Summary",
  status: "complete",
  failureStage: null,
  failureCode: null,
  sourceWordCount: 10,
  sourceTruncated: false,
  provider: "openai-compatible",
  model: "test-model",
  attemptId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1,
  generationVersion: 1,
  inputTokens: null,
  outputTokens: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:01.000Z",
  completedAt: "2026-08-26T00:00:01.000Z",
})

describe("request contracts", () => {
  it.each(["https://example.com/article", "http://example.com:8080/path"])("accepts %s", (url) => {
    expect(httpUrlSchema.parse(url)).toBe(url)
  })

  it.each([
    "example.com",
    "ftp://example.com",
    "https://not%20a%20web%20address",
    "https://user:secret@example.com",
  ])("rejects %s", (url) => expect(httpUrlSchema.safeParse(url).success).toBe(false))

  it("bounds list and chat input", () => {
    expect(listSessionsQuerySchema.parse({})).toEqual({ query: "", limit: 20 })
    expect(listSessionsQuerySchema.parse({ query: " term ", limit: "100" })).toEqual({
      query: "term",
      limit: 100,
    })
    expect(
      createChatRequestSchema.safeParse({ content: "", idempotencyKey: crypto.randomUUID() })
        .success,
    ).toBe(false)
    expect(
      createSessionRequestSchema.safeParse({ url: "https://example.com", idempotencyKey: "bad" })
        .success,
    ).toBe(false)
  })
})

describe("response contracts", () => {
  it("requires safe retry metadata", () => {
    expect(
      apiErrorSchema.parse({
        code: "LLM_UNAVAILABLE",
        message: "Unavailable",
        retryable: true,
        requestId: "33333333-3333-4333-8333-333333333333",
      }).retryable,
    ).toBe(true)
  })

  it("types summary deltas with version and offset without source text", () => {
    const event = sessionStreamEventSchema.parse({
      type: "summary.delta",
      eventId: "1:0:delta",
      version: 1,
      offset: 0,
      delta: "Summary",
      session,
    })
    expect(event.type).toBe("summary.delta")
    expect("sourceText" in event.session).toBe(false)
  })

  it("types terminal chat messages", () => {
    expect(
      chatStreamEventSchema.safeParse({
        type: "chat.completed",
        eventId: "request:6:complete",
        requestId: "44444444-4444-4444-8444-444444444444",
        offset: 6,
        message: {
          id: "55555555-5555-4555-8555-555555555555",
          sessionId: session.id,
          requestId: "44444444-4444-4444-8444-444444444444",
          role: "assistant",
          content: "Answer",
          status: "complete",
          failureCode: null,
          provider: "fake",
          model: "fake",
          attemptId: null,
          attemptNumber: 1,
          inputTokens: null,
          outputTokens: null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          completedAt: session.completedAt,
        },
      }).success,
    ).toBe(true)
  })
})
