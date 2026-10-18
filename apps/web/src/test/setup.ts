import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

Object.defineProperty(window, "scrollTo", { configurable: true, value: () => {} })

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
    this.querySelector<HTMLElement>(
      "[autofocus], button:not([disabled]), input:not([disabled])",
    )?.focus()
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
    this.dispatchEvent(new Event("close"))
  }
}

afterEach(cleanup)
