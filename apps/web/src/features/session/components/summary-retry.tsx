import { useRegenerateSession } from "../hooks/session-queries"
import { SessionFailureButton } from "./session-failure-button"

export function SummaryRetry({ sessionId }: { sessionId: string }) {
  const retry = useRegenerateSession(sessionId)
  return (
    <>
      <SessionFailureButton type="button" disabled={retry.isPending} onClick={() => retry.mutate()}>
        {retry.isPending ? "Retrying…" : "Retry summary"}
      </SessionFailureButton>
      {retry.isError ? (
        <p role="alert" className="text-xs text-(--theme-text-danger)">
          {retry.error.message}
        </p>
      ) : null}
    </>
  )
}
