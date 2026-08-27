import type { SessionDto } from "@profound/contracts"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { type KeyboardEvent, useDeferredValue, useRef, useState } from "react"
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

function trapFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement) {
  if (event.key !== "Tab") return
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([aria-hidden="true"]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  )
  const first = focusable.at(0)
  const last = focusable.at(-1)
  if (!first || !last) return

  if (!container.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

interface HistoryHeaderProps extends HistoryNavigationProps {
  collapsed: boolean
  onToggle: () => void
}

function HistoryHeader({ collapsed, mobileOpen, onCloseMobile, onToggle }: HistoryHeaderProps) {
  return (
    <header
      className={`${styles.header} relative z-[2] flex h-16 w-full items-center justify-between border-b border-[var(--theme-line-subtle-color)] px-6 py-4 max-[720px]:h-12 max-[720px]:border-b-0 max-[720px]:px-4 max-[720px]:py-2`}
    >
      <img className={styles.logo} src="/assets/profound-mark.svg" alt="Profound" />
      {mobileOpen ? (
        <button
          ref={(node) => node?.focus()}
          className={`${styles.mobileClose} hidden max-[720px]:grid`}
          type="button"
          onClick={onCloseMobile}
          aria-label="Close summary history"
        >
          ×
        </button>
      ) : null}
      <button
        className={`${styles.toggle} grid max-[720px]:hidden`}
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
  const menuTrigger = useRef<HTMLButtonElement>(null)

  function closeActions() {
    setMenuOpen(false)
    setDeleteOpen(false)
    requestAnimationFrame(() => menuTrigger.current?.focus())
  }

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
        <span className={`${styles.status} ${styles[session.status]}`}>
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
          <button
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
      className={`${styles.content} absolute inset-x-0 top-16 bottom-28 flex flex-col px-4 py-5 max-[720px]:top-12 max-[720px]:px-3`}
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
    ? "max-[720px]:visible max-[720px]:translate-x-0"
    : "max-[720px]:invisible max-[720px]:-translate-x-full"

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!mobileOpen || !navigation.current) return
    if (event.key === "Escape") {
      event.preventDefault()
      onCloseMobile()
      return
    }
    trapFocus(event, navigation.current)
  }

  const className = `${styles.navigation} ${collapsedClass} ${mobileClass} relative z-[5] h-full w-80 min-w-0 flex-[0_0_20rem] overflow-hidden border-r border-[var(--theme-line-subtle-color)] bg-[var(--theme-surface-navigation)] max-[720px]:fixed max-[720px]:inset-y-0 max-[720px]:left-0 max-[720px]:z-[21] max-[720px]:h-svh max-[720px]:w-[min(var(--layout-mobile-drawer-width),100%)] max-[720px]:flex-[0_0_auto] max-[720px]:border-r-0 max-[720px]:bg-[var(--theme-surface-navigation-solid)]`
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
      <button
        className={`${styles.scrim} fixed inset-0 z-20 hidden h-full w-full border-0 max-[720px]:block`}
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCloseMobile}
      />
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
