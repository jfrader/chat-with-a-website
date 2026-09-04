import styles from "./activity-indicator.module.css"

export function ActiveStatusDot() {
  return <span className={styles.statusDot} aria-hidden="true" />
}
