import { screen, waitFor } from "@testing-library/react"
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

    renderApp(
      createTestApi({
        list: async () => ({ sessions: [session], nextCursor: null }),
        get: async () => session,
      }),
      `/sessions/${session.id}`,
    )

    expect(await screen.findByText("Summary ready.")).toBeInTheDocument()
    const menuTrigger = await screen.findByRole("button", { name: `Actions for ${session.title}` })
    await user.click(menuTrigger)
    await user.click(screen.getByRole("button", { name: "Copy summary" }))
    expect(writeText).toHaveBeenCalledWith(session.summary)
    expect(screen.getByText("Summary copied")).toBeVisible()

    await user.click(menuTrigger)
    await user.click(screen.getByRole("button", { name: "Download Markdown" }))
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:summary")
  })

  it("opens chat and sends a suggested question automatically", async () => {
    const user = userEvent.setup()
    const session = createSession({
      suggestedPrompts: ["How does Profound measure AI visibility?"],
    })
    const chat = vi.fn(async () => {})
    renderApp(createTestApi({ get: async () => session, chat }), `/sessions/${session.id}`)

    expect(await screen.findByText("Choose a question to ask it in chat.")).toBeVisible()
    await user.click(
      screen.getByRole("button", { name: "How does Profound measure AI visibility?" }),
    )
    expect(screen.getByRole("dialog", { name: "Chat about this summary" })).toBeVisible()
    await waitFor(() =>
      expect(chat).toHaveBeenCalledWith(
        session.id,
        "How does Profound measure AI visibility?",
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(String),
      ),
    )
    expect(screen.getByRole("textbox", { name: "Ask about this summary" })).toHaveValue("")
  })

  it("regenerates the summary in place from the header button", async () => {
    const user = userEvent.setup()
    const session = createSession()
    const regenerated = { ...session, status: "fetching" as const, summary: "" }
    const regenerate = vi.fn(async () => regenerated)
    let current = session
    renderApp(
      createTestApi({
        get: async () => current,
        regenerate: async () => {
          const result = await regenerate()
          current = result
          return result
        },
      }),
      `/sessions/${session.id}`,
    )

    await user.click(await screen.findByRole("button", { name: "Regenerate summary" }))

    await waitFor(() => expect(regenerate).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.queryByText("Choose a question to ask it in chat.")).not.toBeInTheDocument(),
    )
    expect(screen.getByRole("heading", { name: session.title ?? "" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "Regenerate summary" })).not.toBeInTheDocument()
  })

  it("does not load remote images from generated Markdown", async () => {
    const session = createSession({
      summary: "## Diagram\n\n![Private network probe](http://127.0.0.1/admin)",
    })
    renderApp(createTestApi({ get: async () => session }), `/sessions/${session.id}`)

    expect(await screen.findByText("Image omitted: Private network probe")).toBeVisible()
    expect(screen.queryByRole("img", { name: "Private network probe" })).not.toBeInTheDocument()
  })
})
