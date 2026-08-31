import type { ChatStreamEvent, SummaryStreamEvent } from "@profound/contracts"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MOBILE_LAYOUT_QUERY } from "../../app/media-queries"
import {
  assistantMessageId,
  createMessage,
  createSession,
  requestId,
  secondSessionId,
  sessionId,
} from "../../test/fixtures"
import { createTestApi, renderApp } from "../../test/render-app"
import { SessionApiError } from "../session/api/session-client"
import { sessionKeys } from "../session/hooks/session-queries"

afterEach(() => vi.unstubAllGlobals())

describe("workspace routing and history", () => {
  it("searches persisted history, reports no results, and selects a session route", async () => {
    const user = userEvent.setup()
    const first = createSession()
    const second = createSession({
      id: secondSessionId,
      title: "Research distribution systems",
      originalUrl: "https://example.com/distribution",
      canonicalUrl: "https://example.com/distribution",
      finalUrl: "https://example.com/distribution",
      host: "example.com",
    })
    const list = vi.fn(async (query = "") => ({
      sessions: [first, second].filter((session) =>
        `${session.title} ${session.host}`.toLowerCase().includes(query.toLowerCase()),
      ),
      nextCursor: null,
    }))
    const get = vi.fn(async (id: string) => (id === first.id ? first : second))
    const { router } = renderApp(createTestApi({ list, get }))

    const firstTitle = await screen.findByText("A field guide to AI visibility", {
      selector: "strong",
    })
    const firstButton = firstTitle.closest("button")
    if (!firstButton) throw new Error("Expected a session selection button")
    await user.click(firstButton)
    expect(await screen.findByRole("heading", { level: 1, name: first.title ?? "" })).toBeVisible()
    expect(router.state.location.pathname).toBe(`/sessions/${first.id}`)

    await user.click(screen.getByRole("button", { name: `Actions for ${first.title}` }))
    expect(screen.getByRole("button", { name: "Delete summary" })).toBeVisible()
    const secondTitle = screen.getByText(second.title ?? "", { selector: "strong" })
    const secondButton = secondTitle.closest("button")
    if (!secondButton) throw new Error("Expected a second session selection button")
    await user.click(secondButton)
    expect(screen.queryByRole("button", { name: "Delete summary" })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/sessions/${second.id}`)

    const search = screen.getByRole("searchbox", { name: "Search summaries" })
    await user.clear(search)
    await user.type(search, "missing")
    expect(await screen.findByText("No summaries match your search")).toBeVisible()
    expect(list).toHaveBeenCalledWith("missing")
    expect(router.state.location.search).toEqual({ query: "missing" })
  })

  it("confirms deletion, updates caches, and returns home after deleting the selected session", async () => {
    const user = userEvent.setup()
    const selected = createSession()
    let deleted = false
    const remove = vi.fn(async () => {
      deleted = true
    })
    const list = vi.fn(async () => ({ sessions: deleted ? [] : [selected], nextCursor: null }))
    const { router } = renderApp(
      createTestApi({ list, get: async () => selected, delete: remove }),
      `/sessions/${selected.id}`,
    )

    await screen.findByRole("heading", { level: 1, name: selected.title ?? "" })
    const menuTrigger = screen.getByRole("button", { name: `Actions for ${selected.title}` })
    await user.click(menuTrigger)
    await user.click(screen.getByRole("button", { name: "Delete summary" }))
    let dialog = screen.getByRole("alertdialog", { name: "Remove this summary?" })
    expect(dialog).toHaveTextContent("cannot be undone")
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    const confirm = within(dialog).getByRole("button", { name: "Delete" })
    await waitFor(() => expect(cancel).toHaveFocus())
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await waitFor(() => expect(menuTrigger).toHaveFocus())

    await user.click(menuTrigger)
    await user.click(screen.getByRole("button", { name: "Delete summary" }))
    dialog = screen.getByRole("alertdialog", { name: "Remove this summary?" })
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByRole("heading", { name: "Let’s get to it" })).toBeVisible()
    expect(remove).toHaveBeenCalledWith(selected.id)
    expect(router.state.location.pathname).toBe("/")
  })

  it("loads older persisted summaries from the next cursor page", async () => {
    const user = userEvent.setup()
    const newest = createSession()
    const older = createSession({
      id: secondSessionId,
      title: "An older summary",
      originalUrl: "https://example.com/older",
      canonicalUrl: "https://example.com/older",
      finalUrl: "https://example.com/older",
    })
    const list = vi.fn(async (_query = "", cursor?: string) =>
      cursor
        ? { sessions: [older], nextCursor: null }
        : { sessions: [newest], nextCursor: "next-page" },
    )
    renderApp(createTestApi({ list }))

    expect(await screen.findByText(newest.title ?? "", { selector: "strong" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Load older summaries" }))
    expect(await screen.findByText("An older summary", { selector: "strong" })).toBeVisible()
    expect(list).toHaveBeenLastCalledWith("", "next-page")
  })

  it("keeps history visible and reports a failed next page request", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const list = vi.fn(async (_query = "", cursor?: string) => {
      if (cursor) throw new Error("Older summaries could not be loaded")
      return { sessions: [session], nextCursor: "next-page" }
    })
    renderApp(createTestApi({ list }))

    expect(await screen.findByText(session.title ?? "", { selector: "strong" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Load older summaries" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Older summaries could not be loaded",
    )
    expect(screen.getByText(session.title ?? "", { selector: "strong" })).toBeVisible()
  })

  it("keeps cached history visible when a background refresh fails", async () => {
    const session = createSession()
    const list = vi
      .fn()
      .mockResolvedValueOnce({ sessions: [session], nextCursor: null })
      .mockRejectedValueOnce(new Error("History refresh failed"))
    const { queryClient } = renderApp(createTestApi({ list }))

    expect(await screen.findByText(session.title ?? "", { selector: "strong" })).toBeVisible()
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKeys.lists() })
    })

    expect(screen.getByText(session.title ?? "", { selector: "strong" })).toBeVisible()
    expect(screen.queryByText("History refresh failed")).not.toBeInTheDocument()
  })

  it("removes mobile dialog semantics when the viewport changes to desktop", async () => {
    const listeners = new Set<() => void>()
    let matches = true
    const mediaQuery = {
      get matches() {
        return matches
      },
      media: MOBILE_LAYOUT_QUERY,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as MediaQueryList
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQuery),
    )
    const user = userEvent.setup()
    renderApp(createTestApi())

    await user.click(await screen.findByRole("button", { name: "Open summary history" }))
    expect(screen.getByRole("dialog", { name: "Summary history" })).toHaveAttribute(
      "aria-modal",
      "true",
    )

    act(() => {
      matches = false
      for (const listener of listeners) listener()
    })

    expect(screen.queryByRole("dialog", { name: "Summary history" })).not.toBeInTheDocument()
    expect(screen.getByRole("complementary", { name: "Summary history" })).toBeVisible()
  })

  it("suggests an existing summary for an exactly matching URL without browser autocomplete", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const create = vi.fn()
    const list = vi.fn(async () => ({ sessions: [session], nextCursor: null }))
    const { router } = renderApp(createTestApi({ list, create, get: async () => session }))

    const input = await screen.findByRole("textbox", { name: "Webpage URL" })
    expect(input).toHaveAttribute("autocomplete", "off")
    await user.type(input, "tryprofound.com/article")

    const suggestions = await screen.findByRole("group", { name: "Suggestions" })
    expect(
      within(suggestions).getByRole("button", {
        name: "New summary for “tryprofound.com/article”",
      }),
    ).toBeVisible()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("group", { name: "Suggestions" })).not.toBeInTheDocument()
    await user.type(input, "{Backspace}e")

    const reopened = await screen.findByRole("group", { name: "Suggestions" })
    await user.click(within(reopened).getByRole("button", { name: /A field guide/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${session.id}`))
    expect(create).not.toHaveBeenCalled()
  })

  it("suggests a history session from a partial address without offering an invalid new summary", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const create = vi.fn()
    const list = vi.fn(async () => ({ sessions: [session], nextCursor: null }))
    const { router } = renderApp(createTestApi({ list, create, get: async () => session }))

    const input = await screen.findByRole("textbox", { name: "Webpage URL" })
    await user.type(input, "tryprof")

    const suggestions = await screen.findByRole("group", { name: "Suggestions" })
    expect(
      within(suggestions).queryByRole("button", { name: /New summary for/ }),
    ).not.toBeInTheDocument()
    await user.click(within(suggestions).getByRole("button", { name: /A field guide/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${session.id}`))
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects a dotless host on submission instead of recording a failed session", async () => {
    const user = userEvent.setup()
    const create = vi.fn()
    renderApp(createTestApi({ create }))

    await user.type(await screen.findByRole("textbox", { name: "Webpage URL" }), "truco")
    await user.click(screen.getByRole("button", { name: "Summarize" }))

    expect(screen.getByText("That doesn’t look like a webpage address.")).toBeVisible()
    expect(create).not.toHaveBeenCalled()
  })

  it("opens a suggested summary with the keyboard instead of creating a duplicate", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const create = vi.fn()
    const list = vi.fn(async () => ({ sessions: [session], nextCursor: null }))
    const { router } = renderApp(createTestApi({ list, create, get: async () => session }))

    await user.type(
      await screen.findByRole("textbox", { name: "Webpage URL" }),
      "https://tryprofound.com/article",
    )
    const suggestions = await screen.findByRole("group", { name: "Suggestions" })
    await user.keyboard("{ArrowDown}")
    expect(within(suggestions).getByRole("button", { name: /New summary for/ })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(within(suggestions).getByRole("button", { name: /A field guide/ })).toHaveFocus()
    await user.keyboard("{Enter}")

    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${session.id}`))
    expect(create).not.toHaveBeenCalled()
  })
})

describe("progressive summary and safe failures", () => {
  it("shows authoritative summary text before a terminal event arrives", async () => {
    const initial = createSession({
      summary: "",
      status: "summarizing",
      completedAt: null,
      outputTokens: null,
    })
    const partial = createSession({
      summary: "## Early finding\n\nThe streamed evidence is already readable.",
      status: "summarizing",
      completedAt: null,
      outputTokens: null,
    })
    const stream = vi.fn(
      async (_id: string, onEvent: (event: SummaryStreamEvent) => void, signal: AbortSignal) => {
        onEvent({
          type: "summary.delta",
          eventId: "1:0:delta",
          version: 1,
          offset: 0,
          delta: partial.summary,
          session: partial,
        })
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        )
      },
    )
    renderApp(
      createTestApi({
        list: async () => ({ sessions: [initial], nextCursor: null }),
        get: async () => initial,
        stream,
      }),
      `/sessions/${sessionId}`,
    )

    expect(await screen.findByRole("heading", { level: 2, name: "Early finding" })).toBeVisible()
    expect(screen.getByText("The streamed evidence is already readable.")).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("Generating the summary")
    expect(screen.queryByText("Summary ready.")).not.toBeInTheDocument()
  })

  it("fetches authoritative status after a summary stream disconnects", async () => {
    const active = createSession({
      summary: "",
      status: "summarizing",
      completedAt: null,
      outputTokens: null,
    })
    const failed = createSession({
      summary: "",
      status: "failed",
      failureCode: "GENERATION_INTERRUPTED",
      completedAt: new Date().toISOString(),
    })
    const get = vi.fn(async () => (get.mock.calls.length === 1 ? active : failed))
    const stream = vi.fn().mockRejectedValue(new Error("Stream disconnected"))
    renderApp(createTestApi({ get, stream }), `/sessions/${active.id}`)

    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t summarize this page")
  })

  it("preserves partial output when stream recovery cannot reach the API", async () => {
    const active = createSession({
      summary: "## Partial finding\n\nThis text remains available.",
      status: "summarizing",
      completedAt: null,
      outputTokens: null,
    })
    const get = vi
      .fn()
      .mockResolvedValueOnce(active)
      .mockRejectedValueOnce(new Error("Status check failed"))
    const stream = vi.fn().mockRejectedValue(new Error("Stream disconnected"))
    renderApp(createTestApi({ get, stream }), `/sessions/${active.id}`)

    expect(await screen.findByText("This text remains available.")).toBeVisible()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Live progress disconnected. Refresh to check the summary again.",
    )
    expect(screen.getByText("This text remains available.")).toBeVisible()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("keeps a cached summary visible when a background refresh fails", async () => {
    const session = createSession()
    const get = vi
      .fn()
      .mockResolvedValueOnce(session)
      .mockRejectedValueOnce(new Error("Summary refresh failed"))
    const { queryClient } = renderApp(createTestApi({ get }), `/sessions/${session.id}`)

    expect(
      await screen.findByRole("heading", { level: 1, name: session.title ?? "" }),
    ).toBeVisible()
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKeys.detail(session.id) })
    })

    expect(screen.getByRole("heading", { level: 1, name: session.title ?? "" })).toBeVisible()
    expect(screen.queryByText("Summary refresh failed")).not.toBeInTheDocument()
  })

  it("keeps safe create errors beside the URL composer", async () => {
    const user = userEvent.setup()
    const create = vi
      .fn()
      .mockRejectedValue(
        new SessionApiError("URL_NOT_ALLOWED", "That destination cannot be accessed safely."),
      )
    renderApp(createTestApi({ create }))

    await user.type(
      await screen.findByRole("textbox", { name: "Webpage URL" }),
      "https://127.0.0.1",
    )
    await user.click(screen.getByRole("button", { name: "Summarize" }))

    expect(await screen.findByText("That destination cannot be accessed safely.")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Let’s get to it" })).toBeVisible()
  })

  it("accepts a bare domain and submits it as an HTTPS URL", async () => {
    const user = userEvent.setup()
    const session = createSession({
      originalUrl: "https://example.com/",
      canonicalUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      host: "example.com",
    })
    const create = vi.fn(async () => session)
    renderApp(createTestApi({ create, get: async () => session }))

    await user.type(await screen.findByRole("textbox", { name: "Webpage URL" }), "example.com")
    await user.click(screen.getByRole("button", { name: "Summarize" }))

    expect(create).toHaveBeenCalledWith("https://example.com", expect.any(String))
  })

  it("shows plain-language feedback only after submitting malformed text", async () => {
    const user = userEvent.setup()
    const create = vi.fn()
    renderApp(createTestApi({ create }))

    const input = await screen.findByRole("textbox", { name: "Webpage URL" })
    await user.type(input, "not a web address")
    await user.tab()
    expect(screen.queryByText("That doesn’t look like a webpage address.")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Summarize" }))
    expect(screen.getByText("That doesn’t look like a webpage address.")).toBeVisible()
    expect(create).not.toHaveBeenCalled()
  })

  it("offers a retry when the summary detail fails to load", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue(session)
    const list = vi.fn(async () => ({ sessions: [session], nextCursor: null }))
    renderApp(createTestApi({ list, get }), `/sessions/${session.id}`)

    expect(await screen.findByText("This summary couldn’t be loaded")).toBeVisible()
    expect(screen.getByText("Failed to fetch")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Try again" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: session.title ?? "" }),
    ).toBeVisible()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("announces terminal summary failures", async () => {
    const failed = createSession({
      status: "failed",
      summary: "",
      failureCode: "LLM_UNAVAILABLE",
      completedAt: new Date().toISOString(),
    })
    renderApp(createTestApi({ get: async () => failed }), `/sessions/${failed.id}`)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("We couldn’t summarize this page")
    expect(alert).toHaveTextContent("summary provider is temporarily unavailable")
  })

  it("retries the same URL from a failed summary and replaces the failed session", async () => {
    const user = userEvent.setup()
    const failed = createSession({
      status: "failed",
      summary: "",
      failureCode: "FETCH_TIMEOUT",
      completedAt: new Date().toISOString(),
    })
    const retried = createSession({ id: secondSessionId })
    const create = vi.fn(async () => retried)
    const remove = vi.fn(async () => {})
    const get = vi.fn(async (id: string) => (id === failed.id ? failed : retried))
    const { router } = renderApp(
      createTestApi({
        create,
        get,
        delete: remove,
        list: async () => ({ sessions: [failed], nextCursor: null }),
      }),
      `/sessions/${failed.id}`,
    )

    await screen.findByText("We couldn’t summarize this page")
    await user.click(screen.getByRole("button", { name: "Try again" }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${retried.id}`))
    expect(create).toHaveBeenCalledWith(failed.originalUrl, expect.any(String))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(failed.id))
  })
})

describe("summary chat", () => {
  it("opens chat from the mobile header without using the click event as a prompt", async () => {
    const session = createSession()
    renderApp(createTestApi({ get: async () => session }), `/sessions/${session.id}`)

    fireEvent.click(await screen.findByRole("button", { name: "Open chat", hidden: true }))

    expect(await screen.findByRole("textbox", { name: "Ask about this summary" })).toHaveValue("")
  })

  it("opens chat from the summary composer and sends the question", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const chat = vi.fn(async () => {})
    renderApp(createTestApi({ get: async () => session, chat }), `/sessions/${session.id}`)

    const entry = await screen.findByRole("textbox", { name: "Ask about this summary" })
    await user.type(entry, "What should I verify next?")
    await user.click(screen.getByRole("button", { name: "Open chat with question" }))

    expect(screen.getByRole("dialog", { name: "Chat about this summary" })).toBeVisible()
    await waitFor(() =>
      expect(chat).toHaveBeenCalledWith(
        session.id,
        "What should I verify next?",
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(String),
      ),
    )
  })

  it("opens chat, sends a message, and renders streamed assistant text", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const userMessage = createMessage()
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
    let persistedMessages = [] as ReturnType<typeof createMessage>[]
    const chat = vi.fn(
      async (_id: string, _content: string, onEvent: (event: ChatStreamEvent) => void) => {
        onEvent({
          type: "chat.created",
          eventId: "created",
          requestId,
          offset: 0,
          userMessage,
          assistantMessage: assistant,
        })
        onEvent({
          type: "chat.delta",
          eventId: "delta",
          requestId,
          offset: 0,
          messageId: assistant.id,
          delta: "Evidence matters.",
        })
        const completed = {
          ...assistant,
          content: "Evidence matters.",
          status: "complete" as const,
          completedAt: "2026-08-26T12:01:03.000Z",
        }
        onEvent({
          type: "chat.completed",
          eventId: "completed",
          requestId,
          offset: 17,
          message: completed,
        })
        persistedMessages = [userMessage, completed]
      },
    )
    renderApp(
      createTestApi({
        list: async () => ({ sessions: [session], nextCursor: null }),
        get: async () => session,
        messages: async () => persistedMessages,
        chat,
      }),
      `/sessions/${session.id}`,
    )

    const chatTrigger = await screen.findByRole("button", { name: "Open empty chat" })
    await user.click(chatTrigger)
    const input = await screen.findByRole("textbox", { name: "Ask about this summary" })
    await user.type(input, "What matters most?")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(await screen.findByText("Evidence matters.")).toBeVisible()
    expect(screen.getByRole("log")).toHaveAttribute("aria-relevant", "additions")
    expect(screen.getByText("Assistant response complete")).toHaveClass("sr-only")
    expect(chat).toHaveBeenCalledWith(
      session.id,
      "What matters most?",
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(String),
    )
    await user.keyboard("{Escape}")
    expect(
      screen.queryByRole("dialog", { name: "Chat about this summary" }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(chatTrigger).toHaveFocus())
  })

  it("shows a collapsible Thought line only when a reply includes reasoning", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const answer = createMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "The answer.",
      reasoningContent: "Weighing the source evidence.",
      reasoningMs: 4_000,
    })
    renderApp(
      createTestApi({
        list: async () => ({ sessions: [session], nextCursor: null }),
        get: async () => session,
        messages: async () => [createMessage(), answer],
      }),
      `/sessions/${session.id}`,
    )

    await user.click(await screen.findByRole("button", { name: "Open empty chat" }))
    const thought = await screen.findByText("Thought")
    expect(screen.getByText("4s")).toBeVisible()
    expect(screen.getByText("Weighing the source evidence.")).not.toBeVisible()
    await user.click(thought)
    expect(screen.getByText("Weighing the source evidence.")).toBeVisible()
    expect(screen.queryAllByText("Thought")).toHaveLength(1)
  })

  it("keeps cached messages visible when a background refresh fails", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const answer = createMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "A cached answer",
      provider: "openai",
      model: "gpt-test",
      attemptId: "b37f7595-142b-42f8-afd1-7020760a9c5c",
    })
    const messages = vi
      .fn()
      .mockResolvedValueOnce([answer])
      .mockRejectedValueOnce(new Error("Conversation refresh failed"))
    const { queryClient } = renderApp(
      createTestApi({ get: async () => session, messages }),
      `/sessions/${session.id}`,
    )

    await user.click(await screen.findByRole("button", { name: "Open empty chat" }))
    expect(await screen.findByText("A cached answer")).toBeVisible()
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKeys.messages(session.id) })
    })

    expect(screen.getByText("A cached answer")).toBeVisible()
    expect(screen.queryByText("Conversation refresh failed")).not.toBeInTheDocument()
  })

  it("preserves partial failed answers with clear feedback", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const userMessage = createMessage()
    const failed = createMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "A partial answer",
      status: "failed",
      failureCode: "GENERATION_INTERRUPTED",
      provider: "openai",
      model: "gpt-test",
      attemptId: "b37f7595-142b-42f8-afd1-7020760a9c5c",
    })
    let persistedMessages = [] as ReturnType<typeof createMessage>[]
    const chat = vi.fn(
      async (_id: string, _content: string, onEvent: (event: ChatStreamEvent) => void) => {
        onEvent({
          type: "chat.created",
          eventId: "created",
          requestId,
          offset: 0,
          userMessage,
          assistantMessage: {
            ...failed,
            content: "",
            status: "streaming",
            failureCode: null,
            completedAt: null,
          },
        })
        onEvent({
          type: "chat.failed",
          eventId: "failed",
          requestId,
          offset: failed.content.length,
          message: failed,
          error: {
            code: "GENERATION_INTERRUPTED",
            message: "Generation was interrupted.",
            retryable: true,
            requestId,
          },
        })
        persistedMessages = [userMessage, failed]
      },
    )
    renderApp(
      createTestApi({
        list: async () => ({ sessions: [session], nextCursor: null }),
        get: async () => session,
        messages: async () => persistedMessages,
        chat,
      }),
      `/sessions/${session.id}`,
    )

    await user.click(await screen.findByRole("button", { name: "Open empty chat" }))
    await user.type(screen.getByRole("textbox", { name: "Ask about this summary" }), "Explain this")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(await screen.findByText("A partial answer")).toBeVisible()
    expect(screen.getByText("Response interrupted. The partial answer is preserved.")).toBeVisible()
  })

  it("reuses the idempotency key when a transport retry resends the same message", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const keys: string[] = []
    const chat = vi.fn(
      async (
        _id: string,
        _content: string,
        _onEvent: (event: ChatStreamEvent) => void,
        _signal: AbortSignal,
        idempotencyKey: string,
      ) => {
        keys.push(idempotencyKey)
        if (keys.length === 1) throw new Error("Connection interrupted")
      },
    )
    renderApp(
      createTestApi({
        list: async () => ({ sessions: [session], nextCursor: null }),
        get: async () => session,
        chat,
      }),
      `/sessions/${session.id}`,
    )

    await user.click(await screen.findByRole("button", { name: "Open empty chat" }))
    const input = screen.getByRole("textbox", { name: "Ask about this summary" })
    await user.type(input, "Retry this question")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect(await screen.findByText("Connection interrupted")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })
})
