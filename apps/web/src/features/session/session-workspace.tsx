import type { ApiErrorCode, SessionDto, SessionStage } from "@profound/contracts"
import { lazy, Suspense } from "react"
import { useSession } from "./session-queries"
import { useSummaryStream } from "./session-stream"
import styles from "./session-workspace.module.css"

interface SessionWorkspaceProps {
  onOpenChat: (prompt?: string) => void
  onReset: () => void
  sessionId: string
}

function SummaryLoadError(_props: SessionWorkspaceProps & { connectionError?: string }) {
  return (
    <section className={styles.failed} role="alert">
      <p className={styles.failureLabel}>Summary view unavailable</p>
      <h1>We couldn’t open this summary</h1>
      <p>Reload the page to retry loading the summary view.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>
    </section>
  )
}

const SummaryArticle = lazy(async () => {
  try {
    const module = await import("./summary-article")
    return { default: module.SummaryArticle }
  } catch {
    return { default: SummaryLoadError }
  }
})

const stageLabels: Record<SessionStage, string> = {
  fetching: "Fetching the webpage",
  extracting: "Extracting readable content",
  summarizing: "Generating the summary",
}

const failureMessages: Record<ApiErrorCode, string> = {
  INVALID_URL: "That URL is not valid.",
  URL_NOT_ALLOWED: "That destination cannot be accessed safely.",
  FETCH_TIMEOUT: "The webpage took too long to respond.",
  FETCH_UNREACHABLE: "The webpage could not be reached.",
  UNSUPPORTED_CONTENT_TYPE: "That URL did not return a supported webpage.",
  EMPTY_CONTENT: "No readable content was found on the webpage.",
  CONTENT_TOO_LARGE: "The webpage is too large to summarize.",
  LLM_UNAVAILABLE: "The summary provider is temporarily unavailable.",
  LLM_RATE_LIMITED: "The summary provider is busy. Try again shortly.",
  GENERATION_INTERRUPTED: "The summary generation was interrupted.",
  INVALID_MESSAGE: "That message could not be sent.",
  IDEMPOTENCY_CONFLICT: "That request conflicts with an earlier request.",
  SESSION_NOT_FOUND: "This summary session could not be found.",
  RATE_LIMITED: "Too many requests were made. Try again shortly.",
  INTERNAL_ERROR: "An unexpected error interrupted the summary.",
}

function splitGeneratingTitle(title: string) {
  const words = title.split(/\s+/)
  const visibleWordCount = Math.min(4, Math.max(1, words.length - 1))
  return {
    visible: words.slice(0, visibleWordCount).join(" "),
    blurred: words.slice(visibleWordCount).join(" "),
  }
}

function GeneratingSession({
  connectionError,
  session,
}: {
  connectionError?: string
  session: SessionDto
}) {
  if (session.status === "complete" || session.status === "failed") return null
  const fallbackTitle =
    session.status === "fetching"
      ? `Reading ${session.host}`
      : session.status === "extracting"
        ? `Extracting ${session.host}`
        : "Generating summary"
  const title = splitGeneratingTitle(session.title ?? fallbackTitle)

  return (
    <section
      className={`${styles.generating} pt-[var(--space-25)] pr-[var(--layout-generating-inline-padding)] pb-6 pl-[var(--layout-generating-inline-padding)] max-[1335px]:px-[clamp(var(--space-8),10vw,var(--space-40))] max-[720px]:pt-[var(--space-18)] max-[720px]:px-6 max-[720px]:pb-5`}
      aria-labelledby="session-title"
    >
      <div className={styles.glow} aria-hidden="true" />
      <h1
        className={`${styles.generatingTitle} w-full max-w-[var(--layout-summary-width)] text-[var(--font-size-title)] leading-8 whitespace-nowrap max-[720px]:text-2xl max-[720px]:whitespace-normal`}
        id="session-title"
        aria-label={session.title ?? fallbackTitle}
      >
        <span aria-hidden="true">{title.visible}</span>
        {title.blurred ? (
          <span className={styles.blurredTitle} aria-hidden="true">
            {title.blurred}
          </span>
        ) : null}
      </h1>
      <div className={`${styles.stage} w-full max-w-[var(--layout-summary-width)]`} role="status">
        <span aria-hidden="true" />
        {connectionError ?? stageLabels[session.status]}
      </div>
      <div className={`${styles.sourcePill} bottom-6 max-[720px]:bottom-5`}>
        {session.originalUrl}
      </div>
    </section>
  )
}

function FailedSession({ onReset, session }: { onReset: () => void; session: SessionDto }) {
  const message = failureMessages[session.failureCode ?? "INTERNAL_ERROR"]
  return (
    <section className={styles.failed} role="alert" aria-labelledby="session-title">
      <p className={styles.failureLabel}>Summary interrupted</p>
      <h1 id="session-title">We couldn’t summarize this page</h1>
      <p>{message}</p>
      <button type="button" onClick={onReset}>
        Try another URL
      </button>
    </section>
  )
}

export function SessionWorkspace(props: SessionWorkspaceProps) {
  const detail = useSession(props.sessionId)
  const connectionError = useSummaryStream(detail.data)

  if (detail.isLoading) {
    return (
      <section className={`${styles.generating} grid place-items-center`} aria-live="polite">
        <div className={`${styles.stage} w-auto`} role="status">
          <span aria-hidden="true" />
          Opening summary…
        </div>
      </section>
    )
  }
  if (detail.error || !detail.data) {
    return (
      <section className={styles.failed} role="alert">
        <p className={styles.failureLabel}>Summary unavailable</p>
        <h1>This summary couldn’t be loaded</h1>
        <p>{detail.error?.message ?? "The summary could not be loaded."}</p>
        <button type="button" onClick={props.onReset}>
          Return home
        </button>
      </section>
    )
  }

  const session = detail.data
  if (session.summary) {
    return (
      <Suspense
        fallback={
          <section className={`${styles.generating} grid place-items-center`} aria-live="polite">
            <div className={`${styles.stage} w-auto`} role="status">
              <span aria-hidden="true" />
              Opening summary…
            </div>
          </section>
        }
      >
        <SummaryArticle
          sessionId={props.sessionId}
          onOpenChat={props.onOpenChat}
          onReset={props.onReset}
          {...(connectionError ? { connectionError } : {})}
        />
      </Suspense>
    )
  }
  if (session.status === "failed")
    return <FailedSession session={session} onReset={props.onReset} />
  return <GeneratingSession session={session} {...(connectionError ? { connectionError } : {})} />
}
