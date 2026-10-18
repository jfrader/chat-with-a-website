import { Button } from "@jfrader/ui"
import type { ComponentPropsWithoutRef } from "react"

export function SummaryActionButton({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <Button
      variant="outline"
      className={className}
      sx={{
        minHeight: "var(--control-touch-target)",
        height: "auto",
        whiteSpace: "normal",
        borderRadius: "var(--ui-radius-full)",
        padding: "var(--ui-space-2) var(--ui-space-4)",
        fontSize: "var(--ui-text-size-sm)",
        color: "var(--ui-color-text-muted)",
      }}
      {...props}
    />
  )
}
