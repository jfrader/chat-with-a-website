import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible"
import {
  budgetEnvironmentSchema,
  DAY_SECONDS,
  defaultBudgetPolicy,
  MINUTE_SECONDS,
  type BudgetPolicy,
} from "./policy"

export class BudgetExceeded extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests. Wait and retry.")
  }
}
export class BudgetUnavailable extends Error {
  constructor(options?: ErrorOptions) {
    super("Request limits are unavailable. Retry later.", options)
  }
}

const limiter = (points: number, duration: number) => new RateLimiterMemory({ points, duration })

export class GenerationBudget {
  readonly policy: BudgetPolicy
  readonly #global: RateLimiterMemory[]
  readonly #provider: RateLimiterMemory[]
  readonly #client: RateLimiterMemory[]
  readonly #clients = new Map<string, number>()
  #providerActive = 0
  #closed = false

  constructor(policy: BudgetPolicy = defaultBudgetPolicy) {
    this.policy = Object.freeze(
      budgetEnvironmentSchema.parse(
        Object.fromEntries(Object.entries(policy).map(([key, value]) => [key, String(value)])),
      ),
    )
    policy = this.policy
    this.#global = [
      limiter(policy.RATE_LIMIT_GLOBAL_MINUTE, MINUTE_SECONDS),
      limiter(policy.RATE_LIMIT_GLOBAL_DAY, DAY_SECONDS),
    ]
    this.#provider = [
      limiter(policy.RATE_LIMIT_PROVIDER_MINUTE, MINUTE_SECONDS),
      limiter(policy.RATE_LIMIT_PROVIDER_DAY, DAY_SECONDS),
    ]
    this.#client = [
      limiter(policy.RATE_LIMIT_CLIENT_MINUTE, MINUTE_SECONDS),
      limiter(policy.RATE_LIMIT_CLIENT_DAY, DAY_SECONDS),
    ]
  }

  async #consume(limiters: RateLimiterMemory[], key: string): Promise<void> {
    if (this.#closed) throw new BudgetUnavailable()
    const results = await Promise.allSettled(limiters.map((item) => item.consume(key)))
    if (this.#closed) throw new BudgetUnavailable()
    let retryMs = 0
    for (const result of results) {
      if (result.status === "fulfilled") continue
      if (!(result.reason instanceof RateLimiterRes))
        throw new BudgetUnavailable({ cause: result.reason })
      if (!Number.isFinite(result.reason.msBeforeNext) || result.reason.msBeforeNext < 0)
        throw new BudgetUnavailable({ cause: result.reason })
      retryMs = Math.max(retryMs, result.reason.msBeforeNext, 1)
    }
    if (retryMs > 0) throw new BudgetExceeded(Math.max(1, Math.ceil(retryMs / 1_000)))
  }

  async admit(identity: string): Promise<void> {
    await this.#consume(this.#global, "global")
    const now = Date.now()
    const expired = [...this.#clients].filter(([, expiresAt]) => expiresAt <= now)
    for (const [key] of expired) this.#clients.delete(key)
    await Promise.all(expired.flatMap(([key]) => this.#client.map((item) => item.delete(key))))
    if (!this.#clients.has(identity) && this.#clients.size >= this.policy.RATE_LIMIT_MAX_CLIENTS) {
      const earliest = Math.min(...this.#clients.values())
      throw new BudgetExceeded(Math.max(1, Math.ceil((earliest - now) / 1_000)))
    }
    this.#clients.set(identity, now + DAY_SECONDS * 1_000)
    await this.#consume(this.#client, identity)
  }

  async acquireProvider(): Promise<() => void> {
    if (this.#closed) throw new BudgetUnavailable()
    if (this.#providerActive >= this.policy.RATE_LIMIT_PROVIDER_CONCURRENCY)
      throw new BudgetExceeded(MINUTE_SECONDS)
    this.#providerActive++
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.#providerActive--
    }
    try {
      await this.#consume(this.#provider, "provider")
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  async dispose(): Promise<void> {
    this.#closed = true
    await Promise.all([
      ...this.#global.map((item) => item.delete("global")),
      ...this.#provider.map((item) => item.delete("provider")),
      ...[...this.#clients.keys()].flatMap((key) => this.#client.map((item) => item.delete(key))),
    ])
    this.#clients.clear()
  }
}
