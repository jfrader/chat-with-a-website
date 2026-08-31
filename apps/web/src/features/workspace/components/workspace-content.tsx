import type { RefObject } from "react"
import { EmptyWorkspace } from "./empty-workspace"
import { SelectedWorkspace } from "./selected-workspace"

interface WorkspaceContentProps {
  historyOpen: boolean
  historyTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenHistory: () => void
  sessionId?: string
}

export function WorkspaceContent(props: WorkspaceContentProps) {
  if (!props.sessionId) return <EmptyWorkspace {...props} />
  return (
    <SelectedWorkspace
      key={props.sessionId}
      historyOpen={props.historyOpen}
      historyTriggerRef={props.historyTriggerRef}
      onOpenHistory={props.onOpenHistory}
      sessionId={props.sessionId}
    />
  )
}
