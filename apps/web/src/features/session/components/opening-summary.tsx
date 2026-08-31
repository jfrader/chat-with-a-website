import { ActiveStatusDot } from "../../../components/activity-indicator/active-status-dot"

export function OpeningSummary() {
  return (
    <section
      className="relative z-1 grid h-full place-items-center overflow-hidden"
      aria-live="polite"
    >
      <div
        className="mt-4 flex w-auto items-center gap-2 text-xs leading-4.5 text-(--theme-text-secondary)"
        role="status"
      >
        <ActiveStatusDot />
        Opening summary…
      </div>
    </section>
  )
}
