import type { SessionDto } from "@profound/contracts"
import styles from "./history-navigation.module.css"

interface HistoryNavigationProps {
  active: boolean
  collapsed: boolean
  onReset: () => void
  onToggle: () => void
  session: SessionDto | undefined
}

export function HistoryNavigation({
  active,
  collapsed,
  onReset,
  onToggle,
  session,
}: HistoryNavigationProps) {
  const hasCompletedSession = session?.status === "complete"
  const className = [
    styles.navigation,
    active ? styles.active : "",
    collapsed ? styles.collapsed : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <aside className={className} aria-label="Summary history">
      <header className={styles.header}>
        <img className={styles.logo} src="/assets/profound-mark.svg" alt="Profound" />
        <button
          className={styles.toggle}
          type="button"
          aria-controls="summary-history-content"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand summary history" : "Collapse summary history"}
          onClick={onToggle}
        >
          <img src="/assets/collapse-sidebar.svg" alt="" />
        </button>
      </header>

      <div
        className={`${styles.content} ${hasCompletedSession ? styles.contentWithSession : ""}`}
        id="summary-history-content"
        aria-hidden={collapsed}
      >
        {hasCompletedSession ? (
          <article className={styles.sessionCard} aria-current="page">
            <p className={styles.sessionUrl}>{session.finalUrl ?? session.canonicalUrl}</p>
            <h2>{session.title ?? session.host}</h2>
            {session.description ? (
              <p className={styles.sessionDescription}>{session.description}</p>
            ) : null}
          </article>
        ) : (
          <p>No summaries yet</p>
        )}
      </div>

      {hasCompletedSession && !collapsed ? (
        <div className={styles.bottom}>
          <button type="button" onClick={onReset}>
            <img src="/assets/link.svg" alt="" />
            <span>New summary</span>
          </button>
        </div>
      ) : null}
    </aside>
  )
}
