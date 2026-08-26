import type { SessionDto, SessionStage } from "@profound/contracts"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useSession } from "./session-queries"
import styles from "./summary-article.module.css"

const stageLabels: Record<SessionStage, string> = {
  fetching: "Fetching the webpage",
  extracting: "Extracting readable content",
  summarizing: "Generating the summary",
}

const suggestions = [
  "What are the three most important takeaways?",
  "What evidence supports the main argument?",
  "What should I read or verify next?",
]

interface SummaryArticleProps {
  connectionError?: string
  onOpenChat: (prompt?: string) => void
  onReset: () => void
  sessionId: string
}

function safeSourceUrl(session: SessionDto) {
  const value = session.finalUrl ?? session.canonicalUrl
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

function filenameFor(session: SessionDto) {
  const base = (session.title ?? session.host)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
  return `${base || "summary"}.md`
}

function SummaryHeader({ onOpenChat, session }: { onOpenChat: () => void; session: SessionDto }) {
  const [copyFeedback, setCopyFeedback] = useState<string>()
  const sourceUrl = safeSourceUrl(session)
  const title = session.title ?? session.host

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(session.summary)
      setCopyFeedback("Summary copied")
    } catch {
      setCopyFeedback("Copy failed. Select the summary text to copy it manually.")
    }
    window.setTimeout(() => setCopyFeedback(undefined), 2_000)
  }

  function downloadSummary() {
    const markdown = `# ${title}\n\nSource: ${sourceUrl ?? session.originalUrl}\n\n${session.summary}\n`
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = filenameFor(session)
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <header className={styles.header}>
      <div className={styles.sourceMeta}>
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            {session.siteName ?? session.host}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span>{session.siteName ?? session.host}</span>
        )}
        {session.sourceWordCount > 0 ? (
          <span>{session.sourceWordCount.toLocaleString()} source words</span>
        ) : null}
      </div>
      <h1
        className="text-[var(--font-size-title)] leading-8 max-[720px]:text-2xl"
        id="session-title"
      >
        {title}
      </h1>
      {session.description ? <p className={styles.description}>{session.description}</p> : null}
      <fieldset className={styles.actions}>
        <legend className="sr-only">Summary actions</legend>
        <button type="button" onClick={copySummary}>
          Copy
        </button>
        <button type="button" onClick={downloadSummary}>
          Download Markdown
        </button>
        {session.status === "complete" ? (
          <button type="button" onClick={onOpenChat}>
            Chat about this
          </button>
        ) : null}
      </fieldset>
      <p className={styles.actionFeedback} aria-live="polite">
        {copyFeedback}
      </p>
    </header>
  )
}

function SummaryProgress({ status }: { status: SessionDto["status"] }) {
  if (status === "complete" || status === "failed") return null
  return (
    <div className={styles.progress} role="status" aria-live="polite">
      <span className={styles.progressDot} aria-hidden="true" />
      <span>{stageLabels[status]}</span>
      <span className={styles.streamingCaret} aria-hidden="true" />
    </div>
  )
}

function SummaryMarkdown({ streaming, summary }: { streaming: boolean; summary: string }) {
  return (
    <div className={styles.summary} data-streaming={streaming || undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ),
        }}
      >
        {summary}
      </ReactMarkdown>
    </div>
  )
}

function FollowUpSuggestions({ onOpenChat }: { onOpenChat: (prompt: string) => void }) {
  return (
    <section className={styles.followUps} aria-labelledby="follow-up-title">
      <div>
        <h2 id="follow-up-title">Keep exploring</h2>
        <p>Choose a question to open chat with it ready to send.</p>
      </div>
      <div className={styles.suggestionList}>
        {suggestions.map((suggestion) => (
          <button type="button" key={suggestion} onClick={() => onOpenChat(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  )
}

function SummaryFooter({ onReset, session }: { onReset: () => void; session: SessionDto }) {
  return (
    <footer
      className={`${styles.footer} flex flex-row items-center max-[720px]:flex-col max-[720px]:items-start`}
    >
      <p>
        {session.provider && session.model
          ? `${session.provider} · ${session.model}`
          : "Generated summary"}
        {session.sourceTruncated ? " · source shortened" : ""}
      </p>
      <button type="button" onClick={onReset}>
        Start a new summary
      </button>
    </footer>
  )
}

export function SummaryArticle({
  connectionError,
  onOpenChat,
  onReset,
  sessionId,
}: SummaryArticleProps) {
  const { data: session } = useSession(sessionId)
  if (!session) return null
  const terminal = session.status === "complete" || session.status === "failed"

  return (
    <article
      className={`${styles.article} h-full w-full max-w-[var(--layout-summary-width)] overflow-y-auto pt-[var(--space-12-5)] pb-24 max-[1335px]:px-8 max-[720px]:px-6 max-[720px]:pt-10 max-[720px]:pb-[var(--space-22)]`}
      aria-labelledby="session-title"
    >
      {session.status === "complete" ? (
        <p className="sr-only" role="status">
          Summary ready.
        </p>
      ) : null}
      <SummaryHeader session={session} onOpenChat={() => onOpenChat()} />
      <SummaryProgress status={session.status} />
      <SummaryMarkdown streaming={!terminal} summary={session.summary} />
      {connectionError ? (
        <p className={styles.recovery} role="alert">
          {connectionError}
        </p>
      ) : null}
      {session.status === "failed" ? (
        <div className={styles.recovery} role="alert">
          <strong>Summary interrupted</strong>
          <span>The partial summary is preserved. Start a new summary to try again.</span>
        </div>
      ) : null}
      {session.status === "complete" ? <FollowUpSuggestions onOpenChat={onOpenChat} /> : null}
      <SummaryFooter session={session} onReset={onReset} />
    </article>
  )
}
