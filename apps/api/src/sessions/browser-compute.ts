import {
  type BrowserChatRequest,
  type BrowserSummaryRequest,
  createBrowserSession,
} from "@chat-with-a-website/contracts"
import { ServiceError } from "../errors"
import { defaultBudgetPolicy } from "../limits/policy"
import { DEFAULT_FETCH_TIMEOUT_MS } from "../webpage/secure-fetch"
import { browserWorkspaceId, ScratchRepository } from "./scratch-repository"
import { SessionService, type SessionServiceOptions } from "./service"

const SUMMARY_PROVIDER_CALLS = 2
const CHAT_PROVIDER_CALLS = 1
type BrowserComputeOptions = Omit<SessionServiceOptions, "repository"> & {
  providerTimeoutMs?: number
}

export class BrowserCompute {
  readonly #options: Omit<SessionServiceOptions, "repository">
  readonly #providerTimeoutMs: number
  readonly #maxConcurrentGenerations: number
  readonly #active = new Set<SessionService>()
  #accepting = true

  constructor({
    providerTimeoutMs = defaultBudgetPolicy.RATE_LIMIT_PROVIDER_TIMEOUT_MS,
    ...options
  }: BrowserComputeOptions) {
    this.#providerTimeoutMs = providerTimeoutMs
    this.#maxConcurrentGenerations =
      options.maxConcurrentGenerations ?? defaultBudgetPolicy.RATE_LIMIT_PROVIDER_CONCURRENCY
    this.#options = { ...options, maxConcurrentGenerations: this.#maxConcurrentGenerations }
  }

  async summary(request: BrowserSummaryRequest, signal: AbortSignal) {
    const repository = new ScratchRepository(createBrowserSession(request))
    return this.#run(repository, signal, SUMMARY_PROVIDER_CALLS, async (service) => {
      await service.create(browserWorkspaceId, { url: request.url, idempotencyKey: request.id })
      return service.stream(browserWorkspaceId, request.id)
    })
  }

  async chat(request: BrowserChatRequest, signal: AbortSignal) {
    const repository = new ScratchRepository(request.session, request.messages)
    return this.#run(repository, signal, CHAT_PROVIDER_CALLS, (service) =>
      service.chat(browserWorkspaceId, request.session.id, request.request),
    )
  }

  async #run<Event, Stream extends { close(): void; events: AsyncIterable<Event> }>(
    repository: ScratchRepository,
    signal: AbortSignal,
    providerCalls: number,
    start: (service: SessionService) => Promise<Stream | null>,
  ): Promise<Stream> {
    if (!this.#accepting || signal.aborted) throw new ServiceError("GENERATION_INTERRUPTED")
    if (this.#active.size >= this.#maxConcurrentGenerations) throw new ServiceError("RATE_LIMITED")
    const service = new SessionService({
      ...this.#options,
      repository,
      includeTerminalSource: true,
    })
    this.#active.add(service)
    const abort = () => service.shutdown()
    signal.addEventListener("abort", abort, { once: true })
    const timeout = setTimeout(
      abort,
      DEFAULT_FETCH_TIMEOUT_MS + providerCalls * this.#providerTimeoutMs,
    )
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
