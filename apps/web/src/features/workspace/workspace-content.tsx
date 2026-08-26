import { useNavigate } from "@tanstack/react-router"
import { type RefObject, useRef, useState, useSyncExternalStore } from "react"
import { ChatPanel } from "../session/chat-panel"
import { useCreateSession, useSession } from "../session/session-queries"
import { SessionWorkspace } from "../session/session-workspace"
import { UrlComposer } from "./url-composer"
import styles from "./workspace-shell.module.css"

const chatOverlayQuery = "(max-width: 1100px)"

function subscribeToChatOverlay(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia(chatOverlayQuery)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function getChatOverlay() {
  return typeof window.matchMedia === "function" && window.matchMedia(chatOverlayQuery).matches
}

interface WorkspaceContentProps {
  historyOpen: boolean
  historyTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenHistory: () => void
  sessionId?: string
}

interface MobileHeaderProps {
  canChat?: boolean
  historyTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenChat?: () => void
  onOpenHistory: () => void
}

function MobileHeader({
  canChat = false,
  historyTriggerRef,
  onOpenChat,
  onOpenHistory,
}: MobileHeaderProps) {
  const buttonClass =
    "grid size-11 cursor-pointer place-items-center border-0 bg-transparent text-[var(--theme-text-primary)]"

  return (
    <header className="relative z-[3] hidden min-h-14 items-center justify-between border-b border-[var(--theme-line-subtle-color)] bg-[var(--theme-surface-navigation-solid)] p-2 max-[720px]:flex">
      <button
        ref={historyTriggerRef}
        className={buttonClass}
        type="button"
        onClick={onOpenHistory}
        aria-label="Open summary history"
      >
        <span aria-hidden="true">☰</span>
      </button>
      <img className="size-6" src="/assets/profound-mark.svg" alt="Profound" />
      {canChat ? (
        <button className={buttonClass} type="button" onClick={onOpenChat} aria-label="Open chat">
          <span aria-hidden="true">✦</span>
        </button>
      ) : (
        <span className="size-11" />
      )}
    </header>
  )
}

function EmptyWorkspace({
  historyOpen,
  historyTriggerRef,
  onOpenHistory,
}: Omit<WorkspaceContentProps, "sessionId">) {
  const navigate = useNavigate()
  const createSession = useCreateSession()

  async function create(url: string, idempotencyKey: string) {
    const session = await createSession.mutateAsync({ url, idempotencyKey })
    await navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id }, search: {} })
  }

  return (
    <div
      className="min-w-0 flex flex-1 flex-col"
      aria-hidden={historyOpen || undefined}
      inert={historyOpen}
    >
      <MobileHeader historyTriggerRef={historyTriggerRef} onOpenHistory={onOpenHistory} />
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <section
          className="absolute top-[calc(50%-var(--layout-prompt-offset))] left-1/2 w-[min(var(--layout-prompt-max-width),calc(100%-var(--space-12)))] -translate-x-1/2 -translate-y-1/2 max-[720px]:top-[calc(50%-var(--layout-prompt-mobile-offset))] max-[720px]:w-[min(var(--layout-prompt-max-width),calc(100%-var(--space-8)))] max-[600px]:top-1/2"
          aria-labelledby="workspace-heading"
        >
          <div
            className={`${styles.glow} absolute top-[var(--layout-empty-glow-offset)] left-1/2 z-[-1] h-[var(--layout-glow-height)] w-[var(--layout-glow-width)] max-w-none -translate-x-1/2 pointer-events-none select-none max-[600px]:h-[var(--layout-glow-mobile-height)] max-[600px]:w-[var(--layout-glow-mobile-width)]`}
            aria-hidden="true"
          />
          <div className={`${styles.copy} mb-10 max-[600px]:mb-8`}>
            <h1 id="workspace-heading">Let’s get to it</h1>
            <p className="max-w-none text-lg leading-6 max-[720px]:max-w-[var(--layout-copy-max-width)] max-[720px]:text-base max-[720px]:leading-[var(--line-height-mobile-copy)]">
              Paste a URL to summarize and understand any content instantly
            </p>
          </div>
          <UrlComposer onSubmit={create} />
        </section>
      </main>
    </div>
  )
}

function SelectedWorkspace({
  historyOpen,
  historyTriggerRef,
  onOpenHistory,
  sessionId,
}: Required<WorkspaceContentProps>) {
  const navigate = useNavigate()
  const detail = useSession(sessionId)
  const chatOverlay = useSyncExternalStore(subscribeToChatOverlay, getChatOverlay, () => false)
  const [chatOpen, setChatOpen] = useState(false)
  const [suggestedPrompt, setSuggestedPrompt] = useState<string>()
  const chatTriggerRef = useRef<HTMLElement>(null)

  function openChat(prompt?: string) {
    if (document.activeElement instanceof HTMLElement)
      chatTriggerRef.current = document.activeElement
    setSuggestedPrompt(prompt)
    setChatOpen(true)
  }

  function closeChat() {
    setChatOpen(false)
    setSuggestedPrompt(undefined)
    requestAnimationFrame(() => chatTriggerRef.current?.focus())
  }

  function reset() {
    void navigate({ to: "/", search: {} })
  }

  const modalOpen = historyOpen || (chatOverlay && chatOpen)

  return (
    <>
      <div
        className="min-w-0 flex flex-1 flex-col"
        aria-hidden={modalOpen || undefined}
        inert={modalOpen}
      >
        <MobileHeader
          canChat={detail.data?.status === "complete"}
          historyTriggerRef={historyTriggerRef}
          onOpenChat={openChat}
          onOpenHistory={onOpenHistory}
        />
        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <SessionWorkspace sessionId={sessionId} onOpenChat={openChat} onReset={reset} />
        </main>
      </div>
      {chatOpen && detail.data?.status === "complete" ? (
        <ChatPanel
          key={`${sessionId}:${suggestedPrompt ?? ""}`}
          modal={chatOverlay}
          sessionId={sessionId}
          {...(suggestedPrompt ? { initialPrompt: suggestedPrompt } : {})}
          onClose={closeChat}
        />
      ) : null}
    </>
  )
}

export function WorkspaceContent(props: WorkspaceContentProps) {
  if (!props.sessionId) return <EmptyWorkspace {...props} />
  return <SelectedWorkspace key={props.sessionId} {...(props as Required<WorkspaceContentProps>)} />
}
