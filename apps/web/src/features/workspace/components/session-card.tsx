import type { SessionDto } from "@chat-with-a-website/contracts"
import { Button, Popover } from "@jfrader/ui"
import { useRef, useState } from "react"
import { CopyIcon } from "../../../components/icons/copy-icon"
import { DownloadIcon } from "../../../components/icons/download-icon"
import { TrashIcon } from "../../../components/icons/trash-icon"
import { DeleteSessionDialog } from "./delete-session-dialog"
import { HistoryMenuButton } from "./history-menu-button"
import styles from "./history-navigation.module.css"

const statusLabels: Record<SessionDto["status"], string> = {
  fetching: "Fetching",
  extracting: "Extracting",
  summarizing: "Summarizing",
  complete: "Complete",
  failed: "Failed",
}

const statusDotClasses: Record<SessionDto["status"], string> = {
  fetching: "bg-(--theme-status-active)",
  extracting: "bg-(--theme-status-active)",
  summarizing: "bg-(--theme-status-active)",
  complete: "bg-(--theme-status-complete)",
  failed: "bg-(--theme-status-failed)",
}

function filenameFor(session: SessionDto) {
  const base = (session.title ?? session.host)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
  return `${base || "summary"}.md`
}

export function SessionCard({
  onSelect,
  selected,
  session,
}: {
  onSelect: () => void
  selected: boolean
  session: SessionDto
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string>()
  const menuTrigger = useRef<HTMLButtonElement>(null)

  function closeActions() {
    setMenuOpen(false)
    setDeleteOpen(false)
    requestAnimationFrame(() => menuTrigger.current?.focus())
  }

  function finishSummaryAction(message: string) {
    setActionFeedback(message)
    setMenuOpen(false)
    requestAnimationFrame(() => menuTrigger.current?.focus())
    window.setTimeout(() => setActionFeedback(undefined), 2_000)
  }

  async function copyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(session.originalUrl)
      } else {
        const area = document.createElement("textarea")
        area.value = session.originalUrl
        area.setAttribute("readonly", "")
        area.style.position = "fixed"
        area.style.opacity = "0"
        document.body.append(area)
        area.select()
        try {
          if (!document.execCommand("copy")) throw new Error("copy rejected")
        } finally {
          area.remove()
        }
      }
      finishSummaryAction("Link copied")
    } catch {
      finishSummaryAction("Copy failed. Select the address to copy it manually.")
    }
  }

  function downloadSummary() {
    const title = session.title ?? session.host
    const sourceUrl = session.finalUrl ?? session.canonicalUrl
    const markdown = `# ${title}\n\nSource: ${sourceUrl}\n\n${session.summary}\n`
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = filenameFor(session)
    link.click()
    URL.revokeObjectURL(url)
    finishSummaryAction("Markdown downloaded")
  }

  return (
    <article
      className={`relative border-b border-(--theme-line-subtle-color) ${selected ? styles.selected : ""}`}
    >
      <Button
        variant="ghost"
        sx={{
          display: "flex",
          height: "auto",
          minHeight: 128,
          width: "100%",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "var(--ui-space-1)",
          padding:
            "var(--ui-space-4) calc(var(--ui-space-12) + var(--ui-space-2)) var(--ui-space-4) var(--ui-space-6)",
          color: "var(--ui-color-text)",
          borderRadius: 0,
          textAlign: "left",
          whiteSpace: "normal",
        }}
        type="button"
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
      >
        <span className="flex w-full items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] leading-4 text-(--theme-text-muted)">
          <img className="size-3 flex-none" src="/assets/link.svg" alt="" />
          <span className="min-w-0 overflow-hidden text-ellipsis">{session.originalUrl}</span>
        </span>
        <strong className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 font-semibold">
          {session.title ?? session.host}
        </strong>
        {session.description ? (
          <span className="line-clamp-2 w-full overflow-hidden text-[11px] leading-4 text-(--theme-text-muted)">
            {session.description}
          </span>
        ) : null}
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-(--theme-text-muted)">
          <span
            className={`size-1.5 flex-none rounded-(--radius-pill) ${statusDotClasses[session.status]}`}
            aria-hidden="true"
          />
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {session.status === "complete"
              ? (session.tagline ?? statusLabels.complete)
              : statusLabels[session.status]}
          </span>
        </span>
      </Button>
      <Popover open={menuOpen} onOpenChange={setMenuOpen} placement="right-start">
        <Popover.Trigger
          ref={menuTrigger}
          sx={{
            position: "absolute",
            top: "var(--ui-space-1)",
            right: "var(--ui-space-4)",
            width: "var(--control-touch-target)",
            height: "var(--control-touch-target)",
            padding: 0,
            border: 0,
            background: "transparent",
            color: "var(--ui-color-text-muted)",
            "&:hover": {
              background: "var(--ui-color-surface-hover)",
              color: "var(--ui-color-text)",
            },
          }}
          type="button"
          aria-controls={`session-actions-${session.id}`}
          aria-expanded={menuOpen}
          aria-label={`Actions for ${session.title ?? session.host}`}
        >
          ⋮
        </Popover.Trigger>
        <Popover.Content
          sx={{
            zIndex: 30,
            padding: "var(--ui-space-2)",
            maxWidth: "calc(100vw - var(--ui-space-6))",
          }}
          id={`session-actions-${session.id}`}
          aria-label={`Actions for ${session.title ?? session.host}`}
        >
          <fieldset
            aria-label={`Actions for ${session.title ?? session.host}`}
            className="m-0 flex min-w-0 flex-col items-start gap-2 border-0 p-0"
          >
            <div className="flex items-center gap-1">
              <HistoryMenuButton
                variant="copy"
                type="button"
                aria-label="Copy link"
                onClick={() => void copyLink()}
              >
                <CopyIcon />
              </HistoryMenuButton>
              <span className="flex h-10 max-w-42 items-center overflow-hidden text-ellipsis whitespace-nowrap px-2 text-xs">
                {session.originalUrl}
              </span>
            </div>
            <HistoryMenuButton
              variant="download"
              type="button"
              aria-label="Download Markdown"
              disabled={!session.summary}
              onClick={downloadSummary}
            >
              <DownloadIcon />
              <span>Download</span>
            </HistoryMenuButton>
            <HistoryMenuButton
              variant="delete"
              type="button"
              aria-label="Delete summary"
              onClick={() => {
                setMenuOpen(false)
                setDeleteOpen(true)
              }}
            >
              <TrashIcon />
              <span>Delete</span>
            </HistoryMenuButton>
          </fieldset>
        </Popover.Content>
      </Popover>
      <span
        className="pointer-events-none absolute right-4 bottom-2 z-6 rounded-(--radius-pill) border border-(--theme-line-subtle-color) bg-(--theme-surface-elevated) px-2.5 py-1 text-[11px] text-(--theme-text-secondary) empty:hidden"
        aria-live="polite"
      >
        {actionFeedback}
      </span>
      {deleteOpen ? <DeleteSessionDialog session={session} onClose={closeActions} /> : null}
    </article>
  )
}
