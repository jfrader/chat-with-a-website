import { EmptyState, Spinner } from "@jfrader/ui"
import { useEffect, useRef } from "react"
import { useStickToBottom } from "../../../hooks/use-stick-to-bottom"
import { useMessages } from "../hooks/session-queries"
import { ChatMessage } from "./chat-message"

export function ChatMessages({ enabled, sessionId }: { enabled: boolean; sessionId: string }) {
  const messages = useMessages(sessionId, enabled)
  const container = useRef<HTMLDivElement>(null)
  const stick = useStickToBottom(true)
  const messageCount = useRef(0)
  const items = messages.data ?? []

  useEffect(() => {
    const newMessageArrived = items.length !== messageCount.current
    messageCount.current = items.length
    if (newMessageArrived) stick.stuck.current = true
    stick.follow(container.current)
  })

  return (
    <div
      ref={container}
      className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-5 [scrollbar-color:var(--theme-scrollbar-thumb)_transparent]"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      onScroll={stick.handleScroll}
    >
      {messages.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-(--theme-text-muted)">
          <Spinner size="sm" decorative />
          <span>Loading conversation…</span>
        </div>
      ) : messages.error && !messages.data ? (
        <p className="m-0 text-xs leading-5.5 text-(--theme-text-danger)" role="alert">
          {messages.error.message}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Ask summary"
          sx={{ height: "100%", padding: 0 }}
          slotProps={{
            title: {
              css: {
                fontSize: "var(--ui-text-size-sm)",
                fontWeight: "normal",
                color: "var(--ui-color-text-muted)",
              },
            },
          }}
        />
      ) : (
        items.map((message) => <ChatMessage key={message.id} message={message} />)
      )}
    </div>
  )
}
