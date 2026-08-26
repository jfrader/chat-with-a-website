import { createChatRequestSchema, type MessageDto } from "@profound/contracts"
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react"
import styles from "./chat-panel.module.css"
import { useMessages, useSendMessage } from "./session-queries"

interface ChatPanelProps {
  initialPrompt?: string
  modal: boolean
  onClose: () => void
  sessionId: string
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  )
  const first = focusable.at(0)
  const last = focusable.at(-1)
  if (!first || !last) return

  if (!event.currentTarget.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function ChatMessage({ message }: { message: MessageDto }) {
  return (
    <article className={`${styles.message} ${styles[message.role]}`}>
      <p className="sr-only">{message.role === "user" ? "You" : "Assistant"}</p>
      <div>{message.content || (message.status === "streaming" ? "Thinking…" : "")}</div>
      {message.status === "streaming" ? (
        <>
          <span className={styles.caret} aria-hidden="true" />
          <span className="sr-only">Assistant is responding</span>
        </>
      ) : null}
      {message.status === "failed" ? (
        <p className={styles.failedMessage}>
          Response interrupted. The partial answer is preserved.
        </p>
      ) : null}
    </article>
  )
}

function ChatMessages({ sessionId }: { sessionId: string }) {
  const messages = useMessages(sessionId, true)
  const items = messages.data ?? []
  const scrollMarker = items
    .map((message) => `${message.id}:${message.content.length}:${message.status}`)
    .join("|")

  return (
    <div className={styles.messages} role="log" aria-live="polite" aria-relevant="additions text">
      {messages.isLoading ? (
        <p className={styles.chatState}>Loading conversation…</p>
      ) : messages.error ? (
        <p className={styles.chatError} role="alert">
          {messages.error.message}
        </p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">✦</span>
          <p>Ask about evidence, implications, or anything in the source.</p>
        </div>
      ) : (
        items.map((message) => <ChatMessage key={message.id} message={message} />)
      )}
      <span
        key={scrollMarker}
        aria-hidden="true"
        ref={(node) => {
          if (node?.parentElement) node.parentElement.scrollTop = node.parentElement.scrollHeight
        }}
      />
    </div>
  )
}

function ChatComposer({ initialPrompt, sessionId }: { initialPrompt?: string; sessionId: string }) {
  const inputId = useId()
  const [draft, setDraft] = useState(initialPrompt ?? "")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const focusInput = useRef(Boolean(initialPrompt))
  const retryRequest = useRef<{ content: string; idempotencyKey: string } | undefined>(undefined)
  const send = useSendMessage(sessionId)
  const parsedDraft = createChatRequestSchema.shape.content.safeParse(draft)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsedDraft.success || send.isPending) return
    const content = parsedDraft.data
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

  return (
    <form
      className={`${styles.composer} max-[720px]:mb-[max(var(--space-4),env(safe-area-inset-bottom))]`}
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={inputId}>
        Ask about this summary
      </label>
      <textarea
        ref={(node) => {
          inputRef.current = node
          if (node && focusInput.current) {
            focusInput.current = false
            node.focus()
          }
        }}
        id={inputId}
        rows={1}
        maxLength={4_000}
        placeholder="Ask anything about this summary…"
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
      <button
        type="submit"
        disabled={!parsedDraft.success || send.isPending}
        aria-label="Send message"
      >
        <span aria-hidden="true">↑</span>
      </button>
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

export function ChatPanel({ initialPrompt, modal, onClose, sessionId }: ChatPanelProps) {
  const focusClose = useRef(!initialPrompt)
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (modal) trapFocus(event)
  }

  return (
    <>
      {modal ? (
        <button
          className="fixed inset-0 z-[21] border-0 bg-[var(--theme-surface-scrim)]"
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`${styles.panel} relative z-[6] flex h-full w-[var(--layout-chat-width)] min-w-0 flex-[0_0_var(--layout-chat-width)] flex-col overflow-hidden bg-[var(--theme-surface-navigation)] max-[1100px]:fixed max-[1100px]:inset-y-0 max-[1100px]:right-0 max-[1100px]:z-[22] max-[1100px]:h-svh max-[1100px]:bg-[var(--theme-surface-navigation-solid)] max-[720px]:left-0 max-[720px]:w-full max-[720px]:flex-[0_0_auto]`}
        aria-label="Chat about this summary"
        aria-modal={modal || undefined}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <header
          className={`${styles.header} max-[720px]:pt-[max(var(--space-2),env(safe-area-inset-top))]`}
        >
          <div>
            <span aria-hidden="true">✦</span>
            <h2>Chat</h2>
          </div>
          <button
            ref={(node) => {
              if (node && focusClose.current) {
                focusClose.current = false
                node.focus()
              }
            }}
            type="button"
            onClick={onClose}
            aria-label="Close chat"
          >
            ×
          </button>
        </header>
        <ChatMessages sessionId={sessionId} />
        <ChatComposer sessionId={sessionId} {...(initialPrompt ? { initialPrompt } : {})} />
      </aside>
    </>
  )
}
