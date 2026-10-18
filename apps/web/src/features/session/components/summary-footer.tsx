import type { SessionDto } from "@chat-with-a-website/contracts"
import { Button } from "@jfrader/ui"

export function SummaryFooter({ onReset, session }: { onReset: () => void; session: SessionDto }) {
  return (
    <footer className="mt-10 flex flex-row items-center justify-between gap-4 border-t border-(--theme-line-subtle-color) pt-5 max-mobile:flex-col max-mobile:items-start">
      <p className="m-0 text-[11px] text-(--theme-text-dim)">
        {session.provider && session.model
          ? `${session.provider} · ${session.model}`
          : "Generated summary"}
        {session.sourceTruncated ? " · source shortened" : ""}
      </p>
      <Button
        variant="outline"
        type="button"
        onClick={onReset}
        sx={{
          minHeight: "var(--control-touch-target)",
          height: "auto",
          whiteSpace: "normal",
          borderRadius: "var(--ui-radius-full)",
          padding: "var(--ui-space-2) var(--ui-space-4)",
          fontSize: "var(--ui-text-size-sm)",
          color: "var(--ui-color-text-muted)",
        }}
      >
        Start a new summary
      </Button>
    </footer>
  )
}
