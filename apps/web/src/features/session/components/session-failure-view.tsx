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
      <h1 className="m-0 text-[28px] leading-9" id="session-title">
        {title}
      </h1>
      <p className="mt-3 mb-7 max-w-105 text-sm leading-5.5 text-(--theme-text-secondary)">
        {message}
      </p>
      <div className="flex flex-wrap justify-center gap-3">{actions}</div>
      {error ? (
        <p className="mt-3 mb-0 text-[11px] text-(--theme-text-danger)" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
