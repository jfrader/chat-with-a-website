import type { ChatStreamEvent, SummaryStreamEvent } from "@chat-with-a-website/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createMessage, createSession, requestId } from "../../../test/fixtures"
import { LocalSessionApi } from "./local-session-api"

const prefix = "chat-with-a-website:session:v2:"
const encode = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
const response = (events: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encode(event))
        controller.close()
      },
    }),
  )
const summary = (
  id: string,
  type: SummaryStreamEvent["type"] = "summary.completed",
  text = "Useful summary",
) => ({
  type,
  eventId: `${id}:${text.length}:${type}`,
  version: 1,
  offset: text.length,
  session: createSession({
    id,
    status: type === "summary.completed" ? "complete" : "summarizing",
    summary: text,
    sourceText: type === "summary.completed" ? "Original extracted source" : undefined,
  }),
  ...(type === "summary.delta" ? { delta: text } : {}),
})
const completeSession = async (api: LocalSessionApi) => {
  const session = await api.create("https://example.com/article")
  await api.stream(session.id, () => {}, new AbortController().signal)
  return session.id
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe("browser-owned sessions", () => {
  it.each(["RATE_LIMITED", "LLM_RATE_LIMITED", "LLM_UNAVAILABLE"])(
    "persists pre-stream %s without relabeling it as interruption",
    async (code) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json(
          { code, message: "Wait and retry.", retryable: true, requestId },
          { status: code === "LLM_UNAVAILABLE" ? 503 : 429 },
        ),
      )
      const api = new LocalSessionApi(() => localStorage, fetcher)
      const stub = await api.create("https://example.com/article")
      await expect(
        api.stream(stub.id, () => {}, new AbortController().signal),
      ).rejects.toMatchObject({ code, message: "Wait and retry." })
      expect(await api.get(stub.id)).toMatchObject({ status: "failed", failureCode: code })
    },
  )
  it("surfaces streamed provider exhaustion and retries the saved failed pair manually", async () => {
    let attempts = 0
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body))
      if (url === "/api/browser/summary") return response([summary(body.id)])
      attempts++
      const user = createMessage({
        id: crypto.randomUUID(),
        sessionId: body.session.id,
        requestId: body.request.idempotencyKey,
        content: body.request.content,
      })
      const assistant = createMessage({
        id: crypto.randomUUID(),
        sessionId: body.session.id,
        requestId: user.requestId,
        role: "assistant",
        status: "streaming",
        content: "",
      })
      const base = { eventId: "terminal", requestId: user.requestId, offset: 0 }
      const terminal =
        attempts === 1
          ? {
              ...base,
              type: "chat.failed",
              message: { ...assistant, status: "failed", failureCode: "LLM_RATE_LIMITED" },
              error: {
                code: "LLM_RATE_LIMITED",
                message: "Usage is limited. Wait 60 seconds and retry.",
                requestId,
                retryable: true,
              },
            }
          : {
              ...base,
              type: "chat.completed",
              message: { ...assistant, status: "complete", content: "Recovered" },
            }
      return response([
        {
          type: "chat.created",
          eventId: "created",
          requestId: user.requestId,
          offset: 0,
          userMessage: user,
          assistantMessage: assistant,
        },
        terminal,
      ])
    })
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const id = await completeSession(api)
    await expect(
      api.chat(id, "Question", () => {}, new AbortController().signal, requestId),
    ).rejects.toThrow("Wait 60 seconds and retry")
    expect((await api.messages(id)).at(-1)).toMatchObject({
      status: "failed",
      failureCode: "LLM_RATE_LIMITED",
    })
    await api.chat(id, "Question", () => {}, new AbortController().signal, requestId)
    expect(await api.messages(id)).toHaveLength(2)
    expect((await api.messages(id)).at(-1)).toMatchObject({
      status: "complete",
      content: "Recovered",
    })
    expect(attempts).toBe(2)
  })
  it("does not start compute for an abandoned effect subscription", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      response([summary(JSON.parse(String(init?.body)).id)]),
    )
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const session = await api.create("https://example.com/article")
    const abandoned = new AbortController()
    const first = api.stream(session.id, () => {}, abandoned.signal)
    abandoned.abort()
    const second = api.stream(session.id, () => {}, new AbortController().signal)
    await Promise.all([first, second])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await api.get(session.id)).status).toBe("complete")
  })
  it("creates only a stable local stub and streams before completion without per-token storage writes", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      return new Response(
        new ReadableStream({
          start(controller) {
            streamController = controller
            controller.enqueue(encode(summary(body.id, "summary.delta", "First")))
          },
        }),
      )
    })
    const writes = vi.spyOn(Storage.prototype, "setItem")
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const session = await api.create("https://example.com/article", requestId)
    expect(fetcher).not.toHaveBeenCalled()
    expect(session.id).toBe(requestId)
    expect((await api.create(session.originalUrl, requestId)).id).toBe(session.id)
    await expect(api.create("https://other.example/article", requestId)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    })
    const events: SummaryStreamEvent[] = []
    let progressed!: () => void
    const progress = new Promise<void>((resolve) => {
      progressed = resolve
    })
    const pending = api.stream(
      session.id,
      (event) => {
        events.push(event)
        progressed()
      },
      new AbortController().signal,
    )
    await progress
    expect(events[0]?.type).toBe("summary.delta")
    expect(writes).toHaveBeenCalledTimes(2)
    for (let index = 0; index < 10; index++)
      streamController.enqueue(encode(summary(session.id, "summary.delta", `Part ${index}`)))
    streamController.enqueue(encode(summary(session.id)))
    streamController.close()
    await pending
    expect(events.at(-1)?.type).toBe("summary.completed")
    expect(writes).toHaveBeenCalledTimes(4)
    const reloaded = new LocalSessionApi(() => localStorage, fetcher)
    expect(await reloaded.get(session.id)).toMatchObject({
      status: "complete",
      sourceText: "Original extracted source",
    })
    expect((await reloaded.list()).sessions).toHaveLength(1)
  })

  it("sends saved source and completed history after reload, replays idempotency locally", async () => {
    const sent: unknown[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body))
      sent.push(body)
      if (url === "/api/browser/summary") return response([summary(body.id)])
      const user = createMessage({
        id: crypto.randomUUID(),
        sessionId: body.session.id,
        requestId: body.request.idempotencyKey,
        content: body.request.content,
      })
      const assistant = createMessage({
        id: crypto.randomUUID(),
        sessionId: body.session.id,
        requestId: body.request.idempotencyKey,
        role: "assistant",
        status: "streaming",
        content: "",
      })
      return response([
        {
          type: "chat.created",
          eventId: "created",
          requestId: body.request.idempotencyKey,
          offset: 0,
          userMessage: user,
          assistantMessage: assistant,
        },
        {
          type: "chat.delta",
          eventId: "delta",
          requestId: body.request.idempotencyKey,
          offset: 0,
          messageId: assistant.id,
          delta: "Answer",
        },
        {
          type: "chat.completed",
          eventId: "completed",
          requestId: body.request.idempotencyKey,
          offset: 6,
          message: { ...assistant, status: "complete", content: "Answer" },
        },
      ])
    })
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const id = await completeSession(api)
    await api.chat(id, "Question", () => {}, new AbortController().signal, requestId)
    const reload = new LocalSessionApi(() => localStorage, fetcher)
    const events: ChatStreamEvent[] = []
    await reload.chat(
      id,
      "Question",
      (event) => events.push(event),
      new AbortController().signal,
      requestId,
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(events[0]?.type).toBe("chat.completed")
    await expect(
      reload.chat(id, "Different", () => {}, new AbortController().signal, requestId),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    await reload.chat(id, "Follow up", () => {}, new AbortController().signal)
    expect(sent.at(-1)).toMatchObject({
      session: { sourceText: "Original extracted source" },
      messages: [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Answer" },
      ],
    })
    expect(await reload.messages(id)).toHaveLength(4)
  })

  it("reads other tabs fresh, searches, paginates, regenerates and deletes locally", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      response([summary(JSON.parse(String(init?.body)).id)]),
    )
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const other = new LocalSessionApi(() => localStorage, fetcher)
    const first = await completeSession(api)
    await completeSession(other)
    expect((await api.list("useful", undefined, 1)).nextCursor).toBe("1")
    expect((await api.list("useful", "1", 1)).sessions).toHaveLength(1)
    const reset = await other.regenerate(first)
    expect(reset).toMatchObject({ id: first, status: "fetching", summary: "", attemptNumber: 2 })
    await other.stream(first, () => {}, new AbortController().signal)
    expect((await api.get(first)).status).toBe("complete")
    await other.delete(first)
    await expect(api.get(first)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
    expect((await api.list()).sessions).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("preserves corrupt/unsupported raw records and surfaces blocked or full storage", async () => {
    const id = crypto.randomUUID()
    localStorage.setItem(prefix + id, "{broken")
    const api = new LocalSessionApi(() => localStorage)
    await expect(api.list()).rejects.toThrow("Export site storage")
    await expect(api.get(id)).rejects.toThrow("Export site storage")
    await api.create("https://example.com/article")
    expect(localStorage.getItem(prefix + id)).toBe("{broken")
    localStorage.setItem("chat-with-a-website:local-sessions:v1", "legacy raw")
    await expect(api.create("https://example.com/article")).rejects.toThrow("Export site storage")
    expect(localStorage.getItem("chat-with-a-website:local-sessions:v1")).toBe("legacy raw")
    const blocked = new LocalSessionApi(() => {
      throw new DOMException("Blocked", "SecurityError")
    })
    await expect(blocked.list()).rejects.toThrow("Allow site storage")
    localStorage.clear()
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError")
    })
    await expect(api.create("https://example.com/article")).rejects.toThrow("Delete older sessions")
  })

  it("marks EOF and aborted partial summaries failed, including on reload", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      response([summary(JSON.parse(String(init?.body)).id, "summary.delta", "Partial")]),
    )
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const stub = await api.create("https://example.com/article")
    expect((await new LocalSessionApi(() => localStorage).get(stub.id)).status).toBe("failed")
    await expect(api.stream(stub.id, () => {}, new AbortController().signal)).rejects.toMatchObject(
      { code: "GENERATION_INTERRUPTED" },
    )
    expect(await api.get(stub.id)).toMatchObject({ status: "failed", summary: "Partial" })
    const second = await api.create("https://example.com/article")
    const controller = new AbortController()
    await expect(
      api.stream(second.id, () => controller.abort(), controller.signal),
    ).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    expect((await api.get(second.id)).status).toBe("failed")
  })

  it("does not resurrect deleted history or overwrite a newer regeneration with stale events", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const id = JSON.parse(String(init?.body)).id
      return response([summary(id, "summary.delta", "Old partial"), summary(id)])
    })
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const first = await api.create("https://example.com/article")
    const deleted = api.stream(
      first.id,
      () => {
        void api.delete(first.id)
      },
      new AbortController().signal,
    )
    await expect(deleted).rejects.toBeInstanceOf(Error)
    expect(localStorage.getItem(prefix + first.id)).toBeNull()
    const second = await api.create("https://example.com/article")
    let reset = false
    await expect(
      api.stream(
        second.id,
        () => {
          if (!reset) {
            reset = true
            void api.regenerate(second.id)
          }
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(Error)
    expect(await api.get(second.id)).toMatchObject({
      status: "fetching",
      summary: "",
      attemptNumber: 2,
    })
  })

  it("preserves a truthful partial chat after EOF and surfaces terminal storage failure", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body))
      if (url === "/api/browser/summary") return response([summary(body.id)])
      const user = createMessage({
        sessionId: body.session.id,
        requestId: body.request.idempotencyKey,
      })
      const assistant = createMessage({
        id: crypto.randomUUID(),
        sessionId: body.session.id,
        requestId: body.request.idempotencyKey,
        role: "assistant",
        status: "streaming",
        content: "",
      })
      return response([
        {
          type: "chat.created",
          eventId: "created",
          requestId: body.request.idempotencyKey,
          offset: 0,
          userMessage: user,
          assistantMessage: assistant,
        },
        {
          type: "chat.delta",
          eventId: "partial",
          requestId: body.request.idempotencyKey,
          offset: 0,
          messageId: assistant.id,
          delta: "Partial answer",
        },
      ])
    })
    const api = new LocalSessionApi(() => localStorage, fetcher)
    const id = await completeSession(api)
    await expect(
      api.chat(id, "Question", () => {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    expect((await new LocalSessionApi(() => localStorage).messages(id)).at(-1)).toMatchObject({
      status: "failed",
      content: "Partial answer",
      failureCode: "GENERATION_INTERRUPTED",
    })
    const stub = await api.create("https://example.com/article")
    const setItem = Storage.prototype.setItem
    let writes = 0
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      writes++
      if (writes > 1) throw new DOMException("Full", "QuotaExceededError")
      return setItem.call(localStorage, key, value)
    })
    await expect(api.stream(stub.id, () => {}, new AbortController().signal)).rejects.toThrow(
      "Delete older sessions",
    )
    expect((await new LocalSessionApi(() => localStorage).get(stub.id)).status).toBe("failed")
  })
})
