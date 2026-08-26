import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createSession } from "../../test/fixtures"
import { createTestApi, renderApp } from "../../test/render-app"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("completed summary actions", () => {
  it("copies the Markdown summary and downloads a safe Markdown file", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const createObjectUrl = vi.fn().mockReturnValue("blob:summary")
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    renderApp(createTestApi({ get: async () => session }), `/sessions/${session.id}`)

    expect(await screen.findByText("Summary ready.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith(session.summary)
    expect(screen.getByText("Summary copied")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Download Markdown" }))
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:summary")
  })

  it("opens chat with a predictable suggested question", async () => {
    const user = userEvent.setup()
    const session = createSession()
    renderApp(createTestApi({ get: async () => session }), `/sessions/${session.id}`)

    expect(
      await screen.findByText("Choose a question to open chat with it ready to send."),
    ).toBeVisible()
    await user.click(
      screen.getByRole("button", { name: "What are the three most important takeaways?" }),
    )
    expect(screen.getByRole("dialog", { name: "Chat about this summary" })).toBeVisible()
    expect(screen.getByRole("textbox", { name: "Ask about this summary" })).toHaveValue(
      "What are the three most important takeaways?",
    )
  })
})
