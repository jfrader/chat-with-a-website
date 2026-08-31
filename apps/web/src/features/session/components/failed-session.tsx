import type { ApiErrorCode, SessionDto } from "@profound/contracts"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useCreateSession, useDeleteSession } from "../hooks/session-queries"
import { SessionFailureButton } from "./session-failure-button"
import { SessionFailureView } from "./session-failure-view"

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

export function FailedSession({ onReset, session }: { onReset: () => void; session: SessionDto }) {
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
    <SessionFailureView
      label="Summary interrupted"
      title="We couldn’t summarize this page"
      message={message}
      {...(retryError ? { error: retryError } : {})}
      actions={
        <>
          <SessionFailureButton
            type="button"
            disabled={createSession.isPending}
            onClick={() => void retry()}
          >
            {createSession.isPending ? "Retrying…" : "Try again"}
          </SessionFailureButton>
          <SessionFailureButton secondary type="button" onClick={onReset}>
            Try another URL
          </SessionFailureButton>
        </>
      }
    />
  )
}
