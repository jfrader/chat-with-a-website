import {
  type SessionDto,
  type SessionStreamEvent,
  sessionStreamEventSchema,
} from "@profound/contracts"
import { createApiError } from "./session-errors"
import type { SessionRecord } from "./session-repository"

type Subscriber = {
  closed: boolean
  queue: SessionStreamEvent[]
  wake: (() => void) | null
}

export type SessionEventSubscription = AsyncIterable<SessionStreamEvent> & {
  close(): void
}

type SessionEventHubOptions = {
  maxEventsPerSession?: number
  maxRetainedSessions?: number
}

const defaultMaxEventsPerSession = 256
const defaultMaxRetainedSessions = 1_000

const isTerminalEvent = (event: SessionStreamEvent) =>
  event.type === "session.completed" || event.type === "session.failed"

export const createSessionSnapshotEvents = (
  session: SessionRecord,
  dto: SessionDto,
): SessionStreamEvent[] => {
  if (session.status === "complete") {
    return [
      sessionStreamEventSchema.parse({
        type: "session.completed",
        attemptId: session.currentAttemptId,
        session: dto,
      }),
    ]
  }

  if (session.status === "failed") {
    return [
      sessionStreamEventSchema.parse({
        type: "session.failed",
        attemptId: session.currentAttemptId,
        session: dto,
        error: createApiError(session.failureCode ?? "INTERNAL_ERROR"),
      }),
    ]
  }

  return [
    sessionStreamEventSchema.parse({
      type: "session.created",
      attemptId: session.currentAttemptId,
      session: dto,
    }),
    sessionStreamEventSchema.parse({
      type: "stage.changed",
      attemptId: session.currentAttemptId,
      stage: session.status,
    }),
  ]
}

export class SessionEventHub {
  readonly #history = new Map<string, SessionStreamEvent[]>()
  readonly #maxEventsPerSession: number
  readonly #maxRetainedSessions: number
  readonly #subscribers = new Map<string, Set<Subscriber>>()

  constructor(options: SessionEventHubOptions = {}) {
    this.#maxEventsPerSession = Math.max(
      1,
      options.maxEventsPerSession ?? defaultMaxEventsPerSession,
    )
    this.#maxRetainedSessions = Math.max(
      1,
      options.maxRetainedSessions ?? defaultMaxRetainedSessions,
    )
  }

  publish(sessionId: string, event: SessionStreamEvent): void {
    const parsedEvent = sessionStreamEventSchema.parse(event)
    if (!this.#history.has(sessionId) && this.#history.size >= this.#maxRetainedSessions) {
      const oldestSessionId = this.#history.keys().next().value
      if (oldestSessionId) this.#history.delete(oldestSessionId)
    }
    const history = this.#history.get(sessionId) ?? []
    history.push(parsedEvent)
    if (history.length > this.#maxEventsPerSession) {
      history.splice(0, history.length - this.#maxEventsPerSession)
    }
    this.#history.set(sessionId, history)

    for (const subscriber of this.#subscribers.get(sessionId) ?? []) {
      subscriber.queue.push(parsedEvent)
      if (subscriber.queue.length > this.#maxEventsPerSession) {
        subscriber.queue.splice(0, subscriber.queue.length - this.#maxEventsPerSession)
      }
      subscriber.wake?.()
      subscriber.wake = null
    }
  }

  reset(sessionId: string): void {
    this.#history.delete(sessionId)
  }

  disconnect(sessionId: string): void {
    this.#history.delete(sessionId)
    const subscribers = this.#subscribers.get(sessionId)
    this.#subscribers.delete(sessionId)

    for (const subscriber of subscribers ?? []) {
      subscriber.closed = true
      subscriber.wake?.()
      subscriber.wake = null
    }
  }

  subscribe(session: SessionRecord, dto: SessionDto, listen = true): SessionEventSubscription {
    const retainedEvents = this.#history.get(session.id)
    const replay = retainedEvents ? [...retainedEvents] : createSessionSnapshotEvents(session, dto)
    const subscriber: Subscriber = { closed: false, queue: [], wake: null }
    const shouldListen = listen && !replay.some(isTerminalEvent)

    if (shouldListen) {
      const subscribers = this.#subscribers.get(session.id) ?? new Set<Subscriber>()
      subscribers.add(subscriber)
      this.#subscribers.set(session.id, subscribers)
    }

    const removeSubscriber = () => {
      const subscribers = this.#subscribers.get(session.id)
      subscribers?.delete(subscriber)
      if (subscribers?.size === 0) this.#subscribers.delete(session.id)
    }

    const close = () => {
      subscriber.closed = true
      subscriber.wake?.()
      subscriber.wake = null
      removeSubscriber()
    }

    return {
      close,
      async *[Symbol.asyncIterator]() {
        try {
          for (const event of replay) {
            if (subscriber.closed) return
            yield event
          }
          if (!shouldListen) return

          while (!subscriber.closed) {
            if (subscriber.queue.length === 0) {
              await new Promise<void>((resolve) => {
                subscriber.wake = resolve
              })
            }

            if (subscriber.closed) return

            const event = subscriber.queue.shift()
            if (!event) continue
            yield event
            if (isTerminalEvent(event)) return
          }
        } finally {
          close()
        }
      },
    }
  }
}
