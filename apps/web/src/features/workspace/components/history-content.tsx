import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useDeferredValue } from "react"
import { ComposerField } from "../../../components/composer-control/composer-field"
import { SearchIcon } from "../../../components/icons/search-icon"
import { useSessions } from "../../session/hooks/session-queries"
import styles from "./history-navigation.module.css"
import { SessionCard } from "./session-card"

export function HistoryContent({
  collapsed,
  mobileOpen,
  onCloseMobile,
  pristineEmpty,
}: {
  collapsed: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
  pristineEmpty: boolean
}) {
  const navigate = useNavigate()
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const search = useSearch({ strict: false }) as { query?: string }
  const query = search.query ?? ""
  const deferredQuery = useDeferredValue(query)
  const sessions = useSessions(deferredQuery)
  const hideSearch = pristineEmpty && !query

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
      className={`absolute inset-x-0 top-16 bottom-22 flex flex-col py-5 transition-opacity duration-100 ease-(--motion-easing-standard) max-mobile:top-12 max-mobile:pt-6 ${hidden ? "pointer-events-none opacity-0" : "opacity-100"}`}
      id="summary-history-content"
      aria-hidden={hidden}
      inert={hidden}
    >
      {hideSearch ? null : (
        <label className="mx-4 mb-2 block max-mobile:mx-3">
          <span className="sr-only">Search summaries</span>
          <ComposerField variant="search">
            <span
              className="grid size-4 place-items-center text-(--theme-text-muted)"
              aria-hidden="true"
            >
              <SearchIcon />
            </span>
            <input
              type="search"
              value={query}
              placeholder="Search summaries"
              onChange={(event) => changeQuery(event.target.value)}
            />
          </ComposerField>
        </label>
      )}
      <div
        className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-3 [scrollbar-color:var(--theme-scrollbar-thumb)_transparent]"
        aria-live="polite"
      >
        {sessions.isLoading || deferredQuery !== query ? (
          <div className="mx-4 grid gap-2" role="status" aria-label="Loading summary history">
            <span className={styles.skeleton} />
            <span className={styles.skeleton} />
            <span className={styles.skeleton} />
          </div>
        ) : sessions.error && !sessions.data ? (
          <p
            className="mx-3 my-10 text-center text-[13px] leading-5 text-(--theme-text-danger)"
            role="alert"
          >
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
          <p className="mx-3 my-auto text-center text-[13px] leading-5 text-(--theme-text-muted)">
            {query ? "No summaries match your search" : "No summaries yet"}
          </p>
        )}
        {sessions.isFetchNextPageError ? (
          <p
            className="mx-3 my-10 text-center text-[13px] leading-5 text-(--theme-text-danger)"
            role="alert"
          >
            {sessions.error.message}
          </p>
        ) : null}
        {sessions.hasNextPage ? (
          <button
            className="mx-4 mt-3 min-h-(--control-touch-target) w-[calc(100%-2rem)] cursor-pointer rounded-(--radius-pill) border border-(--theme-line-subtle-color) bg-transparent text-xs text-(--theme-text-secondary) disabled:cursor-default disabled:text-(--theme-text-disabled)"
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
