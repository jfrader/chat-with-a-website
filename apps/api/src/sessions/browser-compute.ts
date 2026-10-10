import {
  type BrowserChatRequest,
  type BrowserSummaryRequest,
  createBrowserSession,
} from "@chat-with-a-website/contracts"
import { ServiceError } from "../errors"
import { browserWorkspaceId, ScratchRepository } from "./scratch-repository"
import { SessionService, type SessionServiceOptions } from "./service"

const MAX_COMPUTE_DURATION_MS = 120_000

export class BrowserCompute {
  readonly #options: Omit<SessionServiceOptions, "repository">
  readonly #active = new Set<SessionService>()
  #accepting = true

  constructor(options: Omit<SessionServiceOptions, "repository">) {
    this.#options = options
  }

  async summary(request: BrowserSummaryRequest, signal: AbortSignal) {
    const repository = new ScratchRepository(createBrowserSession(request))
    return this.#run(repository, signal, async (service) => {
      await service.create(browserWorkspaceId, { url: request.url, idempotencyKey: request.id })
      return service.stream(browserWorkspaceId, request.id)
    })
  }

  async chat(request: BrowserChatRequest, signal: AbortSignal) {
    const repository = new ScratchRepository(request.session, request.messages)
    return this.#run(repository, signal, (service) =>
      service.chat(browserWorkspaceId, request.session.id, request.request),
    )
  }

  async #run<Event, Stream extends { close(): void; events: AsyncIterable<Event> }>(
    repository: ScratchRepository,
    signal: AbortSignal,
    start: (service: SessionService) => Promise<Stream | null>,
  ): Promise<Stream> {
    if (!this.#accepting || signal.aborted) throw new ServiceError("GENERATION_INTERRUPTED")
    if (this.#active.size >= (this.#options.maxConcurrentGenerations ?? 4))
      throw new ServiceError("RATE_LIMITED")
    const service = new SessionService({
      ...this.#options,
      repository,
      includeTerminalSource: true,
    })
    this.#active.add(service)
    const abort = () => service.shutdown()
    signal.addEventListener("abort", abort, { once: true })
    const timeout = setTimeout(abort, MAX_COMPUTE_DURATION_MS)
    timeout.unref()
    const dispose = async () => {
      service.shutdown()
      await service.waitForAll()
      repository.dispose()
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      this.#active.delete(service)
    }
    try {
      const stream = await start(service)
      if (!stream) throw new ServiceError("SESSION_NOT_FOUND")
      const events = (async function* () {
        try {
          yield* stream.events
        } finally {
          stream.close()
          await dispose()
        }
      })()
      void service.waitForAll().then(() => {
        repository.dispose()
        clearTimeout(timeout)
        signal.removeEventListener("abort", abort)
        this.#active.delete(service)
      })
      return {
        ...stream,
        events,
        close: () => {
          stream.close()
          abort()
        },
      }
    } catch (error) {
      await dispose()
      throw error
    }
  }

  shutdown(): void {
    this.#accepting = false
    for (const service of this.#active) service.shutdown()
  }

  async waitForAll(): Promise<void> {
    await Promise.all([...this.#active].map((service) => service.waitForAll()))
  }
}
