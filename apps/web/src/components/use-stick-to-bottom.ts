import { type UIEvent, useRef } from "react"

const STICK_TO_BOTTOM_THRESHOLD_PX = 48

export function useStickToBottom(initiallyStuck: boolean) {
  const stuck = useRef(initiallyStuck)

  return {
    stuck,
    follow(node: HTMLElement | null) {
      if (node && stuck.current) node.scrollTop = node.scrollHeight
    },
    handleScroll(event: UIEvent<HTMLElement>) {
      const node = event.currentTarget
      stuck.current =
        node.scrollHeight - node.scrollTop - node.clientHeight < STICK_TO_BOTTOM_THRESHOLD_PX
    },
  }
}
