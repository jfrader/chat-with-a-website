import type { ComponentPropsWithoutRef } from "react"
import borderStyles from "../gradient-border.module.css"
import styles from "./composer-control.module.css"

type ComposerFieldProps = ComponentPropsWithoutRef<"div"> & {
  variant?: "chat" | "default" | "multiline" | "search"
}

const variantClasses: Record<NonNullable<ComposerFieldProps["variant"]>, string | undefined> = {
  chat: styles.chat,
  default: undefined,
  multiline: styles.multiline,
  search: styles.search,
}

export function ComposerField({ className, variant = "default", ...props }: ComposerFieldProps) {
  const classes = [styles.field, borderStyles.gradientBorder, variantClasses[variant], className]
    .filter(Boolean)
    .join(" ")

  return <div className={classes} {...props} />
}
