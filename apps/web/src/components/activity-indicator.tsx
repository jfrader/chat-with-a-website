import styles from "./activity-indicator.module.css"

export function ActiveStatusDot() {
  return <span className={styles.statusDot} aria-hidden="true" />
}

export function StreamingCaret({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`${styles.streamingCaret} ${inline ? styles.inlineCaret : ""}`}
      aria-hidden="true"
    />
  )
}
