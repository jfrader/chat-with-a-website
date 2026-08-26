import type { SessionDto } from "@profound/contracts"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SessionApiError, type SessionApi } from "../session/session-client"
import { WorkspaceShell } from "./workspace-shell"

const attemptId = "2cd772f1-4a4e-48f1-b5a9-b9ac1e956ccd"
const recoveredAttemptId = "3de88302-5b5f-40f2-a6ba-cab6e07c3dde"

function createSession(overrides: Partial<SessionDto> = {}): SessionDto {
  return {
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
    attemptId,
    attemptNumber: 1,
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:00.000Z",
    completedAt: null,
    ...overrides,
  }
}

function createApi(
  created: SessionDto,
  stream: SessionApi["stream"] = async () => {},
  latest = created,
): SessionApi {
  return {
    create: vi.fn().mockResolvedValue(created),
    get: vi.fn().mockResolvedValue(latest),
    stream: vi.fn(stream),
  }
}

describe("empty workspace shell", () => {
  it("presents the designed empty state", () => {
    render(<WorkspaceShell />)

    expect(screen.getByRole("heading", { name: "Let’s get to it" })).toBeVisible()
    expect(
      screen.getByText("Paste a URL to summarize and understand any content instantly"),
    ).toBeVisible()
    expect(screen.getByText("No summaries yet")).toBeVisible()
    expect(screen.getByPlaceholderText("https://example.com")).toBeVisible()
    expect(screen.getByRole("button", { name: "Summarize" })).toBeDisabled()
    expect(screen.queryByText("Chat")).not.toBeInTheDocument()
  })

  it("shows inline validation for malformed URLs", async () => {
    const user = userEvent.setup()
    render(<WorkspaceShell />)

    const input = screen.getByRole("textbox", { name: "Webpage URL" })
    await user.type(input, "not a url")
    await user.tab()

    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Enter a complete http or https URL.")).toBeVisible()
  })

  it("starts a real session and presents the generating state", async () => {
    const user = userEvent.setup()
    const processingSession = createSession({
      title: "Profound vs 7 Top AI Visibility Platforms",
      status: "summarizing",
    })
    const api = createApi(
      createSession(),
      async (_id, onEvent, signal) => {
        onEvent({ type: "stage.changed", attemptId, stage: "summarizing" })
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()))
      },
      processingSession,
    )
    render(<WorkspaceShell api={api} />)

    await user.type(screen.getByRole("textbox", { name: "Webpage URL" }), "https://tryprofound.com")

    const submit = screen.getByRole("button", { name: "Summarize" })
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(api.create).toHaveBeenCalledWith("https://tryprofound.com", expect.any(String))
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Profound vs 7 Top AI Visibility Platforms",
      }),
    ).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("Generating the summary")
    expect(screen.getByText("https://tryprofound.com")).toBeVisible()
    expect(api.stream).toHaveBeenCalled()
  })

  it("applies a streamed completion and starts another summary", async () => {
    const user = userEvent.setup()
    const processingSession = createSession()
    const completedSession = createSession({
      finalUrl: "https://tryprofound.com/",
      title: "AI visibility starts with answer engine insights",
      description: "Understand how your brand appears in AI answers.",
      summary: "Profound measures brand visibility across answer engines.",
      status: "complete",
      sourceWordCount: 640,
      provider: "local",
      model: "extractive-v1",
      completedAt: "2026-08-26T12:00:02.000Z",
    })
    const api = createApi(
      processingSession,
      async (_id, onEvent) => {
        onEvent({ type: "session.completed", attemptId, session: completedSession })
      },
      completedSession,
    )
    render(<WorkspaceShell api={api} />)

    await user.type(screen.getByRole("textbox", { name: "Webpage URL" }), "https://tryprofound.com")
    await user.click(screen.getByRole("button", { name: "Summarize" }))

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "AI visibility starts with answer engine insights",
      }),
    ).toBeVisible()
    expect(
      screen.getByText("Profound measures brand visibility across answer engines."),
    ).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("Summary ready.")

    await user.click(screen.getByRole("button", { name: "Start a new summary" }))
    expect(screen.getByRole("heading", { name: "Let’s get to it" })).toBeVisible()
  })

  it("reconnects live progress after a nonterminal stream closes", async () => {
    const user = userEvent.setup()
    const processingSession = createSession()
    const completedSession = createSession({
      status: "complete",
      title: "Recovered summary",
      summary: "The reconnected stream delivered the result.",
      completedAt: "2026-08-26T12:00:02.000Z",
      updatedAt: "2026-08-26T12:00:02.000Z",
    })
    let streamCalls = 0
    const api = createApi(processingSession, async (_id, onEvent) => {
      streamCalls += 1
      if (streamCalls === 2) {
        onEvent({ type: "session.completed", attemptId, session: completedSession })
      }
    })
    render(<WorkspaceShell api={api} />)

    await user.type(screen.getByRole("textbox", { name: "Webpage URL" }), "https://tryprofound.com")
    await user.click(screen.getByRole("button", { name: "Summarize" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "Recovered summary" }),
    ).toBeVisible()
    await waitFor(() => expect(api.stream).toHaveBeenCalledTimes(2))
  })

  it("does not let a stale metadata response replace terminal state", async () => {
    const user = userEvent.setup()
    const processingSession = createSession({
      status: "summarizing",
      attemptId: recoveredAttemptId,
      attemptNumber: 2,
    })
    const staleMetadata = createSession({
      status: "complete",
      title: "Stale completed metadata",
      completedAt: "2026-08-26T12:00:01.000Z",
      updatedAt: "2026-08-26T12:00:01.000Z",
    })
    const completedSession = createSession({
      status: "complete",
      title: "Current completed summary",
      summary: "Terminal state wins.",
      attemptId: recoveredAttemptId,
      attemptNumber: 2,
      completedAt: "2026-08-26T12:00:02.000Z",
      updatedAt: "2026-08-26T12:00:02.000Z",
    })
    let resolveMetadata: (session: SessionDto) => void = () => undefined
    const metadata = new Promise<SessionDto>((resolve) => {
      resolveMetadata = resolve
    })
    const api = createApi(processingSession, async (_id, onEvent) => {
      onEvent({ type: "stage.changed", attemptId: recoveredAttemptId, stage: "summarizing" })
      onEvent({
        type: "session.completed",
        attemptId: recoveredAttemptId,
        session: completedSession,
      })
      resolveMetadata(staleMetadata)
    })
    vi.mocked(api.get).mockImplementationOnce(() => metadata)
    render(<WorkspaceShell api={api} />)

    await user.type(screen.getByRole("textbox", { name: "Webpage URL" }), "https://tryprofound.com")
    await user.click(screen.getByRole("button", { name: "Summarize" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "Current completed summary" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { level: 1, name: "Stale completed metadata" }),
    ).not.toBeInTheDocument()
  })

  it("keeps safe API failures in the composer", async () => {
    const user = userEvent.setup()
    const api = createApi(createSession())
    vi.mocked(api.create).mockRejectedValue(
      new SessionApiError("URL_NOT_ALLOWED", "That destination cannot be accessed safely.", false),
    )
    render(<WorkspaceShell api={api} />)

    await user.type(screen.getByRole("textbox", { name: "Webpage URL" }), "https://127.0.0.1")
    await user.click(screen.getByRole("button", { name: "Summarize" }))

    expect(await screen.findByText("That destination cannot be accessed safely.")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Let’s get to it" })).toBeVisible()

    const firstKey = vi.mocked(api.create).mock.calls[0]?.[1]
    await user.click(screen.getByRole("button", { name: "Summarize" }))
    expect(vi.mocked(api.create).mock.calls[1]?.[1]).toBe(firstKey)
  })

  it("collapses and restores the history rail", async () => {
    const user = userEvent.setup()
    render(<WorkspaceShell />)

    await user.click(screen.getByRole("button", { name: "Collapse summary history" }))
    const expandButton = screen.getByRole("button", { name: "Expand summary history" })
    expect(expandButton).toHaveAttribute("aria-expanded", "false")

    await user.click(expandButton)
    expect(screen.getByRole("button", { name: "Collapse summary history" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })
})
