import type { SessionDto } from "@profound/contracts"
import { useNavigate, useParams } from "@tanstack/react-router"
import { type KeyboardEvent, useRef, useState } from "react"
import { trapFocus } from "../../../components/trap-focus"
import { useDeleteSession } from "../../session/hooks/session-queries"
import styles from "./history-navigation.module.css"

export function DeleteSessionDialog({
  onClose,
  session,
}: {
  onClose: () => void
  session: SessionDto
}) {
  const navigate = useNavigate()
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const remove = useDeleteSession()
  const [confirmError, setConfirmError] = useState<string>()
  const dialogRef = useRef<HTMLElement>(null)
  const focusCancel = useRef(true)

  async function confirmDelete() {
    setConfirmError(undefined)
    try {
      await remove.mutateAsync(session.id)
      if (session.id === sessionId) await navigate({ to: "/", search: {} })
      else onClose()
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "The summary could not be deleted.")
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (dialogRef.current) trapFocus(event, dialogRef.current)
  }

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-(--theme-surface-scrim) p-6"
      role="presentation"
    >
      <section
        ref={dialogRef}
        className={`${styles.dialog} w-[min(100%,420px)] rounded-(--radius-card) border border-(--theme-line-subtle-color) bg-(--theme-surface-elevated) p-6`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        onKeyDown={handleKeyDown}
      >
        <p className="m-0 text-xs text-(--theme-text-danger)">Delete summary</p>
        <h2 className="mt-2 mb-0 text-2xl" id="delete-title">
          Remove this summary?
        </h2>
        <p
          className="mt-3 mb-0 text-sm leading-5.5 text-(--theme-text-secondary)"
          id="delete-description"
        >
          This removes the summary and its chat history. This action cannot be undone.
        </p>
        {confirmError || remove.error ? (
          <p className="text-(--theme-text-danger)" role="alert">
            {confirmError ?? remove.error?.message}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={(node) => {
              if (node && focusCancel.current) {
                focusCancel.current = false
                node.focus()
              }
            }}
            className="min-h-(--control-touch-target) cursor-pointer rounded-(--radius-pill) border border-(--theme-line-subtle-color) bg-(--theme-surface-hover) px-5 py-2 text-(--theme-text-primary)"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="min-h-(--control-touch-target) cursor-pointer rounded-(--radius-pill) border border-(--theme-border-danger) bg-(--theme-surface-hover) px-5 py-2 text-(--theme-text-danger) disabled:cursor-default disabled:text-(--theme-text-disabled)"
            type="button"
            disabled={remove.isPending}
            onClick={confirmDelete}
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </section>
    </div>
  )
}
