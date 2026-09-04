import type { ComponentPropsWithoutRef } from "react"
import styles from "./history-menu-button.module.css"

type HistoryMenuButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant: "copy" | "delete" | "download"
}

const variantClasses: Record<HistoryMenuButtonProps["variant"], string> = {
  copy: `${styles.copy} w-10 justify-center p-0 text-(--theme-surface-app)`,
  delete: `${styles.delete} text-(--theme-text-primary)`,
  download: `${styles.download} text-(--theme-text-primary)`,
}

export function HistoryMenuButton({ className = "", variant, ...props }: HistoryMenuButtonProps) {
  return (
    <button
      className={`${styles.button} flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-(--radius-pill) border-0 px-4 text-xs leading-4 hover:brightness-150 disabled:cursor-default disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  )
}
