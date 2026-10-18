import { Button } from "@jfrader/ui"
import type { ComponentProps } from "react"

type HistoryMenuButtonProps = Omit<ComponentProps<typeof Button>, "variant"> & {
  variant: "copy" | "delete" | "download"
}

export function HistoryMenuButton({ variant, ...props }: HistoryMenuButtonProps) {
  return <Button variant="soft" tone={variant === "delete" ? "danger" : "neutral"} {...props} />
}
