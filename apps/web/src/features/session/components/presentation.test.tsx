import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { createMessage } from "../../../test/fixtures"
import { ChatMessage } from "./chat-message"
import { FollowUpSkeleton } from "./follow-up-skeleton"
import { OpeningSummary } from "./opening-summary"
import { SessionFailureButton } from "./session-failure-button"
import { SessionFailureView } from "./session-failure-view"
import { Button } from "@jfrader/ui"
import { SummaryMarkdown } from "./summary-markdown"
import { SummaryProgress } from "./summary-progress"

describe("presentation primitives", () => {
  it("keeps reasoning open and the message mounted across streaming updates", async () => {
    const user = userEvent.setup()
    const message = createMessage({
      role: "assistant",
      status: "streaming",
      content: "Partial answer",
      reasoningContent: "Check the source",
      reasoningMs: 4_000,
    })
    const { rerender } = render(<ChatMessage message={message} />)
    const article = screen.getByRole("article", { name: "Assistant" })
    const reasoning = screen.getByText("Thought").closest("details")
    await user.click(screen.getByText("Thought"))
    expect(reasoning).toHaveAttribute("open")
    expect(screen.getByText("4s")).toBeVisible()
    expect(screen.getByText("Assistant is responding")).toBeInTheDocument()

    rerender(<ChatMessage message={{ ...message, content: "Partial answer continued" }} />)
    expect(screen.getByRole("article", { name: "Assistant" })).toBe(article)
    expect(screen.getByText("Thought").closest("details")).toBe(reasoning)
    expect(reasoning).toHaveAttribute("open")

    rerender(<ChatMessage message={{ ...message, status: "failed" }} />)
    expect(screen.queryByText("Assistant is responding")).not.toBeInTheDocument()
    expect(screen.getByText("Partial answer")).toBeVisible()
    expect(screen.getByText("Response interrupted. The partial answer is preserved.")).toBeVisible()

    rerender(<ChatMessage message={{ ...message, status: "complete" }} />)
    expect(screen.getByText("Assistant response complete")).toBeInTheDocument()
    expect(screen.queryByText("Assistant is responding")).not.toBeInTheDocument()
  })

  it("keeps chat body as plain text with no avatars or reaction actions", () => {
    const { container } = render(
      <ChatMessage
        message={createMessage({ role: "user", content: "**plain** [link](https://example.com)" })}
      />,
    )
    expect(screen.getByRole("article", { name: "You" })).toHaveAttribute("data-own", "true")
    expect(screen.getByText("**plain** [link](https://example.com)")).toBeVisible()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(container.querySelector('[data-ui="chat-message-avatar"]')).toBeNull()
  })

  it("keeps Markdown link policy and image suppression inside Prose", () => {
    const { container } = render(
      <SummaryMarkdown
        streaming
        summary={
          "[Source](https://example.com)\n\n![Diagram](https://example.com/image.png)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"
        }
      />,
    )
    expect(screen.getByRole("link", { name: /Source\s*\(opens in a new tab\)/ })).toHaveAttribute(
      "target",
      "_blank",
    )
    expect(screen.getByRole("link")).toHaveAttribute("rel", "noreferrer noopener")
    expect(screen.getByText("Image omitted: Diagram")).toBeVisible()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByRole("table").closest('[data-ui="prose"]')).toHaveAttribute(
      "data-streaming",
      "true",
    )
    expect(container.querySelector("img")).toBeNull()
  })

  it("keeps one summary progress announcement with a decorative caret", () => {
    const { container, rerender } = render(<SummaryProgress status="summarizing" />)
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(container.querySelector('[data-ui="streaming-caret"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    rerender(<SummaryProgress status="complete" />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("keeps one opening status announcement", () => {
    render(<OpeningSummary />)

    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(screen.getByRole("status")).toHaveTextContent("Opening summary…")
  })

  it("preserves failure alert and heading names", () => {
    render(
      <SessionFailureView
        label="Summary unavailable"
        title="We couldn’t summarize this page"
        message="The webpage could not be reached."
        actions={<SessionFailureButton>Retry summary</SessionFailureButton>}
      />,
    )

    expect(screen.getByRole("alert", { name: "We couldn’t summarize this page" })).toBeVisible()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "We couldn’t summarize this page",
    )
    expect(screen.getByRole("button", { name: "Retry summary" })).toBeEnabled()
  })

  it("retains native disabled actions and keyboard focus order", async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const followUp = vi.fn()
    render(
      <>
        <SessionFailureButton disabled onClick={retry}>
          Retry summary
        </SessionFailureButton>
        <Button variant="outline" onClick={followUp}>
          What should I read next?
        </Button>
      </>,
    )

    expect(screen.getByRole("button", { name: "Retry summary" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Retry summary" }))
    expect(retry).not.toHaveBeenCalled()
    await user.tab()
    expect(screen.getByRole("button", { name: "What should I read next?" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(followUp).toHaveBeenCalledOnce()
  })

  it("keeps follow-up placeholders decorative", () => {
    render(<FollowUpSkeleton />)

    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.getByText("Writing follow-up questions…").closest("section")).toHaveAttribute(
      "aria-hidden",
      "true",
    )
  })
})
