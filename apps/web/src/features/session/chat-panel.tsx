import { createChatRequestSchema, type MessageDto } from "@profound/contracts"
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react"
import { StreamingCaret } from "../../components/activity-indicator"
import { ComposerField, ComposerIconButton } from "../../components/composer-control"
import { Scrim } from "../../components/scrim"
import { trapFocus } from "../../components/trap-focus"
import styles from "./chat-panel.module.css"
import { useMessages, useSendMessage } from "./session-queries"

interface ChatPanelProps {
  initialPrompt?: string
  modal: boolean
  onClose: () => void
  sessionId: string
}

function ChatMessage({ message }: { message: MessageDto }) {
  return (
    <article className={`${styles.message} ${styles[message.role]}`}>
      <p className="sr-only">{message.role === "user" ? "You" : "Assistant"}</p>
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

function ChatMessages({ sessionId }: { sessionId: string }) {
  const messages = useMessages(sessionId, true)
  const items = messages.data ?? []
  const scrollMarker = items
    .map((message) => `${message.id}:${message.content.length}:${message.status}`)
    .join("|")

  return (
    <div className={styles.messages} role="log" aria-live="polite" aria-relevant="additions">
      {messages.isLoading ? (
        <p className={styles.chatState}>Loading conversation…</p>
      ) : messages.error && !messages.data ? (
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
      className={`${styles.composer} max-mobile:mb-[max(var(--space-4),env(safe-area-inset-bottom))]`}
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={inputId}>
        Ask about this summary
      </label>
      <ComposerField multiline>
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

export function ChatPanel({ initialPrompt, modal, onClose, sessionId }: ChatPanelProps) {
  const focusClose = useRef(!initialPrompt)
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
      {modal ? <Scrim className="z-21" onClick={onClose} /> : null}
      <aside
        className={`${styles.panel} relative z-6 flex h-full w-(--chat-panel-width) min-w-0 flex-[0_0_var(--chat-panel-width)] flex-col overflow-hidden bg-(--theme-surface-navigation) max-chat:fixed max-chat:inset-y-0 max-chat:right-0 max-chat:z-22 max-chat:h-svh max-chat:bg-(--theme-surface-navigation-solid) max-mobile:left-0 max-mobile:w-full max-mobile:flex-[0_0_auto]`}
        aria-label="Chat about this summary"
        aria-modal={modal || undefined}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <header
          className={`${styles.header} max-mobile:pt-[max(var(--space-2),env(safe-area-inset-top))]`}
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
