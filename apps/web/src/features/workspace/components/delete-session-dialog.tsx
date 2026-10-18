import type { SessionDto } from "@chat-with-a-website/contracts"
import { Button, Dialog } from "@jfrader/ui"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { trapFocus } from "../../../components/trap-focus"
import { useDeleteSession } from "../../session/hooks/session-queries"

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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Content
        role="alertdialog"
        onKeyDown={(event) => trapFocus(event, event.currentTarget)}
      >
        <Dialog.Panel sx={{ width: "min(100%, 420px)", padding: "var(--ui-space-6)" }}>
          <p className="m-0 text-xs text-(--theme-text-danger)">Delete summary</p>
          <Dialog.Title>Remove this summary?</Dialog.Title>
          <Dialog.Description>
            This removes the summary and its chat history. This action cannot be undone.
          </Dialog.Description>
          {confirmError || remove.error ? (
            <p className="text-(--theme-text-danger)" role="alert">
              {confirmError ?? remove.error?.message}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <Button autoFocus variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button tone="danger" disabled={remove.isPending} onClick={confirmDelete}>
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </Dialog.Panel>
      </Dialog.Content>
    </Dialog>
  )
}
