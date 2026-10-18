import { EmptyState } from "@jfrader/ui"
import type { ReactNode } from "react"

export function SessionFailureView({
  actions,
  error,
  label,
  message,
  title,
}: {
  actions: ReactNode
  error?: string
  label: string
  message: string
  title: string
}) {
  return (
    <section
      className="relative z-1 mx-auto flex h-full w-[min(560px,calc(100%-3rem))] flex-col items-center justify-center text-center"
      role="alert"
      aria-labelledby="session-title"
    >
      <p className="mb-2.5 text-xs tracking-(--tracking-label) text-(--theme-text-danger) uppercase">
        {label}
      </p>
      <EmptyState
        headingLevel={1}
        title={<span id="session-title">{title}</span>}
        description={message}
        action={actions}
        sx={{ padding: 0, gap: "calc(var(--ui-space-4) + var(--ui-space-3))" }}
        slotProps={{
          title: {
            css: { fontSize: "var(--ui-text-size-2xl)", lineHeight: "var(--ui-line-height-tight)" },
          },
          description: {
            css: {
              fontSize: "var(--ui-text-size-md)",
              lineHeight: "var(--ui-line-height-relaxed)",
            },
          },
        }}
      />
      {error ? (
        <p className="mt-3 mb-0 text-[11px] text-(--theme-text-danger)" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
