import { createChatRequestSchema, type MessageDto } from "@profound/contracts"
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { StreamingCaret } from "../../components/activity-indicator"
import { ComposerField, ComposerIconButton } from "../../components/composer-control"
import { Scrim } from "../../components/scrim"
import { trapFocus } from "../../components/trap-focus"
import { useStickToBottom } from "../../components/use-stick-to-bottom"
import styles from "./chat-panel.module.css"
import { useMessages, useSendMessage, useSession } from "./session-queries"

interface ChatPanelProps {
  initialPrompt?: string
  modal: boolean
  onClose: () => void
  open: boolean
  sessionId: string
}

function ChatMessage({ message }: { message: MessageDto }) {
  const thoughtSeconds =
    message.reasoningMs === null ? undefined : Math.max(1, Math.round(message.reasoningMs / 1000))

  return (
    <article className={`${styles.message} ${styles[message.role]}`}>
      <p className="sr-only">{message.role === "user" ? "You" : "Assistant"}</p>
      {message.role === "assistant" && message.reasoningContent ? (
        <details className={styles.thought}>
          <summary>
            <span>Thought</span>
            {thoughtSeconds === undefined ? null : (
              <span className={styles.thoughtDuration}>{thoughtSeconds}s</span>
            )}
            <span className={styles.thoughtChevron} aria-hidden="true">
              ⌄
            </span>
          </summary>
          <p>{message.reasoningContent}</p>
        </details>
      ) : null}
      <div>{message.content || (message.status === "streaming" ? "Thinking…" : "")}</div>
      {message.status === "streaming" ? (
        <>
          <StreamingCaret inline />
          <span className="sr-only">Assistant is responding</span>
        </>
      ) : null}
      {message.role === "assistant" && message.status === "complete" ? (
        <span className="sr-only">Assistant response complete</span>
      ) : null}
      {message.status === "failed" ? (
        <p className={styles.failedMessage}>
          Response interrupted. The partial answer is preserved.
        </p>
      ) : null}
    </article>
  )
}

function ChatMessages({ enabled, sessionId }: { enabled: boolean; sessionId: string }) {
  const messages = useMessages(sessionId, enabled)
  const container = useRef<HTMLDivElement>(null)
  const stick = useStickToBottom(true)
  const messageCount = useRef(0)
  const items = messages.data ?? []

  useEffect(() => {
    const newMessageArrived = items.length !== messageCount.current
    messageCount.current = items.length
    if (newMessageArrived) stick.stuck.current = true
    stick.follow(container.current)
  })

  return (
    <div
      ref={container}
      className={`${styles.messages}`}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      onScroll={stick.handleScroll}
    >
      {messages.isLoading ? (
        <p className={styles.chatState}>Loading conversation…</p>
      ) : messages.error && !messages.data ? (
        <p className={styles.chatError} role="alert">
          {messages.error.message}
        </p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <p>Ask summary</p>
        </div>
      ) : (
        items.map((message) => <ChatMessage key={message.id} message={message} />)
      )}
    </div>
  )
}

function ChatComposer({ initialPrompt, sessionId }: { initialPrompt?: string; sessionId: string }) {
  const inputId = useId()
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const autoSent = useRef<string>(undefined)
  const retryRequest = useRef<{ content: string; idempotencyKey: string } | undefined>(undefined)
  const send = useSendMessage(sessionId)
  const parsedDraft = createChatRequestSchema.shape.content.safeParse(draft)

  async function sendContent(content: string) {
    if (send.isPending) return
    const idempotencyKey =
      retryRequest.current?.content === content
        ? retryRequest.current.idempotencyKey
        : crypto.randomUUID()
    setDraft("")
    inputRef.current?.focus()
    try {
      await send.mutateAsync({ content, idempotencyKey })
      retryRequest.current = undefined
    } catch {
      retryRequest.current = { content, idempotencyKey }
      setDraft(content)
    } finally {
      inputRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!initialPrompt) {
      autoSent.current = undefined
      return
    }
    if (autoSent.current === initialPrompt) return
    autoSent.current = initialPrompt
    const parsed = createChatRequestSchema.shape.content.safeParse(initialPrompt)
    if (parsed.success) void sendContent(parsed.data)
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsedDraft.success || send.isPending) return
    void sendContent(parsedDraft.data)
  }

  return (
    <form
      className={`${styles.composer} max-mobile:mb-[max(var(--space-4),env(safe-area-inset-bottom))]`}
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={inputId}>
        Ask about this summary
      </label>
      <ComposerField multiline>
        <textarea
          ref={inputRef}
          id={inputId}
          rows={1}
          maxLength={4_000}
          placeholder="Ask me about this summary…"
          value={draft}
          readOnly={send.isPending}
          aria-describedby={send.error ? `${inputId}-error` : undefined}
          onChange={(event) => {
            const nextDraft = event.target.value
            if (nextDraft !== retryRequest.current?.content) retryRequest.current = undefined
            setDraft(nextDraft)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <ComposerIconButton
          type="submit"
          disabled={!parsedDraft.success || send.isPending}
          aria-label="Send message"
        >
          <span aria-hidden="true">↑</span>
        </ComposerIconButton>
      </ComposerField>
      <p
        className={send.error ? styles.composerError : "sr-only"}
        id={`${inputId}-error`}
        role={send.error ? "alert" : undefined}
      >
        {send.error instanceof Error ? send.error.message : ""}
      </p>
    </form>
  )
}

export function ChatPanel({ initialPrompt, modal, onClose, open, sessionId }: ChatPanelProps) {
  const { data: session } = useSession(sessionId)
  const closeButton = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current && !initialPrompt) closeButton.current?.focus()
    wasOpen.current = open
  }, [open, initialPrompt])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (modal) trapFocus(event, event.currentTarget)
  }

  return (
    <>
      {modal && open ? <Scrim className="z-21" onClick={onClose} /> : null}
      <aside
        className={`${styles.panel} ${
          open
            ? "w-(--chat-panel-width) flex-[0_0_var(--chat-panel-width)] border-(--theme-line-subtle-color) max-chat:translate-x-0"
            : "w-0 flex-[0_0_0px] border-transparent max-chat:translate-x-full"
        } relative z-6 flex h-full min-w-0 flex-col overflow-hidden border-l bg-(--theme-surface-navigation) max-chat:fixed max-chat:inset-y-0 max-chat:right-0 max-chat:z-22 max-chat:h-svh max-chat:w-(--chat-panel-width) max-chat:flex-[0_0_auto] max-chat:border-(--theme-line-subtle-color) max-chat:bg-(--theme-surface-navigation-solid) max-mobile:left-0 max-mobile:w-full`}
        aria-label="Chat about this summary"
        aria-modal={(modal && open) || undefined}
        aria-hidden={!open || undefined}
        inert={!open}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <header
          className={`${styles.header} max-mobile:min-h-14 max-mobile:pr-2 max-mobile:pt-[max(var(--space-2),env(safe-area-inset-top))]`}
        >
          <div>
            <span aria-hidden="true">✦</span>
            <h2>Chat</h2>
            {session ? (
              <span className={styles.headerContext}>{session.title ?? session.host}</span>
            ) : null}
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close chat">
            ×
          </button>
        </header>
        <ChatMessages enabled={open} sessionId={sessionId} />
        <ChatComposer sessionId={sessionId} {...(initialPrompt ? { initialPrompt } : {})} />
      </aside>
    </>
  )
}
