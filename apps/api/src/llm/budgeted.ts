import { addAbortListener } from "node:events"
import { BudgetExceeded, type GenerationBudget } from "../limits/generation-budget"
import { type Llm, type LlmDelta, LlmError, type LlmRequest } from "./client"

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      listener?.[Symbol.dispose]()
      reject(new LlmError("GENERATION_INTERRUPTED"))
    }
    if (signal.aborted) {
      promise.then(
        () => {},
        () => {},
      )
      reject(new LlmError("GENERATION_INTERRUPTED"))
      return
    }
    const listener = addAbortListener(signal, abort)
    promise.then(
      (value) => {
        listener[Symbol.dispose]()
        resolve(value)
      },
      (error) => {
        listener[Symbol.dispose]()
        reject(error)
      },
    )
  })
}

export class BudgetedLlm implements Llm {
  readonly model: string
  readonly provider: string
  readonly #inner: Llm
  readonly #budget: GenerationBudget

  constructor(inner: Llm, budget: GenerationBudget) {
    this.#inner = inner
    this.#budget = budget
    this.model = inner.model
    this.provider = inner.provider
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmDelta> {
    if (request.signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
    let release: (() => void) | undefined
    const controller = new AbortController()
    const signal = AbortSignal.any([request.signal, controller.signal])
    const timeout = setTimeout(
      () => controller.abort(),
      this.#budget.policy.RATE_LIMIT_PROVIDER_TIMEOUT_MS,
    )
    timeout.unref()
    const abortCleanup = addAbortListener(signal, () => {
      clearTimeout(timeout)
      release?.()
    })
    let iterator: AsyncIterator<LlmDelta> | undefined
    try {
      release = await this.#budget.acquireProvider()
      if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
      iterator = this.#inner.stream({ ...request, signal })[Symbol.asyncIterator]()
      while (true) {
        if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
        const next = await abortable(iterator.next(), signal)
        if (next.done) return
        yield next.value
      }
    } catch (error) {
      if (error instanceof BudgetExceeded)
        throw new LlmError("LLM_RATE_LIMITED", { retryAfterSeconds: error.retryAfterSeconds })
      if (error instanceof LlmError) throw error
      throw new LlmError("LLM_UNAVAILABLE", { cause: error })
    } finally {
      controller.abort()
      abortCleanup[Symbol.dispose]()
      clearTimeout(timeout)
      release?.()
      if (iterator?.return)
        await abortable(Promise.resolve(iterator.return()), signal).catch((error) => {
          if (!(error instanceof LlmError)) throw error
        })
    }
  }
}
