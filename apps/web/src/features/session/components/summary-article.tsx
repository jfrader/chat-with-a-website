import { useEffect, useRef } from "react"
import { ChatIcon } from "../../../components/icons/chat-icon"
import { RegenerateIcon } from "../../../components/icons/regenerate-icon"
import { useStickToBottom } from "../../../hooks/use-stick-to-bottom"
import { useRegenerateSession, useSession } from "../hooks/session-queries"
import { FollowUpSkeleton } from "./follow-up-skeleton"
import { FollowUpSuggestions } from "./follow-up-suggestions"
import styles from "./summary-article.module.css"
import { SummaryFooter } from "./summary-footer"
import { SummaryHeader } from "./summary-header"
import { SummaryMarkdown } from "./summary-markdown"
import { SummaryProgress } from "./summary-progress"

interface SummaryArticleProps {
  chatOpen: boolean
  connectionError?: string
  onOpenChat: (prompt?: string) => void
  onReset: () => void
  onToggleChat: () => void
  sessionId: string
}

export function SummaryArticle({
  chatOpen,
  connectionError,
  onOpenChat,
  onReset,
  onToggleChat,
  sessionId,
}: SummaryArticleProps) {
  const { data: session } = useSession(sessionId)
  const regenerate = useRegenerateSession(sessionId)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useStickToBottom(false)
  const terminal = !session || session.status === "complete" || session.status === "failed"

  useEffect(() => {
    if (!terminal) stick.follow(scroller.current)
  })

  if (!session) return null

  return (
    <>
      {session.status === "complete" ? (
        <div className={`${styles.articleActions} flex max-mobile:hidden`}>
          <button
            type="button"
            aria-label="Regenerate summary"
            title="Regenerate summary"
            disabled={regenerate.isPending}
            onClick={() => regenerate.mutate()}
          >
            <RegenerateIcon />
          </button>
          <button
            className={`${styles.chatToggle} ${chatOpen ? styles.chatToggleHidden : ""}`}
            type="button"
            aria-label="Show chat"
            title="Show chat"
            aria-hidden={chatOpen || undefined}
            inert={chatOpen}
            onClick={onToggleChat}
          >
            <ChatIcon />
          </button>
        </div>
      ) : null}
      <div
        ref={scroller}
        className="scrollbar-thin h-full w-full overflow-y-auto"
        onScroll={stick.handleScroll}
      >
        <article
          className="mx-auto w-full max-w-164 pt-12.5 pb-24 max-content:px-8 max-mobile:px-6 max-mobile:pt-10 max-mobile:pb-22"
          aria-labelledby="session-title"
        >
          {session.status === "complete" ? (
            <p className="sr-only" role="status">
              Summary ready.
            </p>
          ) : null}
          <SummaryHeader session={session} />
          <SummaryProgress status={session.status} />
          <SummaryMarkdown streaming={!terminal} summary={session.summary} />
          {connectionError ? (
            <p
              className="mt-6 flex flex-col gap-1 border-y border-(--theme-line-subtle-color) py-4 text-xs leading-5.5 text-(--theme-text-danger)"
              role="alert"
            >
              {connectionError}
            </p>
          ) : null}
          {session.status === "failed" ? (
            <div
              className="mt-6 flex flex-col gap-1 border-y border-(--theme-line-subtle-color) py-4 text-xs leading-5.5 text-(--theme-text-danger)"
              role="alert"
            >
              <strong>Summary interrupted</strong>
              <span>The partial summary is preserved. Start a new summary to try again.</span>
            </div>
          ) : null}
          {session.status === "complete" ? (
            <FollowUpSuggestions prompts={session.suggestedPrompts} onOpenChat={onOpenChat} />
          ) : session.status === "summarizing" ? (
            <FollowUpSkeleton />
          ) : null}
          <SummaryFooter session={session} onReset={onReset} />
        </article>
      </div>
    </>
  )
}
