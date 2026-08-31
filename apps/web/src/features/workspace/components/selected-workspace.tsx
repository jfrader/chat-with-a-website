import { useNavigate } from "@tanstack/react-router"
import { type RefObject, useRef, useState } from "react"
import { CHAT_OVERLAY_QUERY } from "../../../app/media-queries"
import { useMediaQuery } from "../../../hooks/use-media-query"
import { ChatPanel } from "../../session/components/chat-panel"
import { SessionWorkspace } from "../../session/components/session-workspace"
import { useRegenerateSession, useSession } from "../../session/hooks/session-queries"
import { MobileHeader } from "./mobile-header"
import { SessionChatEntry } from "./session-chat-entry"

export function SelectedWorkspace({
  historyOpen,
  historyTriggerRef,
  onOpenHistory,
  sessionId,
}: {
  historyOpen: boolean
  historyTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenHistory: () => void
  sessionId: string
}) {
  const navigate = useNavigate()
  const detail = useSession(sessionId)
  const chatOverlay = useMediaQuery(CHAT_OVERLAY_QUERY)
  const regenerate = useRegenerateSession(sessionId)
  const [chatOpen, setChatOpen] = useState(false)
  const [suggestedPrompt, setSuggestedPrompt] = useState<string>()
  const chatTriggerRef = useRef<HTMLElement>(null)

  function openChat(prompt?: string) {
    if (document.activeElement instanceof HTMLElement) {
      chatTriggerRef.current = document.activeElement
    }
    setSuggestedPrompt(prompt)
    setChatOpen(true)
  }

  function closeChat() {
    setChatOpen(false)
    setSuggestedPrompt(undefined)
    requestAnimationFrame(() => chatTriggerRef.current?.focus())
  }

  function reset() {
    void navigate({ to: "/", search: {} })
  }

  const modalOpen = historyOpen || (chatOverlay && chatOpen)

  return (
    <>
      <div
        className="min-w-0 min-h-0 flex flex-1 flex-col"
        aria-hidden={modalOpen || undefined}
        inert={modalOpen}
      >
        <MobileHeader
          canChat={detail.data?.status === "complete"}
          historyTriggerRef={historyTriggerRef}
          onOpenChat={openChat}
          onOpenHistory={onOpenHistory}
          onRegenerate={() => regenerate.mutate()}
          regenerating={regenerate.isPending}
        />
        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <SessionWorkspace
            sessionId={sessionId}
            chatOpen={chatOpen}
            onOpenChat={openChat}
            onReset={reset}
            onToggleChat={() => (chatOpen ? closeChat() : openChat())}
          />
          {detail.data?.status === "complete" ? (
            <SessionChatEntry chatOpen={chatOpen} onOpenChat={openChat} />
          ) : null}
        </main>
      </div>
      {detail.data?.status === "complete" ? (
        <ChatPanel
          open={chatOpen}
          modal={chatOverlay}
          sessionId={sessionId}
          {...(suggestedPrompt ? { initialPrompt: suggestedPrompt } : {})}
          onClose={closeChat}
        />
      ) : null}
    </>
  )
}
