import type { ComponentPropsWithoutRef } from "react"
import styles from "./composer-control.module.css"

type ComposerFieldProps = ComponentPropsWithoutRef<"div"> & {
  multiline?: boolean
}

export function ComposerField({ className, multiline = false, ...props }: ComposerFieldProps) {
  const classes = [styles.field, multiline ? styles.multiline : undefined, className]
    .filter(Boolean)
    .join(" ")

  return <div className={classes} {...props} />
}

export function ComposerIconButton({ className, ...props }: ComponentPropsWithoutRef<"button">) {
  const classes = [styles.iconButton, className].filter(Boolean).join(" ")

  return <button type="button" className={classes} {...props} />
}
