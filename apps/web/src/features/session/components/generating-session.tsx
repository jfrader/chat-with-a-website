import type { SessionDto, SessionStage } from "@profound/contracts"
import { ActiveStatusDot } from "../../../components/activity-indicator/active-status-dot"
import borderStyles from "../../../components/gradient-border.module.css"
import { stageLabels } from "../session-labels"
import styles from "./session-workspace.module.css"

function splitGeneratingTitle(title: string) {
  const words = title.split(/\s+/)
  const visibleWordCount = Math.min(4, Math.max(1, words.length - 1))
  return {
    visible: words.slice(0, visibleWordCount).join(" "),
    blurred: words.slice(visibleWordCount).join(" "),
  }
}

export function GeneratingSession({
  connectionError,
  session,
}: {
  connectionError?: string
  session: SessionDto
}) {
  if (session.status === "complete" || session.status === "failed") return null

  const fallbackTitles: Record<SessionStage, string> = {
    fetching: `Reading ${session.host}`,
    extracting: `Extracting ${session.host}`,
    summarizing: "Generating summary",
  }
  const fallbackTitle = fallbackTitles[session.status]
  const title = splitGeneratingTitle(session.title ?? fallbackTitle)

  return (
    <section
      className="relative z-1 h-full overflow-hidden px-80.5 pt-25 pb-6 max-content:px-[clamp(2rem,10vw,10rem)] max-mobile:px-6 max-mobile:pt-18 max-mobile:pb-5"
      aria-labelledby="session-title"
    >
      <div
        className={`${styles.glow} pointer-events-none absolute top-165.25 left-[calc(50%-7px)] -z-1 h-123 w-191.5 max-w-none -translate-x-1/2 select-none`}
        aria-hidden="true"
      />
      <h1
        className="relative z-1 m-0 w-full max-w-164 text-[28px] leading-8 font-semibold tracking-(--tracking-title) text-(--theme-text-primary) whitespace-nowrap max-mobile:text-2xl max-mobile:whitespace-normal"
        id="session-title"
        aria-label={session.title ?? fallbackTitle}
      >
        <span aria-hidden="true">{title.visible}</span>
        {title.blurred ? (
          <span className={styles.blurredTitle} aria-hidden="true">
            {title.blurred}
          </span>
        ) : null}
      </h1>
      <div
        className="mt-4 flex w-full max-w-164 items-center gap-2 text-xs leading-4.5 text-(--theme-text-secondary)"
        role="status"
      >
        <ActiveStatusDot />
        {connectionError ?? stageLabels[session.status]}
      </div>
      <div
        className={`${styles.sourcePill} ${borderStyles.gradientBorder} absolute bottom-6 left-1/2 flex h-(--control-height) max-w-[min(560px,calc(100%-3rem))] -translate-x-1/2 items-center overflow-hidden rounded-(--radius-pill) border border-transparent px-6 text-sm leading-5 text-(--theme-text-primary) text-ellipsis whitespace-nowrap max-mobile:bottom-5`}
      >
        {session.originalUrl}
      </div>
    </section>
  )
}
