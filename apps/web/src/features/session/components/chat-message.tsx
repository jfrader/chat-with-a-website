import type { MessageDto } from "@chat-with-a-website/contracts"
import { StreamingCaret } from "../../../components/activity-indicator/streaming-caret"
import styles from "./chat-panel.module.css"

const messageClasses: Record<MessageDto["role"], string> = {
  assistant: "mr-auto",
  user: `${styles.user} ml-auto px-4 py-3`,
}

export function ChatMessage({ message }: { message: MessageDto }) {
  const thoughtSeconds =
    message.reasoningMs === null ? undefined : Math.max(1, Math.round(message.reasoningMs / 1000))

  return (
    <article
      className={`relative mb-5 max-w-70 text-xs leading-5.5 text-(--theme-text-primary) ${messageClasses[message.role]}`}
    >
      <p className="sr-only">{message.role === "user" ? "You" : "Assistant"}</p>
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
          <StreamingCaret inline />
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
    </article>
  )
}
