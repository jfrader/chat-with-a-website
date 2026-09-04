export function HistoryHeader({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggle,
}: {
  collapsed: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
  onToggle: () => void
}) {
  return (
    <header className="relative z-2 flex h-16 w-full items-center justify-between border-b border-(--theme-line-subtle-color) px-6 py-4 max-mobile:h-12 max-mobile:border-b-0 max-mobile:px-4 max-mobile:py-2">
      <img
        className={`size-6 flex-none object-contain transition-opacity duration-120 ease-(--motion-easing-standard) ${collapsed && !mobileOpen ? "opacity-0" : ""}`}
        src="/assets/logo-mark.svg"
        alt="Chat With a Website"
      />
      {mobileOpen ? (
        <button
          ref={(node) => node?.focus()}
          className="hidden size-11 cursor-pointer place-items-center border-0 bg-transparent p-3 text-(--theme-text-muted) max-mobile:grid"
          type="button"
          onClick={onCloseMobile}
          aria-label="Close summary history"
        >
          ×
        </button>
      ) : null}
      <button
        className={`absolute top-2.5 grid size-11 cursor-pointer place-items-center border-0 bg-transparent p-3 text-(--theme-text-muted) transition-[right] duration-180 ease-(--motion-easing-standard) max-mobile:hidden ${collapsed ? "right-0.5" : "right-2.5"}`}
        type="button"
        aria-controls="summary-history-content"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand summary history" : "Collapse summary history"}
        onClick={onToggle}
      >
        <img
          className={`size-3 transition-[filter,transform] duration-180 ease-(--motion-easing-standard) hover:brightness-150 ${collapsed ? "rotate-180" : ""}`}
          src="/assets/collapse-sidebar.svg"
          alt=""
        />
      </button>
    </header>
  )
}
