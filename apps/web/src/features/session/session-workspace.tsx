import type { ApiErrorCode, SessionDto, SessionStage } from "@profound/contracts"
import { useEffect, useRef, useState } from "react"
import styles from "./session-workspace.module.css"

interface SessionWorkspaceProps {
  connectionError: string | undefined
  onReset: () => void
  session: SessionDto
}

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
  PROVIDER_RATE_LIMITED: "The summary service is temporarily rate limited.",
  PROVIDER_UNAVAILABLE: "The summary service is temporarily unavailable.",
  GENERATION_INTERRUPTED: "Summary generation was interrupted.",
  SESSION_NOT_FOUND: "This summary session could not be found.",
  SESSION_IN_PROGRESS: "This summary is still being generated.",
  RATE_LIMITED: "Too many summaries were requested. Please try again shortly.",
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

function GeneratingSession({ connectionError, session }: Omit<SessionWorkspaceProps, "onReset">) {
  if (session.status === "complete" || session.status === "failed") return null

  const fallbackTitle =
    session.status === "fetching"
      ? `Reading ${session.host}`
      : session.status === "extracting"
        ? `Extracting ${session.host}`
        : "Generating summary"
  const title = splitGeneratingTitle(session.title ?? fallbackTitle)

  return (
    <section className={styles.generating} aria-labelledby="session-title">
      <div className={styles.glow} aria-hidden="true" />
      <h1
        className={styles.generatingTitle}
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
      {connectionError ? <p className={styles.connectionError}>{connectionError}</p> : null}
      <div className={styles.sourcePill}>{session.originalUrl}</div>
    </section>
  )
}

function CompletedSession({ onReset, session }: SessionWorkspaceProps) {
  const paragraphs = session.summary.split(/\n{2,}/).filter(Boolean)

  return (
    <article className={styles.completed} aria-labelledby="session-title">
      <header className={styles.completedHeader}>
        <h1 id="session-title">{session.title ?? session.host}</h1>
        {session.description ? <p>{session.description}</p> : null}
      </header>
      <div className={styles.summary}>
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <button className={styles.completedReset} type="button" onClick={onReset}>
        Start a new summary
      </button>
    </article>
  )
}

function FailedSession({ onReset, session }: SessionWorkspaceProps) {
  const message = failureMessages[session.failureCode ?? "INTERNAL_ERROR"]

  return (
    <section className={styles.failed} aria-labelledby="session-title">
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
  const [announcement, setAnnouncement] = useState("")
  const hadConnectionError = useRef(false)

  useEffect(() => {
    if (props.session.status === "complete") {
      hadConnectionError.current = false
      setAnnouncement("Summary ready.")
      return
    }
    if (props.session.status === "failed") {
      hadConnectionError.current = false
      setAnnouncement(
        `Summary interrupted. ${failureMessages[props.session.failureCode ?? "INTERNAL_ERROR"]}`,
      )
      return
    }
    if (props.connectionError) {
      hadConnectionError.current = true
      setAnnouncement(props.connectionError)
      return
    }
    if (hadConnectionError.current) {
      hadConnectionError.current = false
      setAnnouncement("Live progress reconnected.")
      return
    }
    setAnnouncement(stageLabels[props.session.status])
  }, [props.connectionError, props.session.failureCode, props.session.status])

  const workspace =
    props.session.status === "complete" ? (
      <CompletedSession {...props} />
    ) : props.session.status === "failed" ? (
      <FailedSession {...props} />
    ) : (
      <GeneratingSession session={props.session} connectionError={props.connectionError} />
    )

  return (
    <>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {workspace}
    </>
  )
}
