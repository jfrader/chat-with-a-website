import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { createMessage, createSession } from "../../../test/fixtures"
import { createTestApi, renderApp } from "../../../test/render-app"
import { LocalSessionApi } from "../api/local-session-api"
import { ChatComposer } from "./chat-composer"
import { SessionApiProvider } from "./session-api-provider"
import { sessionKeys } from "../hooks/session-queries"

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
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

it("shows HTTP quota wait after URL submission, persists its code, and retries the same summary", async () => {
  let calls = 0
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    calls++
    if (calls === 1)
      return Response.json(
        {
          code: "RATE_LIMITED",
          message: "Too many requests. Wait and retry.",
          retryable: true,
          requestId: crypto.randomUUID(),
        },
        { status: 429, headers: { "Retry-After": "56" } },
      )
    const session = createSession({
      id: body.id,
      attemptNumber: body.attemptNumber,
      sourceText: "Source facts",
      summary: "Recovered quota summary",
    })
    return response([
      {
        type: "summary.completed",
        eventId: "done",
        version: 1,
        offset: session.summary.length,
        session,
      },
    ])
  })
  const api = new LocalSessionApi(() => localStorage, fetcher)
  const app = renderApp(api)
  const user = userEvent.setup()
  await user.type(
    await screen.findByRole("textbox", { name: "Webpage URL" }),
    "https://example.com/article",
  )
  await user.click(screen.getByRole("button", { name: "Summarize" }))
  expect(await screen.findByText("Too many requests. Wait 56 seconds and retry.")).toBeVisible()
  const failed = (await api.list()).sessions[0]
  if (!failed) throw new Error("Missing failed summary")
  expect(failed).toMatchObject({ status: "failed", failureCode: "RATE_LIMITED" })
  expect(app.router.state.location.pathname).toBe(`/sessions/${failed.id}`)
  await user.click(screen.getByRole("button", { name: "Retry summary" }))
  expect(await screen.findByText("Recovered quota summary")).toBeVisible()
  expect(await api.get(failed.id)).toMatchObject({ status: "complete", attemptNumber: 2 })
  expect((await api.list()).sessions).toHaveLength(1)
  expect(
    screen.queryByText("Too many requests. Wait 56 seconds and retry."),
  ).not.toBeInTheDocument()
})

it("keeps a typed streamed summary wait message through terminal cache rerenders", async () => {
  const message = "Usage is limited. Wait 59 seconds and retry."
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const session = createSession({
      id: body.id,
      status: "failed",
      summary: "",
      attemptNumber: body.attemptNumber,
      failureCode: "LLM_RATE_LIMITED",
    })
    return response([
      {
        type: "summary.failed",
        eventId: "failed",
        version: 1,
        offset: 0,
        session,
        error: {
          code: "LLM_RATE_LIMITED",
          message,
          requestId: crypto.randomUUID(),
          retryable: true,
        },
      },
    ])
  })
  const api = new LocalSessionApi(() => localStorage, fetcher)
  const stub = await api.create("https://example.com/article")
  const app = renderApp(api, `/sessions/${stub.id}`)
  expect(await screen.findByText(message)).toBeVisible()
  await act(async () => {
    app.queryClient.setQueryData(sessionKeys.detail(stub.id), { ...(await api.get(stub.id)) })
  })
  expect(screen.getByText(message)).toBeVisible()
  expect(await api.get(stub.id)).toMatchObject({ failureCode: "LLM_RATE_LIMITED" })
})

it("restores the composer draft after EOF and retries the failed pair without duplicates", async () => {
  const session = createSession({ sourceText: "Source facts" })
  localStorage.setItem(
    `chat-with-a-website:session:v2:${session.id}`,
    JSON.stringify({ version: 2, revision: crypto.randomUUID(), session, messages: [] }),
  )
  let requests = 0
  const keys: string[] = []
  let releaseRetry!: () => void
  const retryGate = new Promise<void>((resolve) => {
    releaseRetry = resolve
  })
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    requests++
    keys.push(body.request.idempotencyKey)
    const user = createMessage({
      id: crypto.randomUUID(),
      sessionId: session.id,
      requestId: body.request.idempotencyKey,
      content: body.request.content,
    })
    const assistant = createMessage({
      id: crypto.randomUUID(),
      sessionId: session.id,
      requestId: body.request.idempotencyKey,
      role: "assistant",
      status: "streaming",
      content: "",
    })
    const events: unknown[] = [
      {
        type: "chat.created",
        eventId: "created",
        requestId: user.requestId,
        offset: 0,
        userMessage: user,
        assistantMessage: assistant,
      },
      {
        type: "chat.delta",
        eventId: "delta",
        requestId: user.requestId,
        offset: 0,
        messageId: assistant.id,
        delta: requests === 1 ? "Partial" : "Recovered answer",
      },
    ]
    if (requests > 1)
      events.push({
        type: "chat.completed",
        eventId: "complete",
        requestId: user.requestId,
        offset: 16,
        message: { ...assistant, status: "complete", content: "Recovered answer" },
      })
    if (requests > 1) await retryGate
    return response(events)
  })
  const api = new LocalSessionApi(() => localStorage, fetcher)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <SessionApiProvider api={api}>
      <QueryClientProvider client={client}>
        <ChatComposer sessionId={session.id} />
      </QueryClientProvider>
    </SessionApiProvider>,
  )
  const user = userEvent.setup()
  const input = screen.getByRole("textbox", { name: "Ask about this summary" })
  await user.type(input, "Question")
  await user.click(screen.getByRole("button", { name: "Send message" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("interrupted")
  expect(input).toHaveValue("Question")
  const failed = await api.messages(session.id)
  expect(failed.at(-1)).toMatchObject({ status: "failed", content: "Partial" })
  await user.click(screen.getByRole("button", { name: "Send message" }))
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()
  expect((await api.messages(session.id)).at(-1)).toMatchObject({
    status: "failed",
    content: "Partial",
  })
  await expect(
    api.chat(session.id, "Question", () => {}, new AbortController().signal, keys[0]),
  ).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
  await act(async () => {
    releaseRetry()
  })
  await waitFor(() => expect(input).toHaveValue(""))
  await waitFor(async () =>
    expect((await api.messages(session.id)).at(-1)?.status).toBe("complete"),
  )
  const completed = await api.messages(session.id)
  expect(requests).toBe(2)
  expect(keys[1]).toBe(keys[0])
  expect(completed).toHaveLength(2)
  expect(new Set(completed.map((message) => message.id)).size).toBe(2)
  expect(completed[1]).toMatchObject({
    id: failed[1]?.id,
    status: "complete",
    content: "Recovered answer",
    attemptNumber: 2,
  })
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("reopens an interrupted partial summary and retries the same record to completion", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let requests = 0
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    requests++
    const session = createSession({
      id: body.id,
      status: requests === 1 ? "summarizing" : "complete",
      summary: requests === 1 ? "Partial summary" : "Recovered summary",
      sourceText: "Source facts",
      attemptNumber: body.attemptNumber,
    })
    const event = {
      type: requests === 1 ? "summary.delta" : "summary.completed",
      eventId: "summary",
      version: 1,
      offset: session.summary.length,
      session,
      ...(requests === 1 ? { delta: session.summary } : {}),
    }
    if (requests > 1) return response([event])
    return new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          controller = stream
          stream.enqueue(encode(event))
        },
      }),
    )
  })
  const api = new LocalSessionApi(() => localStorage, fetcher)
  const stub = await api.create("https://example.com/article")
  const app = renderApp(api, `/sessions/${stub.id}`)
  expect(await screen.findByText("Partial summary")).toBeVisible()
  await act(async () => {
    await app.router.navigate({ to: "/", search: {} })
  })
  await waitFor(async () => expect((await api.get(stub.id)).status).toBe("failed"))
  await act(async () => {
    await app.router.navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: stub.id },
      search: {},
    })
  })
  const retry = await screen.findByRole("button", { name: "Retry summary" })
  expect(screen.getByText("Partial summary")).toBeVisible()
  expect(retry).toBeEnabled()
  await userEvent.setup().click(retry)
  expect(await screen.findByText("Recovered summary")).toBeVisible()
  expect(await api.get(stub.id)).toMatchObject({
    id: stub.id,
    status: "complete",
    attemptNumber: 2,
  })
  expect((await api.list()).sessions).toHaveLength(1)
  expect(requests).toBe(2)
  expect(controller).toBeDefined()
})

it("shows retry errors and disables a pending keyboard-triggered summary retry", async () => {
  const failed = createSession({
    status: "failed",
    failureCode: "GENERATION_INTERRUPTED",
    summary: "Saved partial",
  })
  let release!: (session: ReturnType<typeof createSession>) => void
  const pending = new Promise<ReturnType<typeof createSession>>((resolve) => {
    release = resolve
  })
  const regenerate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Retry later."))
    .mockImplementationOnce(() => pending)
  renderApp(createTestApi({ get: async () => failed, regenerate }), `/sessions/${failed.id}`)
  const user = userEvent.setup()
  await user.click(await screen.findByRole("button", { name: "Retry summary" }))
  expect(await screen.findByText("Retry later.")).toBeVisible()
  const retry = screen.getByRole("button", { name: "Retry summary" })
  retry.focus()
  await user.keyboard("{Enter}")
  expect(await screen.findByRole("button", { name: "Retrying…" })).toBeDisabled()
  expect(screen.getByText("Saved partial")).toBeVisible()
  await act(async () => {
    release(createSession({ summary: "Recovered via keyboard" }))
  })
  expect(await screen.findByText("Recovered via keyboard")).toBeVisible()
  expect(regenerate).toHaveBeenCalledTimes(2)
  expect(screen.queryByText("Retry later.")).not.toBeInTheDocument()
})
