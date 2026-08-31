import styles from "./summary-article.module.css"

export function FollowUpSkeleton() {
  return (
    <section
      className="mt-10 grid gap-4 border-t border-(--theme-line-subtle-color) pt-6"
      aria-hidden="true"
    >
      <div>
        <h2 className="m-0 text-base">Keep exploring</h2>
        <p className="mt-1 mb-0 text-xs text-(--theme-text-muted)">Writing follow-up questions…</p>
      </div>
      <div className="grid gap-2">
        <span className={styles.suggestionSkeleton} />
        <span className={styles.suggestionSkeleton} />
        <span className={styles.suggestionSkeleton} />
      </div>
    </section>
  )
}
