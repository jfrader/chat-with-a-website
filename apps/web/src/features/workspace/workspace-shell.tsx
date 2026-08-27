import { useParams } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { useMediaQuery } from "../../components/use-media-query"
import { HistoryNavigation } from "./history-navigation"
import { WorkspaceContent } from "./workspace-content"
import styles from "./workspace-shell.module.css"

export function WorkspaceShell() {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const [historyOpen, setHistoryOpen] = useState(false)
  const mobileLayout = useMediaQuery("(max-width: 720px)")
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileHistoryOpen = mobileLayout && historyOpen

  function closeHistory() {
    setHistoryOpen(false)
    requestAnimationFrame(() => historyTriggerRef.current?.focus())
  }

  return (
    <div
      className={`${styles.shell} relative isolate flex h-svh w-full overflow-hidden max-mobile:flex-col`}
    >
      <div
        className={`${styles.background} ${sessionId ? styles.activeBackground : ""}`}
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
