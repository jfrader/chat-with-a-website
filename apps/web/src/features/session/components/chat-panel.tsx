import { type KeyboardEvent, useEffect, useRef } from "react"
import { Scrim } from "../../../components/scrim"
import { trapFocus } from "../../../components/trap-focus"
import { useSession } from "../hooks/session-queries"
import { ChatComposer } from "./chat-composer"
import { ChatMessages } from "./chat-messages"
import styles from "./chat-panel.module.css"

interface ChatPanelProps {
  initialPrompt?: string
  modal: boolean
  onClose: () => void
  open: boolean
  sessionId: string
}

export function ChatPanel({ initialPrompt, modal, onClose, open, sessionId }: ChatPanelProps) {
  const { data: session } = useSession(sessionId)
  const closeButton = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current && !initialPrompt) closeButton.current?.focus()
    wasOpen.current = open
  }, [open, initialPrompt])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (modal) trapFocus(event, event.currentTarget)
  }

  return (
    <>
      {modal && open ? <Scrim className="z-21" onClick={onClose} /> : null}
      <aside
        className={`${styles.panel} ${
          open
            ? "w-(--chat-panel-width) basis-(--chat-panel-width) border-(--theme-line-subtle-color) max-chat:translate-x-0"
            : "w-0 basis-0 border-transparent max-chat:translate-x-full"
        } relative z-6 flex h-full min-w-0 shrink-0 grow-0 flex-col overflow-hidden border-l bg-(--theme-surface-navigation) max-chat:fixed max-chat:inset-y-0 max-chat:right-0 max-chat:z-22 max-chat:h-svh max-chat:w-(--chat-panel-width) max-chat:flex-none max-chat:border-(--theme-line-subtle-color) max-chat:bg-(--theme-surface-navigation-solid) max-mobile:left-0 max-mobile:w-full`}
        aria-label="Chat about this summary"
        aria-modal={(modal && open) || undefined}
        aria-hidden={!open || undefined}
        inert={!open}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <header className="flex min-h-16 items-center justify-between border-b border-(--theme-line-subtle-color) px-4 py-2 max-mobile:min-h-14 max-mobile:pr-2 max-mobile:pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span aria-hidden="true">✦</span>
            <h2 className="m-0 text-sm font-semibold">Chat</h2>
            {session ? (
              <span className="ml-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-(--theme-text-muted)">
                {session.title ?? session.host}
              </span>
            ) : null}
          </div>
          <button
            ref={closeButton}
            className="size-(--control-touch-target) cursor-pointer border-0 bg-transparent text-(--theme-text-muted)"
            type="button"
            onClick={onClose}
            aria-label="Close chat"
          >
            ×
          </button>
        </header>
        <ChatMessages enabled={open} sessionId={sessionId} />
        <ChatComposer sessionId={sessionId} {...(initialPrompt ? { initialPrompt } : {})} />
      </aside>
    </>
  )
}
