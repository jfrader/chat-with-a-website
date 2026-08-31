import type { SessionDto } from "@profound/contracts"
import { ActiveStatusDot } from "../../../components/activity-indicator/active-status-dot"
import { StreamingCaret } from "../../../components/activity-indicator/streaming-caret"
import { stageLabels } from "../session-labels"

export function SummaryProgress({ status }: { status: SessionDto["status"] }) {
  if (status === "complete" || status === "failed") return null
  return (
    <div
      className="mt-6 flex items-center gap-2 text-xs text-(--theme-text-secondary)"
      role="status"
      aria-live="polite"
    >
      <ActiveStatusDot />
      <span>{stageLabels[status]}</span>
      <StreamingCaret />
    </div>
  )
}
