import { useNavigate } from "@tanstack/react-router"
import { type KeyboardEvent, useRef, useState } from "react"
import { Scrim } from "../../../components/scrim"
import { trapFocus } from "../../../components/trap-focus"
import { useSessions } from "../../session/hooks/session-queries"
import { HistoryContent } from "./history-content"
import { HistoryHeader } from "./history-header"
import styles from "./history-navigation.module.css"

export function HistoryNavigation({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen: boolean
  onCloseMobile: () => void
}) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const navigation = useRef<HTMLDivElement>(null)
  const allSessions = useSessions("")
  const pristineEmpty =
    !allSessions.isLoading && !allSessions.error && allSessions.data?.sessions.length === 0
  const desktopSize = collapsed && !mobileOpen ? "w-12 basis-12" : "w-80 basis-80"
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

  const className = `${desktopSize} ${mobileClass} relative z-5 h-full min-w-0 shrink-0 grow-0 overflow-hidden border-r border-(--theme-line-subtle-color) bg-(--theme-surface-navigation) transition-[width,flex-basis,transform,visibility] duration-180 ease-(--motion-easing-standard) max-mobile:fixed max-mobile:inset-y-0 max-mobile:left-0 max-mobile:z-21 max-mobile:h-svh max-mobile:w-full max-mobile:flex-none max-mobile:border-r-0 max-mobile:bg-(--theme-surface-navigation-solid)`
  const content = (
    <>
      <HistoryHeader
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={onCloseMobile}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <HistoryContent
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={onCloseMobile}
        pristineEmpty={pristineEmpty}
      />
      {pristineEmpty ? null : (
        <div
          className="absolute right-6 bottom-6 left-6 opacity-100 transition-opacity duration-100 ease-(--motion-easing-standard)"
          aria-hidden={collapsed && !mobileOpen}
          inert={collapsed && !mobileOpen}
        >
          <button
            className={`${styles.newSummaryButton} flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-(--radius-pill) border border-(--theme-line-strong-color)`}
            type="button"
            onClick={() => {
              onCloseMobile()
              void navigate({ to: "/", search: {} })
            }}
          >
            <img className="size-4" src="/assets/link.svg" alt="" />
            <span>New summary</span>
          </button>
        </div>
      )}
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
