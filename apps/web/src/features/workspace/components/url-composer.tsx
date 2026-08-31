import { httpUrlSchema, type SessionDto } from "@profound/contracts"
import { useNavigate } from "@tanstack/react-router"
import {
  type FormEvent,
  type KeyboardEvent,
  useDeferredValue,
  useId,
  useRef,
  useState,
} from "react"
import { ComposerField } from "../../../components/composer-control/composer-field"
import borderStyles from "../../../components/gradient-border.module.css"
import { useSessions } from "../../session/hooks/session-queries"
import styles from "./url-composer.module.css"

interface Feedback {
  kind: "error"
  message: string
}

interface UrlComposerProps {
  onSubmit: (url: string, idempotencyKey: string) => Promise<void>
}

const fallbackUrlErrorMessage = "That doesn’t look like a webpage address."

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const stripUrlPrefix = (value: string) =>
  value
    .toLowerCase()
    .replace(/^[a-z][a-z\d+.-]*:\/\//, "")
    .replace(/^www\./, "")

const comparableUrls = (session: SessionDto) => {
  const candidates = [stripUrlPrefix(session.host)]
  for (const url of [session.canonicalUrl, session.originalUrl, session.finalUrl]) {
    if (url) candidates.push(stripUrlPrefix(url))
  }
  return candidates
}

export function UrlComposer({ onSubmit }: UrlComposerProps) {
  const inputId = useId()
  const navigate = useNavigate()
  const idempotencyKey = useRef<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const newOptionRef = useRef<HTMLButtonElement>(null)
  const matchOptionRef = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState("")
  const [feedback, setFeedback] = useState<Feedback>()
  const [submitting, setSubmitting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const result = httpUrlSchema.safeParse(normalizeUrl(value))
  const validationMessage = result.success
    ? undefined
    : (result.error.issues[0]?.message ?? fallbackUrlErrorMessage)

  const typed = stripUrlPrefix(value.trim())
  const history = useSessions(useDeferredValue(typed.slice(0, 200)))
  const match = typed
    ? history.data?.sessions.find((session) =>
        comparableUrls(session).some((candidate) => candidate.startsWith(typed)),
      )
    : undefined
  const suggestionsOpen = Boolean(match) && !dismissed && !submitting && !feedback

  function showValidationError() {
    if (!validationMessage) return

    setFeedback({ kind: "error", message: validationMessage })
  }

  async function startSummary() {
    if (!result.success) {
      showValidationError()
      return
    }

    setSubmitting(true)
    setFeedback(undefined)
    setValue(result.data)
    idempotencyKey.current ??= crypto.randomUUID()
    try {
      await onSubmit(result.data, idempotencyKey.current)
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The summary could not be started.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void startSummary()
  }

  function openMatch() {
    if (!match) return
    void navigate({ to: "/sessions/$sessionId", params: { sessionId: match.id }, search: {} })
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      ;(newOptionRef.current ?? matchOptionRef.current)?.focus()
    } else if (event.key === "Escape") {
      event.preventDefault()
      setDismissed(true)
    }
  }

  function handleSuggestionsKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const options = [newOptionRef.current, matchOptionRef.current].filter(
        (option) => option !== null,
      )
      const index = options.indexOf(document.activeElement as HTMLButtonElement)
      options[(index + 1) % options.length]?.focus()
    } else if (event.key === "Escape") {
      event.preventDefault()
      setDismissed(true)
      inputRef.current?.focus()
    }
  }

  return (
    <form className={styles.composer} noValidate onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={inputId}>
        Webpage URL
      </label>
      <div className="flex flex-row items-center justify-center gap-2 max-compact:flex-col">
        <div
          className={`${styles.field} w-(--url-composer-field-width) shrink-0 grow-0 basis-(--url-composer-field-width) max-compact:w-[min(var(--url-composer-field-width),calc(100vw-2rem))] max-compact:flex-none`}
        >
          <ComposerField>
            <span className={styles.inputIcon} aria-hidden="true">
              <img src="/assets/link.svg" alt="" />
            </span>
            <input
              ref={inputRef}
              id={inputId}
              name="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.com"
              value={value}
              disabled={submitting}
              aria-describedby={feedback ? `${inputId}-message` : undefined}
              aria-invalid={feedback?.kind === "error" || undefined}
              onKeyDown={handleInputKeyDown}
              onChange={(event) => {
                setValue(event.target.value)
                setFeedback(undefined)
                setDismissed(false)
                idempotencyKey.current = undefined
              }}
            />
          </ComposerField>
          {suggestionsOpen && match ? (
            <fieldset
              className={styles.suggestions}
              aria-label="Suggestions"
              onKeyDown={handleSuggestionsKeyDown}
            >
              {result.success ? (
                <button
                  ref={newOptionRef}
                  className={styles.suggestion}
                  type="button"
                  onClick={() => void startSummary()}
                >
                  <img src="/assets/link.svg" alt="" aria-hidden="true" />
                  <span>New summary for “{value.trim()}”</span>
                </button>
              ) : null}
              <button
                ref={matchOptionRef}
                className={`${styles.suggestion} ${styles.suggestionSession}`}
                type="button"
                onClick={openMatch}
              >
                <strong>{match.title ?? match.host}</strong>
                <span>{match.originalUrl}</span>
              </button>
            </fieldset>
          ) : null}
          <p
            className={
              feedback?.kind === "error"
                ? `${styles.error} top-15 text-left max-compact:top-30 max-compact:text-center`
                : "sr-only"
            }
            id={`${inputId}-message`}
            aria-live="polite"
          >
            {feedback?.message}
          </p>
        </div>
        <button
          className={`${styles.submit} ${borderStyles.gradientBorder} w-(--url-composer-action-width) shrink-0 grow-0 basis-(--url-composer-action-width) max-compact:w-[min(var(--url-composer-field-width),calc(100vw-2rem))] max-compact:basis-(--control-height)`}
          type="submit"
          disabled={!value.trim() || submitting}
        >
          <span>{submitting ? "Starting…" : "Summarize"}</span>
        </button>
      </div>
    </form>
  )
}
