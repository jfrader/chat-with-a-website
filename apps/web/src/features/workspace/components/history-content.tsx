import { Button, EmptyState, SearchField, Skeleton } from "@jfrader/ui"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useDeferredValue } from "react"
import { useSessions } from "../../session/hooks/session-queries"
import { SessionCard } from "./session-card"
import styles from "./history-navigation.module.css"

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
        <div className="mx-4 mb-2 max-mobile:mx-3">
          <SearchField
            aria-label="Search summaries"
            value={query}
            placeholder="Search summaries"
            onValueChange={changeQuery}
          />
        </div>
      )}
      <div
        className={`${styles.scrollArea} scrollbar-thin flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-3 [scrollbar-color:var(--theme-scrollbar-thumb)_transparent]`}
        aria-live="polite"
      >
        {sessions.isLoading || deferredQuery !== query ? (
          <div className="mx-4 grid gap-2" role="status" aria-label="Loading summary history">
            <Skeleton height={92} />
            <Skeleton height={92} />
            <Skeleton height={92} />
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
          <EmptyState
            className="mx-3 my-auto"
            title={query ? "No summaries match your search" : "No summaries yet"}
          />
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
          <Button
            variant="outline"
            className="mx-4 mt-3 min-h-(--control-touch-target) w-[calc(100%-2rem)] cursor-pointer rounded-(--radius-pill) border border-(--theme-line-subtle-color) bg-transparent text-xs text-(--theme-text-secondary) disabled:cursor-default disabled:text-(--theme-text-disabled)"
            type="button"
            disabled={sessions.isFetchingNextPage}
            onClick={() => void sessions.fetchNextPage()}
          >
            {sessions.isFetchingNextPage ? "Loading…" : "Load older summaries"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
