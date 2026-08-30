import type { ApiErrorCode, SessionDto } from "@profound/contracts"
import { useNavigate } from "@tanstack/react-router"
import { lazy, Suspense, useState } from "react"
import { ActiveStatusDot } from "../../components/activity-indicator"
import borderStyles from "../../components/gradient-border.module.css"
import { stageLabels } from "./session-labels"
import { useCreateSession, useDeleteSession, useSession } from "./session-queries"
import { useSummaryStream } from "./session-stream"
import styles from "./session-workspace.module.css"

interface SessionWorkspaceProps {
  chatOpen: boolean
  onOpenChat: (prompt?: string) => void
  onReset: () => void
  onToggleChat: () => void
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
      className={`${styles.generating} pt-(--space-25) pr-(--session-generating-inline-padding) pb-6 pl-(--session-generating-inline-padding) max-content:px-[clamp(var(--space-8),10vw,var(--space-40))] max-mobile:pt-(--space-18) max-mobile:px-6 max-mobile:pb-5`}
      aria-labelledby="session-title"
    >
      <div className={styles.glow} aria-hidden="true" />
      <h1
        className={`${styles.generatingTitle} w-full max-w-(--workspace-summary-width) text-(--font-size-title) leading-8 whitespace-nowrap max-mobile:text-2xl max-mobile:whitespace-normal`}
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
      <div className={`${styles.stage} w-full max-w-(--workspace-summary-width)`} role="status">
        <ActiveStatusDot />
        {connectionError ?? stageLabels[session.status]}
      </div>
      <div
        className={`${styles.sourcePill} ${borderStyles.gradientBorder} bottom-6 max-mobile:bottom-5`}
      >
        {session.originalUrl}
      </div>
    </section>
  )
}

function FailedSession({ onReset, session }: { onReset: () => void; session: SessionDto }) {
  const navigate = useNavigate()
  const createSession = useCreateSession()
  const removeSession = useDeleteSession()
  const [retryError, setRetryError] = useState<string>()
  const message = failureMessages[session.failureCode ?? "INTERNAL_ERROR"]

  async function retry() {
    setRetryError(undefined)
    try {
      const created = await createSession.mutateAsync({
        url: session.originalUrl,
        idempotencyKey: crypto.randomUUID(),
      })
      await navigate({ to: "/sessions/$sessionId", params: { sessionId: created.id }, search: {} })
      removeSession.mutate(session.id)
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "The summary could not be restarted.")
    }
  }

  return (
    <section className={styles.failed} role="alert" aria-labelledby="session-title">
      <p className={styles.failureLabel}>Summary interrupted</p>
      <h1 id="session-title">We couldn’t summarize this page</h1>
      <p>{message}</p>
      <div className={styles.failedActions}>
        <button type="button" disabled={createSession.isPending} onClick={() => void retry()}>
          {createSession.isPending ? "Retrying…" : "Try again"}
        </button>
        <button className={styles.secondaryAction} type="button" onClick={onReset}>
          Try another URL
        </button>
      </div>
      {retryError ? (
        <p className={styles.retryError} role="alert">
          {retryError}
        </p>
      ) : null}
    </section>
  )
}

function OpeningSummary() {
  return (
    <section className={`${styles.generating} grid place-items-center`} aria-live="polite">
      <div className={`${styles.stage} w-auto`} role="status">
        <ActiveStatusDot />
        Opening summary…
      </div>
    </section>
  )
}

export function SessionWorkspace(props: SessionWorkspaceProps) {
  const detail = useSession(props.sessionId)
  const connectionError = useSummaryStream(detail.data)

  if (detail.isLoading) return <OpeningSummary />
  if (!detail.data) {
    return (
      <section className={styles.failed} role="alert">
        <p className={styles.failureLabel}>Summary unavailable</p>
        <h1>This summary couldn’t be loaded</h1>
        <p>{detail.error?.message ?? "The summary could not be loaded."}</p>
        <div className={styles.failedActions}>
          <button type="button" disabled={detail.isFetching} onClick={() => void detail.refetch()}>
            {detail.isFetching ? "Retrying…" : "Try again"}
          </button>
          <button className={styles.secondaryAction} type="button" onClick={props.onReset}>
            Return home
          </button>
        </div>
      </section>
    )
  }

  const session = detail.data
  if (session.summary) {
    return (
      <Suspense fallback={<OpeningSummary />}>
        <SummaryArticle
          sessionId={props.sessionId}
          chatOpen={props.chatOpen}
          onOpenChat={props.onOpenChat}
          onReset={props.onReset}
          onToggleChat={props.onToggleChat}
          {...(connectionError ? { connectionError } : {})}
        />
      </Suspense>
    )
  }
  if (session.status === "failed")
    return <FailedSession session={session} onReset={props.onReset} />
  return <GeneratingSession session={session} {...(connectionError ? { connectionError } : {})} />
}
