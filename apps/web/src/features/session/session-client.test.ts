import type { ChatStreamEvent, SummaryStreamEvent } from "@profound/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  assistantMessageId,
  createMessage,
  createSession,
  requestId,
  sessionId,
} from "../../test/fixtures"
import { sessionApi } from "./session-client"

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly close = vi.fn()
  readonly url: string
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null

  constructor(url: string | URL) {
    this.url = String(url)
    FakeEventSource.instances.push(this)
  }

  emit(event: SummaryStreamEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>)
  }

  emitError() {
    this.onerror?.(new Event("error"))
  }
}

afterEach(() => {
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
})

describe("session API client", () => {
  it("validates list, create, detail, messages, and delete responses", async () => {
    const session = createSession()
    const message = createMessage()
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith("/api/sessions?")) {
        return Response.json({ sessions: [session], nextCursor: null })
      }
      if (url === "/api/sessions" && init?.method === "POST") {
        return Response.json(session, { status: 202 })
      }
      if (url.endsWith("/messages")) return Response.json({ messages: [message] })
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      return Response.json(session)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(sessionApi.list("visibility")).resolves.toEqual({
      sessions: [session],
      nextCursor: null,
    })
    await expect(sessionApi.create(session.originalUrl, requestId)).resolves.toEqual(session)
    await expect(sessionApi.get(session.id)).resolves.toEqual(session)
    await expect(sessionApi.messages(session.id)).resolves.toEqual([message])
    await expect(sessionApi.delete(session.id)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions?query=visibility&limit=100")
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      url: session.originalUrl,
      idempotencyKey: requestId,
    })
  })

  it("parses authoritative summary events and closes on completion", async () => {
    vi.stubGlobal("EventSource", FakeEventSource)
    const events: SummaryStreamEvent[] = []
    const completed = createSession()
    const streaming = sessionApi.stream(
      sessionId,
      (event) => events.push(event),
      new AbortController().signal,
    )
    const source = FakeEventSource.instances[0]
    if (!source) throw new Error("Expected EventSource")

    source.emit({
      type: "summary.completed",
      eventId: "1:65:completed",
      version: 1,
      offset: completed.summary.length,
      session: completed,
    })

    await expect(streaming).resolves.toBeUndefined()
    expect(events[0]).toMatchObject({ type: "summary.completed", session: completed })
    expect(source.close).toHaveBeenCalledOnce()
  })

  it("rejects instead of allowing an unbounded native reconnect loop", async () => {
    vi.stubGlobal("EventSource", FakeEventSource)
    const streaming = sessionApi.stream(sessionId, () => {}, new AbortController().signal)
    const source = FakeEventSource.instances[0]
    if (!source) throw new Error("Expected EventSource")

    source.emitError()

    await expect(streaming).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Live progress was interrupted.",
    })
    expect(source.close).toHaveBeenCalledOnce()
  })

  it("parses fetch-based chat SSE deltas and terminal messages", async () => {
    const user = createMessage()
    const assistant = createMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      status: "streaming",
      completedAt: null,
      provider: "openai",
      model: "gpt-test",
      attemptId: "b37f7595-142b-42f8-afd1-7020760a9c5c",
    })
    const completed = {
      ...assistant,
      content: "Evidence matters.",
      status: "complete" as const,
      completedAt: "2026-08-26T12:01:03.000Z",
    }
    const events: ChatStreamEvent[] = [
      {
        type: "chat.created",
        eventId: "created",
        requestId,
        offset: 0,
        userMessage: user,
        assistantMessage: assistant,
      },
      {
        type: "chat.delta",
        eventId: "delta",
        requestId,
        offset: 0,
        messageId: assistant.id,
        delta: "Evidence matters.",
      },
      {
        type: "chat.completed",
        eventId: "complete",
        requestId,
        offset: completed.content.length,
        message: completed,
      },
    ]
    const body = events
      .map((event) => `id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`)
      .join("")
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
        ),
    )
    const received: ChatStreamEvent[] = []

    await sessionApi.chat(
      sessionId,
      "What matters?",
      (event) => received.push(event),
      new AbortController().signal,
      requestId,
    )

    expect(received).toEqual(events)
  })

  it("rejects a chat stream that ends before a terminal event", async () => {
    const user = createMessage()
    const assistant = createMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      status: "streaming",
      completedAt: null,
    })
    const created: ChatStreamEvent = {
      type: "chat.created",
      eventId: "created",
      requestId,
      offset: 0,
      userMessage: user,
      assistantMessage: assistant,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`data: ${JSON.stringify(created)}\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    )

    await expect(
      sessionApi.chat(
        sessionId,
        "What matters?",
        () => {},
        new AbortController().signal,
        requestId,
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "The chat response was interrupted. Try again.",
    })
  })

  it("stops an aborted chat stream without reporting an interruption", async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start() {},
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      ),
    )

    const chat = sessionApi.chat(sessionId, "What matters?", () => {}, controller.signal, requestId)
    controller.abort()

    await expect(chat).resolves.toBeUndefined()
  })

  it("surfaces only the API safe error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "URL_NOT_ALLOWED",
            message: "That destination cannot be accessed safely.",
            retryable: false,
            requestId,
          },
          { status: 400 },
        ),
      ),
    )

    await expect(sessionApi.create("https://127.0.0.1")).rejects.toMatchObject({
      code: "URL_NOT_ALLOWED",
      message: "That destination cannot be accessed safely.",
    })
  })
})
