import type { SessionDto } from "@chat-with-a-website/contracts"
import { SummaryActionButton } from "./summary-action-button"

export function SummaryFooter({ onReset, session }: { onReset: () => void; session: SessionDto }) {
  return (
    <footer className="mt-10 flex flex-row items-center justify-between gap-4 border-t border-(--theme-line-subtle-color) pt-5 max-mobile:flex-col max-mobile:items-start">
      <p className="m-0 text-[11px] text-(--theme-text-dim)">
        {session.provider && session.model
          ? `${session.provider} · ${session.model}`
          : "Generated summary"}
        {session.sourceTruncated ? " · source shortened" : ""}
      </p>
      <SummaryActionButton type="button" onClick={onReset}>
        Start a new summary
      </SummaryActionButton>
    </footer>
  )
}
