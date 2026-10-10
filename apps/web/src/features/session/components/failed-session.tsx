import type { ApiErrorCode, SessionDto } from "@chat-with-a-website/contracts"
import { SessionFailureButton } from "./session-failure-button"
import { SessionFailureView } from "./session-failure-view"
import { SummaryRetry } from "./summary-retry"

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
  const message = failureMessages[session.failureCode ?? "INTERNAL_ERROR"]

  return (
    <SessionFailureView
      label="Summary interrupted"
      title="We couldn’t summarize this page"
      message={message}
      actions={
        <>
          <SummaryRetry sessionId={session.id} />
          <SessionFailureButton secondary type="button" onClick={onReset}>
            Try another URL
          </SessionFailureButton>
        </>
      }
    />
  )
}
