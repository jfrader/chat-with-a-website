import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { FollowUpSkeleton } from "./follow-up-skeleton"
import { OpeningSummary } from "./opening-summary"
import { SessionFailureButton } from "./session-failure-button"
import { SessionFailureView } from "./session-failure-view"
import { SummaryActionButton } from "./summary-action-button"

describe("presentation primitives", () => {
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
        <SummaryActionButton onClick={followUp}>What should I read next?</SummaryActionButton>
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
