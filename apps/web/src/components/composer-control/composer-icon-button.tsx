import type { ComponentPropsWithoutRef } from "react"
import styles from "./composer-control.module.css"

export function ComposerIconButton({ className, ...props }: ComponentPropsWithoutRef<"button">) {
  const classes = [styles.iconButton, className].filter(Boolean).join(" ")

  return <button type="button" className={classes} {...props} />
}
