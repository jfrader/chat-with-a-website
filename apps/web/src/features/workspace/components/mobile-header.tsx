import type { RefObject } from "react"
import { ChatIcon } from "../../../components/icons/chat-icon"
import { RegenerateIcon } from "../../../components/icons/regenerate-icon"

export function MobileHeader({
  canChat = false,
  historyTriggerRef,
  onOpenChat,
  onOpenHistory,
  onRegenerate,
  regenerating = false,
}: {
  canChat?: boolean
  historyTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenChat?: () => void
  onOpenHistory: () => void
  onRegenerate?: () => void
  regenerating?: boolean
}) {
  const buttonClass =
    "grid size-11 cursor-pointer place-items-center border-0 bg-transparent text-(--theme-text-primary) disabled:opacity-50"

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
      <img
        className="absolute left-1/2 size-6 -translate-x-1/2"
        src="/assets/profound-mark.svg"
        alt="Profound"
      />
      {canChat ? (
        <div className="flex">
          <button
            className={buttonClass}
            type="button"
            disabled={regenerating}
            onClick={() => onRegenerate?.()}
            aria-label="Regenerate summary"
          >
            <RegenerateIcon />
          </button>
          <button
            className={buttonClass}
            type="button"
            onClick={() => onOpenChat?.()}
            aria-label="Open chat"
          >
            <ChatIcon />
          </button>
        </div>
      ) : (
        <span className="size-11" />
      )}
    </header>
  )
}
