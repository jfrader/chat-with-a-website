import type { SessionDto, SessionStreamEvent } from "@profound/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { sessionApi } from "./session-client"

const session: SessionDto = {
  id: "0f4d59b6-8a0f-40cf-a680-fbd4aaf4600a",
  originalUrl: "https://tryprofound.com",
  canonicalUrl: "https://tryprofound.com/",
  finalUrl: null,
  host: "tryprofound.com",
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
  attemptId: "2cd772f1-4a4e-48f1-b5a9-b9ac1e956ccd",
  attemptNumber: 1,
  inputTokens: null,
  outputTokens: null,
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:00:00.000Z",
  completedAt: null,
}

afterEach(() => vi.unstubAllGlobals())

describe("session API client", () => {
  it("creates a session with a generated idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(session, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(sessionApi.create("https://tryprofound.com")).resolves.toEqual(session)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions", expect.any(Object))
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toMatchObject({
      url: "https://tryprofound.com",
      idempotencyKey: expect.any(String),
    })
  })

  it("uses a caller-provided idempotency key for retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(session, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const idempotencyKey = "2cd772f1-4a4e-48f1-b5a9-b9ac1e956ccd"

    await sessionApi.create("https://tryprofound.com", idempotencyKey)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ idempotencyKey })
  })

  it("parses validated events across split CRLF chunks", async () => {
    const encoder = new TextEncoder()
    const completedSession = { ...session, status: "complete" as const }
    const firstEvent = {
      type: "stage.changed",
      attemptId: "2cd772f1-4a4e-48f1-b5a9-b9ac1e956ccd",
      stage: "extracting",
    } satisfies SessionStreamEvent
    const secondEvent = {
      type: "session.completed",
      attemptId: "2cd772f1-4a4e-48f1-b5a9-b9ac1e956ccd",
      session: completedSession,
    } satisfies SessionStreamEvent
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: stage.changed\r\ndata: ${JSON.stringify(firstEvent)}\r`),
        )
        controller.enqueue(
          encoder.encode(
            `\n\r\nevent: session.completed\r\ndata: ${JSON.stringify(secondEvent)}\r\n\r\n`,
          ),
        )
        controller.close()
      },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const events: SessionStreamEvent[] = []

    await sessionApi.stream(session.id, (event) => events.push(event), new AbortController().signal)

    expect(events).toEqual([firstEvent, secondEvent])
  })

  it("parses event streams that use CR-only line endings", async () => {
    const event = {
      type: "stage.changed",
      attemptId: session.attemptId,
      stage: "extracting",
    } satisfies SessionStreamEvent
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\r`))
        controller.close()
      },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const events: SessionStreamEvent[] = []

    await sessionApi.stream(
      session.id,
      (streamEvent) => events.push(streamEvent),
      new AbortController().signal,
    )

    expect(events).toEqual([event])
  })

  it("preserves a CRLF split between multiline data fields", async () => {
    const event = {
      type: "stage.changed",
      attemptId: session.attemptId,
      stage: "extracting",
    } satisfies SessionStreamEvent
    const serialized = JSON.stringify(event)
    const splitAt = serialized.indexOf('"attemptId"')
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(`data: ${serialized.slice(0, splitAt)}\r`))
        controller.enqueue(encoder.encode(`\ndata: ${serialized.slice(splitAt)}\r\n\r\n`))
        controller.close()
      },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const events: SessionStreamEvent[] = []

    await sessionApi.stream(
      session.id,
      (streamEvent) => events.push(streamEvent),
      new AbortController().signal,
    )

    expect(events).toEqual([event])
  })

  it("surfaces the API's safe error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "URL_NOT_ALLOWED",
            message: "That destination cannot be accessed safely.",
            retryable: false,
            requestId: "04f9a8ac-239d-40d3-9768-3e2f64a4f524",
          },
          { status: 400 },
        ),
      ),
    )

    await expect(sessionApi.create("https://127.0.0.1")).rejects.toMatchObject({
      code: "URL_NOT_ALLOWED",
      message: "That destination cannot be accessed safely.",
      retryable: false,
    })
  })
})
