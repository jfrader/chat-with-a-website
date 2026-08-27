import { useNavigate } from "@tanstack/react-router"
import { type FormEvent, type RefObject, useRef, useState } from "react"
import { ComposerField, ComposerIconButton } from "../../components/composer-control"
import { useMediaQuery } from "../../components/use-media-query"
import { ChatPanel } from "../session/chat-panel"
import { useCreateSession, useSession } from "../session/session-queries"
import { SessionWorkspace } from "../session/session-workspace"
import { UrlComposer } from "./url-composer"
import styles from "./workspace-shell.module.css"

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

interface SessionChatEntryProps {
  chatOpen: boolean
  onOpenChat: (prompt?: string) => void
}

function SessionChatEntry({ chatOpen, onOpenChat }: SessionChatEntryProps) {
  const [draft, setDraft] = useState("")
  const prompt = draft.trim()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!prompt) return
    setDraft("")
    onOpenChat(prompt)
  }

  return (
    <form
      className={`${styles.chatEntry} ${chatOpen ? styles.chatEntryHidden : ""} flex max-mobile:hidden`}
      aria-hidden={chatOpen || undefined}
      inert={chatOpen}
      onSubmit={submit}
    >
      <ComposerField className={styles.chatEntryField}>
        <ComposerIconButton type="button" onClick={() => onOpenChat()} aria-label="Open empty chat">
          <span aria-hidden="true">+</span>
        </ComposerIconButton>
        <label className="sr-only" htmlFor="session-chat-entry">
          Ask about this summary
        </label>
        <input
          id="session-chat-entry"
          type="text"
          maxLength={4_000}
          placeholder="Ask me about this summary…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <ComposerIconButton type="submit" disabled={!prompt} aria-label="Open chat with question">
          <span aria-hidden="true">↑</span>
        </ComposerIconButton>
      </ComposerField>
    </form>
  )
}

function MobileHeader({
  canChat = false,
  historyTriggerRef,
  onOpenChat,
  onOpenHistory,
}: MobileHeaderProps) {
  const buttonClass =
    "grid size-11 cursor-pointer place-items-center border-0 bg-transparent text-(--theme-text-primary)"

  return (
    <header className="relative z-3 hidden min-h-14 items-center justify-between border-b border-(--theme-line-subtle-color) bg-(--theme-surface-navigation-solid) p-2 max-mobile:flex">
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
        <button
          className={buttonClass}
          type="button"
          onClick={() => onOpenChat?.()}
          aria-label="Open chat"
        >
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
          className="absolute top-[calc(50%-var(--workspace-prompt-offset))] left-1/2 w-[min(var(--workspace-prompt-max-width),calc(100%-var(--space-12)))] -translate-x-1/2 -translate-y-1/2 max-mobile:top-[calc(50%-var(--workspace-prompt-mobile-offset))] max-mobile:w-[min(var(--workspace-prompt-max-width),calc(100%-var(--space-8)))] max-compact:top-1/2"
          aria-labelledby="workspace-heading"
        >
          <div
            className={`${styles.glow} absolute top-(--workspace-empty-glow-offset) left-1/2 z-[-1] h-(--workspace-glow-height) w-(--workspace-glow-width) max-w-none -translate-x-1/2 pointer-events-none select-none max-compact:h-(--workspace-glow-mobile-height) max-compact:w-(--workspace-glow-mobile-width)`}
            aria-hidden="true"
          />
          <div className={`${styles.copy} mb-10 max-compact:mb-8`}>
            <h1 id="workspace-heading">Let’s get to it</h1>
            <p className="max-w-none text-lg leading-6 max-mobile:max-w-(--workspace-copy-max-width) max-mobile:text-base max-mobile:leading-(--workspace-mobile-copy-line-height)">
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
  const chatOverlay = useMediaQuery("(max-width: 1100px)")
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
          {detail.data?.status === "complete" ? (
            <SessionChatEntry chatOpen={chatOpen} onOpenChat={openChat} />
          ) : null}
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
