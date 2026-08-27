import { httpUrlSchema } from "@profound/contracts"
import { type FormEvent, useId, useRef, useState } from "react"
import { ComposerField } from "../../components/composer-control"
import borderStyles from "../../components/gradient-border.module.css"
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

export function UrlComposer({ onSubmit }: UrlComposerProps) {
  const inputId = useId()
  const idempotencyKey = useRef<string | undefined>(undefined)
  const [value, setValue] = useState("")
  const [feedback, setFeedback] = useState<Feedback>()
  const [submitting, setSubmitting] = useState(false)
  const result = httpUrlSchema.safeParse(normalizeUrl(value))
  const validationMessage = result.success
    ? undefined
    : (result.error.issues[0]?.message ?? fallbackUrlErrorMessage)

  function showValidationError() {
    if (!validationMessage) return

    setFeedback({ kind: "error", message: validationMessage })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

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

  return (
    <form className={styles.composer} noValidate onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={inputId}>
        Webpage URL
      </label>
      <div className="flex flex-row items-center justify-center gap-2 max-compact:flex-col">
        <div
          className={`${styles.field} w-(--url-composer-field-width) flex-[0_0_var(--url-composer-field-width)] max-compact:w-[min(var(--url-composer-field-width),calc(100vw-var(--space-8)))] max-compact:flex-[0_0_auto]`}
        >
          <ComposerField>
            <span className={styles.inputIcon} aria-hidden="true">
              <img src="/assets/link.svg" alt="" />
            </span>
            <input
              id={inputId}
              name="url"
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              placeholder="https://example.com"
              value={value}
              disabled={submitting}
              aria-describedby={feedback ? `${inputId}-message` : undefined}
              aria-invalid={feedback?.kind === "error" || undefined}
              onChange={(event) => {
                setValue(event.target.value)
                setFeedback(undefined)
                idempotencyKey.current = undefined
              }}
            />
          </ComposerField>
          <p
            className={
              feedback?.kind === "error"
                ? `${styles.error} top-(--space-15) text-left max-compact:top-(--space-30) max-compact:text-center`
                : "sr-only"
            }
            id={`${inputId}-message`}
            aria-live="polite"
          >
            {feedback?.message}
          </p>
        </div>
        <button
          className={`${styles.submit} ${borderStyles.gradientBorder} w-(--url-composer-action-width) flex-[0_0_var(--url-composer-action-width)] max-compact:w-[min(var(--url-composer-field-width),calc(100vw-var(--space-8)))] max-compact:flex-[0_0_var(--control-height)]`}
          type="submit"
          disabled={!value.trim() || submitting}
        >
          <span>{submitting ? "Starting…" : "Summarize"}</span>
        </button>
      </div>
    </form>
  )
}
