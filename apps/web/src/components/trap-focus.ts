import type { KeyboardEvent } from "react"

const focusableSelector =
  'button:not([disabled]):not([aria-hidden="true"]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function trapFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement) {
  if (event.key !== "Tab") return
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
  const first = focusable.at(0)
  const last = focusable.at(-1)
  if (!first || !last) return

  if (!container.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
