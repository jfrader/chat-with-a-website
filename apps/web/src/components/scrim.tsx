import type { ComponentPropsWithoutRef } from "react"
import styles from "./scrim.module.css"

export function Scrim({ className, ...props }: ComponentPropsWithoutRef<"button">) {
  const classes = [styles.scrim, className].filter(Boolean).join(" ")

  return <button type="button" aria-hidden="true" tabIndex={-1} className={classes} {...props} />
}
