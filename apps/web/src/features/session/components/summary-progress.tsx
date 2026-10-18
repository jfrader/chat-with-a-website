import type { SessionDto } from "@chat-with-a-website/contracts"
import { Spinner, StreamingCaret } from "@jfrader/ui"
import { stageLabels } from "../session-labels"

export function SummaryProgress({ status }: { status: SessionDto["status"] }) {
  if (status === "complete" || status === "failed") return null
  return (
    <div
      className="mt-6 flex items-center gap-2 text-xs text-(--theme-text-secondary)"
      role="status"
      aria-live="polite"
    >
      <Spinner size="sm" decorative />
      <span>{stageLabels[status]}</span>
      <StreamingCaret />
    </div>
  )
}
