import type { ComponentPropsWithoutRef } from "react"

export function SummaryActionButton({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={`min-h-(--control-touch-target) cursor-pointer rounded-(--radius-pill) border border-(--theme-line-subtle-color) bg-transparent px-4 py-2 text-xs text-(--theme-text-secondary) transition-[color,border-color,background] duration-(--motion-duration-standard) ease-(--motion-easing-standard) hover:border-(--theme-line-strong-color) hover:bg-(--theme-surface-hover) hover:text-(--theme-text-primary) ${className}`}
      {...props}
    />
  )
}
