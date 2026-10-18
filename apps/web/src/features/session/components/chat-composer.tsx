import { createChatRequestSchema } from "@chat-with-a-website/contracts"
import { Button, InputGroup } from "@jfrader/ui"
import { ArrowUp } from "lucide-react"
import { type FormEvent, useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { useSendMessage } from "../hooks/session-queries"

export function ChatComposer({
  initialPrompt,
  sessionId,
}: {
  initialPrompt?: string
  sessionId: string
}) {
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

  const sendInitialPrompt = useEffectEvent((content: string) => {
    void sendContent(content)
  })

  useEffect(() => {
    if (!initialPrompt) {
      autoSent.current = undefined
      return
    }
    if (autoSent.current === initialPrompt) return
    autoSent.current = initialPrompt
    const parsed = createChatRequestSchema.shape.content.safeParse(initialPrompt)
    if (parsed.success) sendInitialPrompt(parsed.data)
  }, [initialPrompt])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsedDraft.success || send.isPending) return
    void sendContent(parsedDraft.data)
  }

  return (
    <form
      className="relative m-4 max-mobile:mb-[max(1rem,env(safe-area-inset-bottom))]"
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={inputId}>
        Ask about this summary
      </label>
      <InputGroup
        size="lg"
        sx={{ minHeight: "var(--control-height)", paddingInlineEnd: "var(--ui-space-1)" }}
      >
        <InputGroup.Textarea
          sx={{ maxHeight: "120px", resize: "none" }}
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
        <InputGroup.Addon placement="end">
          <Button
            sx={{
              width: "var(--control-touch-target)",
              height: "var(--control-touch-target)",
              padding: 0,
            }}
            type="submit"
            disabled={!parsedDraft.success || send.isPending}
            aria-label="Send message"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </Button>
        </InputGroup.Addon>
      </InputGroup>
      <p
        className={
          send.error
            ? "absolute right-3 bottom-[calc(100%+0.5rem)] left-3 m-0 text-[11px] leading-4 text-(--theme-text-danger)"
            : "sr-only"
        }
        id={`${inputId}-error`}
        role={send.error ? "alert" : undefined}
      >
        {send.error instanceof Error ? send.error.message : ""}
      </p>
    </form>
  )
}
