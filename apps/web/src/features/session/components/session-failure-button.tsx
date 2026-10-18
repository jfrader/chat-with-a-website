import { Button } from "@jfrader/ui"
import type { ComponentPropsWithoutRef } from "react"

export function SessionFailureButton({
  secondary = false,
  ...props
}: ComponentPropsWithoutRef<"button"> & { secondary?: boolean }) {
  return (
    <Button
      variant={secondary ? "outline" : "solid"}
      tone={secondary ? "neutral" : "accent"}
      size="lg"
      sx={{
        minWidth: "10.5rem",
        minHeight: "var(--control-height)",
        borderRadius: "var(--ui-radius-full)",
      }}
      {...props}
    />
  )
}
