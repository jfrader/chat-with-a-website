import { httpUrlSchema } from "@profound/contracts"
import { type FormEvent, useId, useRef, useState } from "react"
import styles from "./url-composer.module.css"

interface Feedback {
  kind: "error"
  message: string
}

interface UrlComposerProps {
  onSubmit: (url: string, idempotencyKey: string) => Promise<void>
}

const fallbackUrlErrorMessage = "Enter a complete http or https URL."

export function UrlComposer({ onSubmit }: UrlComposerProps) {
  const inputId = useId()
  const idempotencyKey = useRef<string | undefined>(undefined)
  const [value, setValue] = useState("")
  const [feedback, setFeedback] = useState<Feedback>()
  const [submitting, setSubmitting] = useState(false)
  const result = httpUrlSchema.safeParse(value)
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
      <div
        className={`${styles.controls} flex flex-row items-center justify-center gap-2 max-[600px]:flex-col`}
      >
        <div
          className={`${styles.field} w-[var(--control-composer-field-width)] flex-[0_0_var(--control-composer-field-width)] max-[600px]:w-[min(var(--control-composer-field-width),calc(100vw-var(--space-8)))] max-[600px]:flex-[0_0_auto]`}
        >
          <div className={styles.inputShell}>
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
              onBlur={() => {
                if (value) showValidationError()
              }}
              onChange={(event) => {
                setValue(event.target.value)
                setFeedback(undefined)
                idempotencyKey.current = undefined
              }}
            />
          </div>
          <p
            className={
              feedback?.kind === "error"
                ? `${styles.error} top-[var(--space-15)] text-left max-[600px]:top-[var(--space-30)] max-[600px]:text-center`
                : "sr-only"
            }
            id={`${inputId}-message`}
            aria-live="polite"
          >
            {feedback?.message}
          </p>
        </div>
        <button
          className={`${styles.submit} w-[var(--control-composer-action-width)] flex-[0_0_var(--control-composer-action-width)] max-[600px]:w-[min(var(--control-composer-field-width),calc(100vw-var(--space-8)))] max-[600px]:flex-[0_0_var(--control-height)]`}
          type="submit"
          disabled={!result.success || submitting}
        >
          <span>{submitting ? "Starting…" : "Summarize"}</span>
        </button>
      </div>
    </form>
  )
}
