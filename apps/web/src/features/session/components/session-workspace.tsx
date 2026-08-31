import { useSession } from "../hooks/session-queries"
import { useSummaryStream } from "../hooks/use-summary-stream"
import { FailedSession } from "./failed-session"
import { GeneratingSession } from "./generating-session"
import { OpeningSummary } from "./opening-summary"
import { SessionFailureButton } from "./session-failure-button"
import { SessionFailureView } from "./session-failure-view"
import { SummaryArticle } from "./summary-article"

export interface SessionWorkspaceProps {
  chatOpen: boolean
  onOpenChat: (prompt?: string) => void
  onReset: () => void
  onToggleChat: () => void
  sessionId: string
}

export function SessionWorkspace(props: SessionWorkspaceProps) {
  const detail = useSession(props.sessionId)
  const connectionError = useSummaryStream(detail.data)

  if (detail.isLoading) return <OpeningSummary />
  if (!detail.data) {
    return (
      <SessionFailureView
        label="Summary unavailable"
        title="This summary couldn’t be loaded"
        message={detail.error?.message ?? "The summary could not be loaded."}
        actions={
          <>
            <SessionFailureButton
              type="button"
              disabled={detail.isFetching}
              onClick={() => void detail.refetch()}
            >
              {detail.isFetching ? "Retrying…" : "Try again"}
            </SessionFailureButton>
            <SessionFailureButton secondary type="button" onClick={props.onReset}>
              Return home
            </SessionFailureButton>
          </>
        }
      />
    )
  }

  const session = detail.data
  if (session.summary) {
    return (
      <SummaryArticle
        sessionId={props.sessionId}
        chatOpen={props.chatOpen}
        onOpenChat={props.onOpenChat}
        onReset={props.onReset}
        onToggleChat={props.onToggleChat}
        {...(connectionError ? { connectionError } : {})}
      />
    )
  }
  if (session.status === "failed") {
    return <FailedSession session={session} onReset={props.onReset} />
  }
  return <GeneratingSession session={session} {...(connectionError ? { connectionError } : {})} />
}
