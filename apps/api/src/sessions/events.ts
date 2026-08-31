import { type SessionStreamEvent, sessionStreamEventSchema } from "@profound/contracts"

type Subscriber = {
  closed: boolean
  pending: SessionStreamEvent | null
  wake: (() => void) | null
}

export type SessionEventSubscription = AsyncIterable<SessionStreamEvent> & {
  close(): void
}

const isTerminal = (event: SessionStreamEvent) =>
  event.type === "summary.completed" || event.type === "summary.failed"

export class SessionEventHub {
  readonly #latest = new Map<string, SessionStreamEvent>()
  readonly #subscribers = new Map<string, Set<Subscriber>>()

  publish(sessionId: string, event: SessionStreamEvent): void {
    const parsed = sessionStreamEventSchema.parse(event)
    for (const subscriber of this.#subscribers.get(sessionId) ?? []) {
      subscriber.pending = parsed
      subscriber.wake?.()
      subscriber.wake = null
    }
    if (isTerminal(parsed)) {
      this.#latest.delete(sessionId)
      this.#subscribers.delete(sessionId)
    } else {
      this.#latest.set(sessionId, parsed)
    }
  }

  clear(sessionId: string): void {
    this.#latest.delete(sessionId)
    const subscribers = this.#subscribers.get(sessionId)
    this.#subscribers.delete(sessionId)
    for (const subscriber of subscribers ?? []) {
      subscriber.closed = true
      subscriber.wake?.()
      subscriber.wake = null
    }
  }

  subscribe(
    sessionId: string,
    initial: SessionStreamEvent,
    listen: boolean,
  ): SessionEventSubscription {
    const replay = this.#latest.get(sessionId) ?? initial
    const subscriber: Subscriber = { closed: false, pending: null, wake: null }
    const shouldListen = listen && !isTerminal(replay)

    if (shouldListen) {
      const subscribers = this.#subscribers.get(sessionId) ?? new Set<Subscriber>()
      subscribers.add(subscriber)
      this.#subscribers.set(sessionId, subscribers)
    }

    const close = () => {
      if (subscriber.closed) return
      subscriber.closed = true
      subscriber.wake?.()
      subscriber.wake = null
      const subscribers = this.#subscribers.get(sessionId)
      subscribers?.delete(subscriber)
      if (subscribers?.size === 0) this.#subscribers.delete(sessionId)
    }

    return {
      close,
      async *[Symbol.asyncIterator]() {
        try {
          if (subscriber.closed) return
          yield replay
          if (!shouldListen) return

          while (!subscriber.closed) {
            if (!subscriber.pending) {
              await new Promise<void>((resolve) => {
                subscriber.wake = resolve
              })
            }
            if (subscriber.closed) return

            const event = subscriber.pending
            subscriber.pending = null
            if (!event) continue
            yield event
            if (isTerminal(event)) return
          }
        } finally {
          close()
        }
      },
    }
  }
}
