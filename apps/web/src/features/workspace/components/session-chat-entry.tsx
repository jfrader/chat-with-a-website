import { type FormEvent, useState } from "react"
import { ComposerField } from "../../../components/composer-control/composer-field"
import { ComposerIconButton } from "../../../components/composer-control/composer-icon-button"
import { ChatIcon } from "../../../components/icons/chat-icon"

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
      className={`absolute bottom-4 left-1/2 z-3 flex h-(--control-height) w-[min(440px,calc(100%-3rem))] -translate-x-1/2 transition-opacity duration-(--motion-duration-standard) ease-(--motion-easing-standard) ${chatOpen ? "pointer-events-none opacity-0" : ""}`}
      aria-hidden={chatOpen || undefined}
      inert={chatOpen}
      onSubmit={submit}
    >
      <ComposerField variant="chat" className="backdrop-blur-(--blur-control)">
        <ComposerIconButton type="button" onClick={() => onOpenChat()} aria-label="Open empty chat">
          <ChatIcon />
        </ComposerIconButton>
        <label className="sr-only" htmlFor="session-chat-entry">
          Ask about this summary
        </label>
        <input
          id="session-chat-entry"
          type="text"
          maxLength={4_000}
          placeholder="Ask me about this summary…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <ComposerIconButton type="submit" disabled={!prompt} aria-label="Open chat with question">
          <span aria-hidden="true">↑</span>
        </ComposerIconButton>
      </ComposerField>
    </form>
  )
}
