import { describe, expect, it } from "vitest"
import { createSessionRequestSchema, httpUrlSchema, sessionStreamEventSchema } from "./index"

describe("URL contracts", () => {
  it.each(["https://example.com/article", "http://example.com:8080/path"])("accepts %s", (url) => {
    expect(httpUrlSchema.parse(url)).toBe(url)
  })

  it.each(["example.com", "ftp://example.com", "https://user:secret@example.com"])(
    "rejects %s",
    (url) => {
      expect(httpUrlSchema.safeParse(url).success).toBe(false)
    },
  )

  it("requires a UUID idempotency key", () => {
    expect(
      createSessionRequestSchema.safeParse({
        url: "https://example.com",
        idempotencyKey: "not-a-uuid",
      }).success,
    ).toBe(false)
  })
})

describe("response contracts", () => {
  it("rejects an empty summary delta", () => {
    expect(
      sessionStreamEventSchema.safeParse({
        type: "summary.delta",
        attemptId: "65c294a2-3af9-4ac0-990b-2b72c0f15bad",
        delta: "",
      }).success,
    ).toBe(false)
  })
})
