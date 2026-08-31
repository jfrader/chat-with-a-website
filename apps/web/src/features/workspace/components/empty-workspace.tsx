import { useNavigate } from "@tanstack/react-router"
import type { RefObject } from "react"
import { useCreateSession } from "../../session/hooks/session-queries"
import { MobileHeader } from "./mobile-header"
import { UrlComposer } from "./url-composer"
import styles from "./workspace.module.css"

export function EmptyWorkspace({
  historyOpen,
  historyTriggerRef,
  onOpenHistory,
}: {
  historyOpen: boolean
  historyTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenHistory: () => void
}) {
  const navigate = useNavigate()
  const createSession = useCreateSession()

  async function create(url: string, idempotencyKey: string) {
    const session = await createSession.mutateAsync({ url, idempotencyKey })
    await navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id }, search: {} })
  }

  return (
    <div
      className="min-w-0 min-h-0 flex flex-1 flex-col"
      aria-hidden={historyOpen || undefined}
      inert={historyOpen}
    >
      <MobileHeader historyTriggerRef={historyTriggerRef} onOpenHistory={onOpenHistory} />
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <section
          className="absolute top-[calc(50%-56px)] left-1/2 w-[min(560px,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 max-mobile:top-[calc(50%-24px)] max-mobile:w-[min(560px,calc(100%-2rem))] max-compact:top-1/2"
          aria-labelledby="workspace-heading"
        >
          <div
            className={`${styles.glow} pointer-events-none absolute -top-26.5 left-1/2 -z-1 h-123 w-191.5 max-w-none -translate-x-1/2 select-none max-compact:h-109.5 max-compact:w-170`}
            aria-hidden="true"
          />
          <div className="mb-10 flex flex-col items-center gap-2 text-center max-compact:mb-8">
            <h1
              className="m-0 text-2xl leading-8 font-semibold tracking-[-0.02em] text-(--theme-text-primary)"
              id="workspace-heading"
            >
              Let’s get to it
            </h1>
            <p className="m-0 max-w-none text-lg leading-6 font-normal tracking-[-0.01em] text-(--theme-text-secondary) max-mobile:max-w-105 max-mobile:text-base max-mobile:leading-5.75">
              Paste a URL to summarize and understand any content instantly
            </p>
          </div>
          <UrlComposer onSubmit={create} />
        </section>
      </main>
    </div>
  )
}
