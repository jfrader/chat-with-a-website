import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible"
import { KeyedSerialExecutor } from "../sessions/keyed-serial-executor"
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
type Bucket = { limiter: RateLimiterMemory; key: string }
const buckets = (limiters: RateLimiterMemory[], key: string): Bucket[] =>
  limiters.map((limiter) => ({ limiter, key }))

export class GenerationBudget {
  readonly policy: BudgetPolicy
  readonly #global: RateLimiterMemory[]
  readonly #provider: RateLimiterMemory[]
  readonly #client: RateLimiterMemory[]
  readonly #clients = new Map<string, number>()
  readonly #operations = new KeyedSerialExecutor()
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

  #assertOpen(): void {
    if (this.#closed) throw new BudgetUnavailable()
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    return this.#operations.run("budget", async () => {
      this.#assertOpen()
      try {
        return await operation()
      } catch (error) {
        if (error instanceof BudgetExceeded || error instanceof BudgetUnavailable) throw error
        this.#closed = true
        throw new BudgetUnavailable({ cause: error })
      }
    })
  }

  async #reserve(buckets: Bucket[]): Promise<void> {
    const states = await Promise.all(buckets.map(({ limiter, key }) => limiter.get(key)))
    this.#assertOpen()
    let retryMs = 0
    for (const state of states) {
      if (state === null) continue
      if (
        !(state instanceof RateLimiterRes) ||
        !Number.isFinite(state.msBeforeNext) ||
        !Number.isSafeInteger(state.remainingPoints) ||
        state.remainingPoints < 0
      )
        throw new Error("Invalid limiter state")
      if (state.msBeforeNext > 0 && state.remainingPoints === 0)
        retryMs = Math.max(retryMs, state.msBeforeNext)
    }
    if (retryMs > 0) throw new BudgetExceeded(Math.max(1, Math.ceil(retryMs / 1_000)))
    const consumed = await Promise.allSettled(
      buckets.map(({ limiter, key }) => limiter.consume(key)),
    )
    for (const result of consumed) if (result.status === "rejected") throw result.reason
  }

  async admit(identity: string): Promise<void> {
    return this.#run(async () => {
      const now = Date.now()
      const expired = [...this.#clients].filter(([, expiresAt]) => expiresAt <= now)
      await Promise.all(expired.flatMap(([key]) => this.#client.map((item) => item.delete(key))))
      for (const [key] of expired) this.#clients.delete(key)
      if (
        !this.#clients.has(identity) &&
        this.#clients.size >= this.policy.RATE_LIMIT_MAX_CLIENTS
      ) {
        const earliest = Math.min(...this.#clients.values())
        throw new BudgetExceeded(Math.max(1, Math.ceil((earliest - now) / 1_000)))
      }
      await this.#reserve([...buckets(this.#client, identity), ...buckets(this.#global, "global")])
      this.#clients.set(identity, Date.now() + DAY_SECONDS * 1_000)
    })
  }

  async acquireProvider(): Promise<() => void> {
    return this.#run(async () => {
      if (this.#providerActive >= this.policy.RATE_LIMIT_PROVIDER_CONCURRENCY)
        throw new BudgetExceeded(MINUTE_SECONDS)
      await this.#reserve(buckets(this.#provider, "provider"))
      this.#providerActive++
      let released = false
      return () => {
        if (released) return
        released = true
        this.#providerActive--
      }
    })
  }

  async dispose(): Promise<void> {
    this.#closed = true
    await this.#operations.run("budget", async () => {
      await Promise.all(
        [...this.#global, ...this.#provider, ...this.#client].flatMap((item) =>
          item.dump().storage.map(({ key }) => item.delete(key)),
        ),
      )
      this.#clients.clear()
    })
  }
}
