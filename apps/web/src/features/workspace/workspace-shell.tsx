import { useParams } from "@tanstack/react-router"
import { useRef, useState, useSyncExternalStore } from "react"
import { HistoryNavigation } from "./history-navigation"
import { WorkspaceContent } from "./workspace-content"
import styles from "./workspace-shell.module.css"

const mobileLayoutQuery = "(max-width: 720px)"

function subscribeToMobileLayout(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia(mobileLayoutQuery)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function getMobileLayout() {
  return typeof window.matchMedia === "function" && window.matchMedia(mobileLayoutQuery).matches
}

export function WorkspaceShell() {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const [historyOpen, setHistoryOpen] = useState(false)
  const mobileLayout = useSyncExternalStore(subscribeToMobileLayout, getMobileLayout, () => false)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileHistoryOpen = mobileLayout && historyOpen

  function closeHistory() {
    setHistoryOpen(false)
    requestAnimationFrame(() => historyTriggerRef.current?.focus())
  }

  return (
    <div
      className={`${styles.shell} relative isolate flex h-svh w-full overflow-hidden max-[720px]:flex-col`}
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
