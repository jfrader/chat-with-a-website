import { sessionSchema, sessionStreamEventSchema } from "@profound/contracts"
import { describe, expect, it } from "vitest"
import { SessionEventHub } from "./session-events"

const session = sessionSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  originalUrl: "https://example.com/article",
  canonicalUrl: "https://example.com/article",
  finalUrl: null,
  host: "example.com",
  title: null,
  siteName: null,
  description: null,
  summary: "",
  status: "summarizing",
  failureStage: null,
  failureCode: null,
  sourceWordCount: 10,
  sourceTruncated: false,
  provider: "fake",
  model: "fake-model",
  attemptId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1,
  generationVersion: 1,
  inputTokens: null,
  outputTokens: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  completedAt: null,
})

const event = (summary: string, type: "summary.snapshot" | "summary.delta" | "summary.completed") =>
  sessionStreamEventSchema.parse({
    type,
    eventId: `1:${summary.length}:${type}`,
    version: 1,
    offset: type === "summary.delta" ? Math.max(0, summary.length - 1) : summary.length,
    ...(type === "summary.delta" ? { delta: summary.slice(-1) } : {}),
    session: {
      ...session,
      summary,
      status: type === "summary.completed" ? "complete" : "summarizing",
      completedAt: type === "summary.completed" ? "2026-08-26T00:00:01.000Z" : null,
    },
  })

describe("SessionEventHub", () => {
  it("coalesces pending updates to the latest authoritative session and preserves terminal delivery", async () => {
    const hub = new SessionEventHub()
    hub.publish(session.id, event("A", "summary.snapshot"))
    const subscription = hub.subscribe(session.id, event("", "summary.snapshot"), true)
    const iterator = subscription[Symbol.asyncIterator]()

    expect((await iterator.next()).value?.session.summary).toBe("A")
    hub.publish(session.id, event("AB", "summary.delta"))
    hub.publish(session.id, event("ABC", "summary.delta"))
    expect((await iterator.next()).value?.session.summary).toBe("ABC")

    hub.publish(session.id, event("ABCD", "summary.completed"))
    expect((await iterator.next()).value).toMatchObject({
      type: "summary.completed",
      session: { summary: "ABCD" },
    })
    expect((await iterator.next()).done).toBe(true)
  })

  it("does not retain a terminal payload after publishing it", async () => {
    const hub = new SessionEventHub()
    hub.publish(session.id, event("old", "summary.completed"))
    const subscription = hub.subscribe(session.id, event("persisted", "summary.completed"), false)

    const values = []
    for await (const value of subscription) values.push(value)
    expect(values).toHaveLength(1)
    expect(values[0]?.session.summary).toBe("persisted")
  })
})
