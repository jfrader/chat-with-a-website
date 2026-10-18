import type { MessageDto } from "@chat-with-a-website/contracts"
import { ChatMessage as Message, StreamingCaret } from "@jfrader/ui"
import styles from "./chat-panel.module.css"

export function ChatMessage({ message }: { message: MessageDto }) {
  const thoughtSeconds =
    message.reasoningMs === null ? undefined : Math.max(1, Math.round(message.reasoningMs / 1000))

  return (
    <Message
      author={message.role === "user" ? "You" : "Assistant"}
      aria-label={message.role === "user" ? "You" : "Assistant"}
      avatar={null}
      own={message.role === "user"}
      size="sm"
      offeredReactions={[]}
      readOnly
      sx={{ marginBlockEnd: "var(--ui-space-5)", minWidth: 0, overflowWrap: "anywhere" }}
      slotProps={{
        time: { css: { display: "none" } },
        receipt: { hidden: true },
        bubble: { css: { minWidth: 0, maxWidth: "100%" } },
      }}
    >
      {message.role === "assistant" && message.reasoningContent ? (
        <details className={`${styles.thought} mb-2`}>
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-(--theme-text-secondary)">
            <span>Thought</span>
            {thoughtSeconds === undefined ? null : (
              <span className="text-[11px] text-(--theme-text-dim)">{thoughtSeconds}s</span>
            )}
            <span className={`${styles.thoughtChevron} text-(--theme-text-dim)`} aria-hidden="true">
              ⌄
            </span>
          </summary>
          <p className="mt-2 mb-0 whitespace-pre-wrap text-(--theme-text-muted)">
            {message.reasoningContent}
          </p>
        </details>
      ) : null}
      <div className="whitespace-pre-wrap">
        {message.content || (message.status === "streaming" ? "Thinking…" : "")}
      </div>
      {message.status === "streaming" ? (
        <>
          <StreamingCaret size="sm" />
          <span className="sr-only">Assistant is responding</span>
        </>
      ) : null}
      {message.role === "assistant" && message.status === "complete" ? (
        <span className="sr-only">Assistant response complete</span>
      ) : null}
      {message.status === "failed" ? (
        <p className="mt-2 mb-0 text-[11px] text-(--theme-text-danger)">
          Response interrupted. The partial answer is preserved.
        </p>
      ) : null}
    </Message>
  )
}
