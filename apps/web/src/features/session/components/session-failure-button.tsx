import type { ComponentPropsWithoutRef } from "react"

export function SessionFailureButton({
  secondary = false,
  ...props
}: ComponentPropsWithoutRef<"button"> & { secondary?: boolean }) {
  return (
    <button
      className={`min-w-42 cursor-pointer rounded-(--radius-pill) border px-6 py-3.75 disabled:cursor-default disabled:opacity-50 ${
        secondary
          ? "border-(--theme-line-subtle-color) bg-transparent text-(--theme-text-secondary)"
          : "border-(--theme-line-strong-color) bg-(image:--theme-gradient-action) text-(--theme-text-primary)"
      }`}
      {...props}
    />
  )
}
