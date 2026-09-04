import styles from "./activity-indicator.module.css"

export function StreamingCaret({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`${styles.streamingCaret} ${inline ? styles.inlineCaret : ""}`}
      aria-hidden="true"
    />
  )
}
