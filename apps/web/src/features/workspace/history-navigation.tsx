import type { SessionDto } from "@profound/contracts"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { type KeyboardEvent, useDeferredValue, useRef, useState } from "react"
import { Scrim } from "../../components/scrim"
import { trapFocus } from "../../components/trap-focus"
import { useDeleteSession, useSessions } from "../session/session-queries"
import styles from "./history-navigation.module.css"

interface HistoryNavigationProps {
  mobileOpen: boolean
  onCloseMobile: () => void
}

const statusLabels: Record<SessionDto["status"], string> = {
  fetching: "Fetching",
  extracting: "Extracting",
  summarizing: "Summarizing",
  complete: "Complete",
  failed: "Failed",
}

function filenameFor(session: SessionDto) {
  const base = (session.title ?? session.host)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
  return `${base || "summary"}.md`
}

interface HistoryHeaderProps extends HistoryNavigationProps {
  collapsed: boolean
  onToggle: () => void
}

function HistoryHeader({ collapsed, mobileOpen, onCloseMobile, onToggle }: HistoryHeaderProps) {
  return (
    <header
      className={`${styles.header} relative z-2 flex h-16 w-full items-center justify-between border-b border-(--theme-line-subtle-color) px-6 py-4 max-mobile:h-12 max-mobile:border-b-0 max-mobile:px-4 max-mobile:py-2`}
    >
      <img className={styles.logo} src="/assets/profound-mark.svg" alt="Profound" />
      {mobileOpen ? (
        <button
          ref={(node) => node?.focus()}
          className={`${styles.mobileClose} hidden max-mobile:grid`}
          type="button"
          onClick={onCloseMobile}
          aria-label="Close summary history"
        >
          ×
        </button>
      ) : null}
      <button
        className={`${styles.toggle} grid max-mobile:hidden`}
        type="button"
        aria-controls="summary-history-content"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand summary history" : "Collapse summary history"}
        onClick={onToggle}
      >
        <img src="/assets/collapse-sidebar.svg" alt="" />
      </button>
    </header>
  )
}

interface DeleteSessionDialogProps {
  onClose: () => void
  session: SessionDto
}

function DeleteSessionDialog({ onClose, session }: DeleteSessionDialogProps) {
  const navigate = useNavigate()
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const remove = useDeleteSession()
  const [confirmError, setConfirmError] = useState<string>()
  const dialogRef = useRef<HTMLElement>(null)
  const focusCancel = useRef(true)

  async function confirmDelete() {
    setConfirmError(undefined)
    try {
      await remove.mutateAsync(session.id)
      if (session.id === sessionId) await navigate({ to: "/", search: {} })
      else onClose()
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "The summary could not be deleted.")
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (dialogRef.current) trapFocus(event, dialogRef.current)
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        onKeyDown={handleKeyDown}
      >
        <p className={styles.dialogLabel}>Delete summary</p>
        <h2 id="delete-title">Remove this summary?</h2>
        <p id="delete-description">
          This removes the summary and its chat history. This action cannot be undone.
        </p>
        {confirmError || remove.error ? (
          <p className={styles.dialogError} role="alert">
            {confirmError ?? remove.error?.message}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button
            ref={(node) => {
              if (node && focusCancel.current) {
                focusCancel.current = false
                node.focus()
              }
            }}
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="button" disabled={remove.isPending} onClick={confirmDelete}>
            {remove.isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </section>
    </div>
  )
}

interface SessionCardProps {
  onSelect: () => void
  selected: boolean
  session: SessionDto
}

function SessionCard({ onSelect, selected, session }: SessionCardProps) {
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

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(session.summary)
      finishSummaryAction("Summary copied")
    } catch {
      finishSummaryAction("Copy failed. Select the summary text to copy it manually.")
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

  const statusClass =
    session.status === "complete" || session.status === "failed" ? styles[session.status] : ""

  return (
    <article
      className={`${styles.sessionCard} ${selected ? styles.selected : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false)
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
        className={styles.sessionSelect}
        type="button"
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
      >
        <span className={styles.sessionUrl}>{session.host}</span>
        <strong>{session.title ?? session.host}</strong>
        <span className={styles.sessionDescription}>
          {session.description ?? session.originalUrl}
        </span>
        <span className={`${styles.status} ${statusClass}`}>
          <span aria-hidden="true" />
          {statusLabels[session.status]}
        </span>
      </button>
      <button
        ref={menuTrigger}
        className={styles.menuTrigger}
        type="button"
        aria-controls={`session-actions-${session.id}`}
        aria-expanded={menuOpen}
        aria-label={`Actions for ${session.title ?? session.host}`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ···
      </button>
      {menuOpen ? (
        <div className={styles.menu} id={`session-actions-${session.id}`}>
          <button type="button" disabled={!session.summary} onClick={() => void copySummary()}>
            Copy
          </button>
          <button type="button" disabled={!session.summary} onClick={downloadSummary}>
            Download Markdown
          </button>
          <button
            className={styles.dangerAction}
            type="button"
            onClick={() => {
              setMenuOpen(false)
              setDeleteOpen(true)
            }}
          >
            Delete summary
          </button>
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {actionFeedback}
      </span>
      {deleteOpen ? <DeleteSessionDialog session={session} onClose={closeActions} /> : null}
    </article>
  )
}

interface HistoryContentProps extends HistoryNavigationProps {
  collapsed: boolean
}

function HistoryContent({ collapsed, mobileOpen, onCloseMobile }: HistoryContentProps) {
  const navigate = useNavigate()
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const search = useSearch({ strict: false }) as { query?: string }
  const query = search.query ?? ""
  const deferredQuery = useDeferredValue(query)
  const sessions = useSessions(deferredQuery)

  function changeQuery(nextQuery: string) {
    if (sessionId) {
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId },
        search: nextQuery ? { query: nextQuery } : {},
        replace: true,
      })
      return
    }
    void navigate({ to: "/", search: nextQuery ? { query: nextQuery } : {}, replace: true })
  }

  function select(nextSessionId: string) {
    onCloseMobile()
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: nextSessionId },
      search: query ? { query } : {},
    })
  }

  const hidden = collapsed && !mobileOpen

  return (
    <div
      className={`${styles.content} absolute inset-x-0 top-16 bottom-28 flex flex-col px-4 py-5 max-mobile:top-12 max-mobile:px-3`}
      id="summary-history-content"
      aria-hidden={hidden}
      inert={hidden}
    >
      <label className={styles.search}>
        <span className="sr-only">Search summaries</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          placeholder="Search summaries"
          onChange={(event) => changeQuery(event.target.value)}
        />
      </label>
      <div className={styles.historyList} aria-live="polite">
        {sessions.isLoading || deferredQuery !== query ? (
          <div className={styles.skeletons} role="status" aria-label="Loading summary history">
            <span />
            <span />
            <span />
          </div>
        ) : sessions.error && !sessions.data ? (
          <p className={styles.historyError} role="alert">
            {sessions.error.message}
          </p>
        ) : sessions.data?.sessions.length ? (
          sessions.data.sessions.map((session) => (
            <SessionCard
              key={session.id}
              onSelect={() => select(session.id)}
              selected={session.id === sessionId}
              session={session}
            />
          ))
        ) : (
          <p className={styles.empty}>
            {query ? "No summaries match your search" : "No summaries yet"}
          </p>
        )}
        {sessions.isFetchNextPageError ? (
          <p className={styles.historyError} role="alert">
            {sessions.error.message}
          </p>
        ) : null}
        {sessions.hasNextPage ? (
          <button
            className={styles.loadMore}
            type="button"
            disabled={sessions.isFetchingNextPage}
            onClick={() => void sessions.fetchNextPage()}
          >
            {sessions.isFetchingNextPage ? "Loading…" : "Load older summaries"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function HistoryNavigation({ mobileOpen, onCloseMobile }: HistoryNavigationProps) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const navigation = useRef<HTMLDivElement>(null)
  const collapsedClass = collapsed && !mobileOpen ? styles.collapsed : ""
  const mobileClass = mobileOpen
    ? "max-mobile:visible max-mobile:translate-x-0"
    : "max-mobile:invisible max-mobile:-translate-x-full"

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!mobileOpen || !navigation.current) return
    if (event.key === "Escape") {
      event.preventDefault()
      onCloseMobile()
      return
    }
    trapFocus(event, navigation.current)
  }

  const className = `${styles.navigation} ${collapsedClass} ${mobileClass} relative z-5 h-full w-80 min-w-0 flex-[0_0_20rem] overflow-hidden border-r border-(--theme-line-subtle-color) bg-(--theme-surface-navigation) max-mobile:fixed max-mobile:inset-y-0 max-mobile:left-0 max-mobile:z-21 max-mobile:h-svh max-mobile:w-[min(var(--history-mobile-drawer-width),100%)] max-mobile:flex-[0_0_auto] max-mobile:border-r-0 max-mobile:bg-(--theme-surface-navigation-solid)`
  const content = (
    <>
      <HistoryHeader
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={onCloseMobile}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <HistoryContent collapsed={collapsed} mobileOpen={mobileOpen} onCloseMobile={onCloseMobile} />
      <div
        className={styles.bottom}
        aria-hidden={collapsed && !mobileOpen}
        inert={collapsed && !mobileOpen}
      >
        <button
          type="button"
          onClick={() => {
            onCloseMobile()
            void navigate({ to: "/", search: {} })
          }}
        >
          <img src="/assets/link.svg" alt="" />
          <span>New summary</span>
        </button>
      </div>
    </>
  )

  if (!mobileOpen) {
    return (
      <aside className={className} aria-label="Summary history">
        {content}
      </aside>
    )
  }

  return (
    <>
      <Scrim className="z-20 hidden max-mobile:block" onClick={onCloseMobile} />
      <div
        ref={navigation}
        className={className}
        role="dialog"
        aria-label="Summary history"
        aria-modal="true"
        onKeyDown={handleKeyDown}
      >
        {content}
      </div>
    </>
  )
}
