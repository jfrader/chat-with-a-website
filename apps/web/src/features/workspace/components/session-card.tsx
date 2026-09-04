import type { SessionDto } from "@chat-with-a-website/contracts"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CopyIcon } from "../../../components/icons/copy-icon"
import { DownloadIcon } from "../../../components/icons/download-icon"
import { TrashIcon } from "../../../components/icons/trash-icon"
import { trapFocus } from "../../../components/trap-focus"
import { DeleteSessionDialog } from "./delete-session-dialog"
import { HistoryMenuButton } from "./history-menu-button"
import styles from "./history-navigation.module.css"

const MENU_VERTICAL_ALIGN_PX = 4
const MENU_GAP_PX = 14
const MENU_MIN_EDGE_SPACE_PX = 240
const MENU_SCROLL_GRACE_MS = 100

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
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string>()
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLFieldSetElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    menu.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus()
    const close = () => setMenuOpen(false)
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (menu.current?.contains(target) || menuTrigger.current?.contains(target)) return
      close()
    }
    const listen = window.setTimeout(() => {
      window.addEventListener("scroll", close, { capture: true })
      window.addEventListener("resize", close)
      window.addEventListener("pointerdown", closeOutside)
    }, MENU_SCROLL_GRACE_MS)
    return () => {
      window.clearTimeout(listen)
      window.removeEventListener("scroll", close, { capture: true })
      window.removeEventListener("resize", close)
      window.removeEventListener("pointerdown", closeOutside)
    }
  }, [menuOpen])

  function toggleMenu() {
    if (!menuOpen && menuTrigger.current) {
      const rect = menuTrigger.current.getBoundingClientRect()
      const fitsBeside = rect.right + MENU_GAP_PX + MENU_MIN_EDGE_SPACE_PX <= window.innerWidth
      setMenuPosition(
        fitsBeside
          ? { top: rect.top - MENU_VERTICAL_ALIGN_PX, left: rect.right + MENU_GAP_PX }
          : {
              top: rect.bottom + MENU_VERTICAL_ALIGN_PX,
              left: Math.max(MENU_GAP_PX, window.innerWidth - MENU_MIN_EDGE_SPACE_PX),
            },
      )
    }
    setMenuOpen((open) => !open)
  }

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

  function handleMenuKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setMenuOpen(false)
      menuTrigger.current?.focus()
      return
    }
    trapFocus(event, event.currentTarget)
  }

  return (
    <article
      className={`relative border-b border-(--theme-line-subtle-color) ${selected ? styles.selected : ""}`}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !menu.current?.contains(event.relatedTarget)
        ) {
          setMenuOpen(false)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault()
          setMenuOpen(false)
          menuTrigger.current?.focus()
        }
      }}
    >
      <button
        className="flex min-h-32 w-full cursor-pointer flex-col items-start gap-1 border-0 bg-transparent py-4 pr-14 pl-7 text-left text-(--theme-text-primary)"
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
      </button>
      <button
        ref={menuTrigger}
        className={`${styles.menuTrigger} absolute top-1 right-4 grid size-11 cursor-pointer place-items-center rounded-(--radius-pill) border-0 bg-transparent text-sm leading-4 text-(--theme-text-muted) hover:text-(--theme-text-primary) aria-expanded:text-(--theme-text-primary)`}
        type="button"
        aria-controls={`session-actions-${session.id}`}
        aria-expanded={menuOpen}
        aria-label={`Actions for ${session.title ?? session.host}`}
        onClick={toggleMenu}
      >
        ⋮
      </button>
      {menuOpen && menuPosition
        ? createPortal(
            <fieldset
              ref={menu}
              className="fixed z-30 m-0 flex min-w-auto flex-col items-start gap-2 border-0 p-0 max-mobile:rounded-(--radius-card) max-mobile:border max-mobile:border-(--theme-line-subtle-color) max-mobile:bg-(--theme-surface-navigation-solid) max-mobile:p-2"
              id={`session-actions-${session.id}`}
              aria-label={`Actions for ${session.title ?? session.host}`}
              style={menuPosition}
              onBlur={(event) => {
                if (
                  event.relatedTarget &&
                  !event.currentTarget.contains(event.relatedTarget) &&
                  event.relatedTarget !== menuTrigger.current
                ) {
                  setMenuOpen(false)
                }
              }}
              onKeyDown={handleMenuKeyDown}
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
                <span
                  className={`${styles.menuUrl} flex h-10 max-w-42 items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-(--radius-pill) border border-(--theme-line-subtle-color) px-4 text-xs text-(--theme-text-primary) backdrop-blur-(--blur-control)`}
                >
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
            </fieldset>,
            document.body,
          )
        : null}
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
