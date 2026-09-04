import { useParams } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { MOBILE_LAYOUT_QUERY } from "../../../app/media-queries"
import { useMediaQuery } from "../../../hooks/use-media-query"
import { HistoryNavigation } from "./history-navigation"
import styles from "./workspace.module.css"
import { WorkspaceContent } from "./workspace-content"

export function WorkspaceShell() {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const [historyOpen, setHistoryOpen] = useState(false)
  const mobileLayout = useMediaQuery(MOBILE_LAYOUT_QUERY)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileHistoryOpen = mobileLayout && historyOpen

  function closeHistory() {
    setHistoryOpen(false)
    requestAnimationFrame(() => historyTriggerRef.current?.focus())
  }

  return (
    <div className="relative isolate flex h-svh w-full overflow-hidden bg-(--theme-surface-app) max-mobile:flex-col">
      <div
        className={`${styles.background} pointer-events-none absolute inset-0 -z-2 w-full select-none ${sessionId ? "h-[max(100%,954px)]" : "h-full"}`}
        aria-hidden="true"
      />
      <HistoryNavigation mobileOpen={mobileHistoryOpen} onCloseMobile={closeHistory} />
      <WorkspaceContent
        historyOpen={mobileHistoryOpen}
        historyTriggerRef={historyTriggerRef}
        onOpenHistory={() => setHistoryOpen(true)}
        {...(sessionId ? { sessionId } : {})}
      />
    </div>
  )
}
