import { Button } from "@jfrader/ui"
import type { ComponentPropsWithoutRef } from "react"

export function Scrim({ className, ...props }: ComponentPropsWithoutRef<"button">) {
  return (
    <Button
      variant="ghost"
      sx={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        borderRadius: 0,
        background: "var(--ui-color-scrim)",
        "&:hover": { background: "var(--ui-color-scrim)" },
      }}
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      className={className}
      {...props}
    />
  )
}
