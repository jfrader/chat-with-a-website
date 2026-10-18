import { Button, InputGroup } from "@jfrader/ui"
import { ArrowUp, MessageCircle } from "lucide-react"
import { type FormEvent, useState } from "react"

export function SessionChatEntry({
  chatOpen,
  onOpenChat,
}: {
  chatOpen: boolean
  onOpenChat: (prompt?: string) => void
}) {
  const [draft, setDraft] = useState("")
  const prompt = draft.trim()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!prompt) return
    setDraft("")
    onOpenChat(prompt)
  }

  return (
    <form
      className={`absolute bottom-4 left-1/2 z-3 flex min-h-(--control-height) w-[min(440px,calc(100%-3rem))] -translate-x-1/2 transition-opacity duration-(--motion-duration-standard) ease-(--motion-easing-standard) ${chatOpen ? "pointer-events-none opacity-0" : ""}`}
      aria-hidden={chatOpen || undefined}
      inert={chatOpen}
      onSubmit={submit}
    >
      <InputGroup size="lg" sx={{ width: "100%", paddingInline: "var(--ui-space-1)" }}>
        <InputGroup.Addon placement="start">
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChat()}
            aria-label="Open empty chat"
            sx={{
              width: "var(--control-touch-target)",
              height: "var(--control-touch-target)",
              padding: 0,
            }}
          >
            <MessageCircle size={18} aria-hidden="true" />
          </Button>
        </InputGroup.Addon>
        <label className="sr-only" htmlFor="session-chat-entry">
          Ask about this summary
        </label>
        <InputGroup.Input
          id="session-chat-entry"
          type="text"
          maxLength={4_000}
          placeholder="Ask me about this summary…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <InputGroup.Addon placement="end">
          <Button
            type="submit"
            disabled={!prompt}
            aria-label="Open chat with question"
            sx={{
              width: "var(--control-touch-target)",
              height: "var(--control-touch-target)",
              padding: 0,
            }}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </Button>
        </InputGroup.Addon>
      </InputGroup>
    </form>
  )
}
