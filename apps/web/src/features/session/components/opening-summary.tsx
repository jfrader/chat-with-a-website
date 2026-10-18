import { Spinner } from "@jfrader/ui"

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
        <Spinner size="sm" aria-hidden="true" role="presentation" />
        Opening summary…
      </div>
    </section>
  )
}
