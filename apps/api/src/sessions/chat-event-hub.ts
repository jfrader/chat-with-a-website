import { type ChatStreamEvent, chatStreamEventSchema } from "@profound/contracts"

export type ChatEventStream = { close(): void; events: AsyncIterable<ChatStreamEvent> }

type ChatCreatedEvent = Extract<ChatStreamEvent, { type: "chat.created" }>
type ChatDeltaEvent = Extract<ChatStreamEvent, { type: "chat.delta" }>
type ChatReasoningEvent = Extract<ChatStreamEvent, { type: "chat.reasoning" }>
type ChatTerminalEvent = Extract<ChatStreamEvent, { type: "chat.completed" | "chat.failed" }>

type ChatSubscriber = {
  closed: boolean
  first: ChatCreatedEvent | ChatTerminalEvent
  pendingDelta: ChatDeltaEvent | null
  pendingReasoning: ChatReasoningEvent | null
  started: boolean
  terminal: ChatTerminalEvent | null
  wake: (() => void) | null
}

type ChatState = {
  created: ChatCreatedEvent
  delta: ChatDeltaEvent | null
  reasoning: ChatReasoningEvent | null
}

const isChatTerminal = (event: ChatStreamEvent): event is ChatTerminalEvent =>
  event.type === "chat.completed" || event.type === "chat.failed"

const coalesceChatText = <T extends ChatDeltaEvent | ChatReasoningEvent>(
  current: T | null,
  next: T,
): T => {
  if (!current) return next
  if (
    current.messageId !== next.messageId ||
    current.requestId !== next.requestId ||
    current.offset + current.delta.length !== next.offset
  ) {
    throw new Error("Chat deltas must be contiguous")
  }
  const coalesced = chatStreamEventSchema.parse({
    ...current,
    delta: current.delta + next.delta,
  })
  if (coalesced.type !== current.type) throw new Error("Failed to coalesce chat delta")
  return coalesced as T
}

export class ChatEventHub {
  readonly #active = new Map<string, ChatState>()
  readonly #subscribers = new Map<string, Set<ChatSubscriber>>()

  publish(messageId: string, event: ChatStreamEvent): void {
    const parsed = chatStreamEventSchema.parse(event)
    if (parsed.type === "chat.created") {
      const state = this.#active.get(messageId)
      if (state) state.created = parsed
      else this.#active.set(messageId, { created: parsed, delta: null, reasoning: null })
      for (const subscriber of this.#subscribers.get(messageId) ?? []) {
        if (!subscriber.started) subscriber.first = parsed
      }
      return
    }
    if (parsed.type === "chat.delta" || parsed.type === "chat.reasoning") {
      const state = this.#active.get(messageId)
      if (!state) throw new Error("Chat delta published before chat.created")
      for (const subscriber of this.#subscribers.get(messageId) ?? []) {
        if (parsed.type === "chat.delta") {
          subscriber.pendingDelta = coalesceChatText(subscriber.pendingDelta, parsed)
        } else {
          subscriber.pendingReasoning = coalesceChatText(subscriber.pendingReasoning, parsed)
        }
        subscriber.wake?.()
        subscriber.wake = null
      }
      if (parsed.type === "chat.delta") state.delta = coalesceChatText(state.delta, parsed)
      else state.reasoning = coalesceChatText(state.reasoning, parsed)
      return
    }
    for (const subscriber of this.#subscribers.get(messageId) ?? []) {
      subscriber.terminal = parsed
      subscriber.wake?.()
      subscriber.wake = null
    }
    this.#active.delete(messageId)
    this.#subscribers.delete(messageId)
  }

  clear(messageId: string): void {
    this.#active.delete(messageId)
    for (const subscriber of this.#subscribers.get(messageId) ?? []) {
      subscriber.closed = true
      subscriber.wake?.()
    }
    this.#subscribers.delete(messageId)
  }

  subscribe(messageId: string, initial: ChatStreamEvent, listen: boolean): ChatEventStream {
    const parsed = chatStreamEventSchema.parse(initial)
    if (parsed.type === "chat.delta" || parsed.type === "chat.reasoning")
      throw new Error("Chat subscription requires authoritative state")
    const terminal = isChatTerminal(parsed)
    const state = terminal
      ? null
      : (this.#active.get(messageId) ?? { created: parsed, delta: null, reasoning: null })
    if (state && listen && !this.#active.has(messageId)) this.#active.set(messageId, state)
    const subscriber: ChatSubscriber = {
      closed: false,
      first: state?.created ?? parsed,
      pendingDelta: state?.delta ?? null,
      pendingReasoning: state?.reasoning ?? null,
      started: false,
      terminal: terminal ? parsed : null,
      wake: null,
    }
    if (listen && !terminal) {
      const subscribers = this.#subscribers.get(messageId) ?? new Set<ChatSubscriber>()
      subscribers.add(subscriber)
      this.#subscribers.set(messageId, subscribers)
    }
    const close = () => {
      if (subscriber.closed) return
      subscriber.closed = true
      subscriber.wake?.()
      const subscribers = this.#subscribers.get(messageId)
      subscribers?.delete(subscriber)
      if (subscribers?.size === 0) this.#subscribers.delete(messageId)
    }
    return {
      close,
      events: {
        async *[Symbol.asyncIterator]() {
          try {
            if (subscriber.closed) return
            subscriber.started = true
            yield subscriber.first
            if (!listen || terminal) return
            while (!subscriber.closed) {
              if (
                !subscriber.pendingDelta &&
                !subscriber.pendingReasoning &&
                !subscriber.terminal
              ) {
                await new Promise<void>((resolve) => {
                  subscriber.wake = resolve
                })
              }
              if (subscriber.closed) return
              if (subscriber.pendingReasoning) {
                const reasoning = subscriber.pendingReasoning
                subscriber.pendingReasoning = null
                yield reasoning
                continue
              }
              if (subscriber.pendingDelta) {
                const delta = subscriber.pendingDelta
                subscriber.pendingDelta = null
                yield delta
                continue
              }
              if (subscriber.terminal) {
                yield subscriber.terminal
                return
              }
            }
          } finally {
            close()
          }
        },
      },
    }
  }
}
