import { afterEach, describe, expect, it, vi } from "vitest"
import { createBrowserSession } from "@chat-with-a-website/contracts"
import { GenerationBudget } from "../limits/generation-budget"
import { defaultBudgetPolicy, DAY_SECONDS } from "../limits/policy"
import { createRuntime, environmentSchema } from "../runtime"
import { SessionService } from "../sessions/service"
import { FakeLlm, fetchedHtml, MemorySessionRepository } from "../sessions/test-support"
import { BudgetedLlm } from "./budgeted"
import { type Llm, type LlmDelta, LlmError } from "./client"

const request = () => ({ messages: [], signal: new AbortController().signal })
const collect = async <T>(events: AsyncIterable<T>) => {
  const result: T[] = []
  for await (const event of events) result.push(event)
  return result
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("provider budget", () => {
  it("counts attempts before network, never refunds failures, and rolls short/day windows independently", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_PROVIDER_MINUTE: 1,
      RATE_LIMIT_PROVIDER_DAY: 2,
    })
    const inner = new FakeLlm([new LlmError("LLM_UNAVAILABLE")], ["Second"])
    const llm = new BudgetedLlm(inner, budget)
    await expect(collect(llm.stream(request()))).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" })
    await expect(collect(llm.stream(request()))).rejects.toMatchObject({
      code: "LLM_RATE_LIMITED",
      retryAfterSeconds: 60,
    })
    expect(inner.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(collect(llm.stream(request()))).rejects.toMatchObject({ code: "LLM_RATE_LIMITED" })
    expect(inner.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000)
    expect(await collect(llm.stream(request()))).toEqual([{ type: "content", text: "Second" }])
    await budget.dispose()
  })

  it("releases shared concurrency on completion, abort, closed iteration and pre-abort", async () => {
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_PROVIDER_CONCURRENCY: 1,
    })
    const inner = new FakeLlm(
      async function* (input) {
        yield "Started"
        await new Promise<void>((resolve) =>
          input.signal.addEventListener("abort", () => resolve(), { once: true }),
        )
      },
      ["Next"],
      ["Closed"],
      ["After close"],
    )
    const llm = new BudgetedLlm(inner, budget)
    const controller = new AbortController()
    const first = llm.stream({ ...request(), signal: controller.signal })[Symbol.asyncIterator]()
    expect((await first.next()).value).toMatchObject({ text: "Started" })
    await expect(collect(llm.stream(request()))).rejects.toMatchObject({ code: "LLM_RATE_LIMITED" })
    controller.abort()
    expect(await collect(llm.stream(request()))).toEqual([{ type: "content", text: "Next" }])
    await first.return?.()
    const closed = llm.stream(request())[Symbol.asyncIterator]()
    await closed.next()
    await closed.return?.()
    expect(await collect(llm.stream(request()))).toEqual([{ type: "content", text: "After close" }])
    const stopped = new AbortController()
    stopped.abort()
    await expect(
      collect(llm.stream({ ...request(), signal: stopped.signal })),
    ).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    expect(inner.requests).toHaveLength(4)
    await budget.dispose()
  })

  it("times out a provider that ignores abort, releases an abandoned yielded stream and leaks no timers", async () => {
    vi.useFakeTimers()
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_PROVIDER_TIMEOUT_MS: 100,
      RATE_LIMIT_PROVIDER_CONCURRENCY: 1,
    })
    let calls = 0
    const inner: Llm = {
      model: "fake",
      provider: "fake",
      stream() {
        calls++
        return {
          [Symbol.asyncIterator]() {
            return { next: () => new Promise<IteratorResult<LlmDelta>>(() => {}) }
          },
        }
      },
    }
    const llm = new BudgetedLlm(inner, budget)
    const result = collect(llm.stream(request()))
    const rejection = expect(result).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    await vi.advanceTimersByTimeAsync(101)
    await rejection
    const next = collect(llm.stream(request()))
    const nextRejection = expect(next).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    await vi.advanceTimersByTimeAsync(101)
    await nextRejection
    expect(calls).toBe(2)
    const yielded = new BudgetedLlm(new FakeLlm(["One"], ["Two"]), budget)
    const abandoned = yielded.stream(request())[Symbol.asyncIterator]()
    await abandoned.next()
    await vi.advanceTimersByTimeAsync(101)
    expect(await collect(yielded.stream(request()))).toEqual([{ type: "content", text: "Two" }])
    await abandoned.return?.()
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("counts summary extras but completes the summary when extras admission is denied", async () => {
    const budget = new GenerationBudget({ ...defaultBudgetPolicy, RATE_LIMIT_PROVIDER_MINUTE: 1 })
    const inner = new FakeLlm(["A useful summary"], ['{"questions":["Should not run"]}'])
    const repository = new MemorySessionRepository()
    const service = new SessionService({
      repository,
      llm: new BudgetedLlm(inner, budget),
      fetchPage: async (url) => ({ finalUrl: url, html: fetchedHtml }),
    })
    const created = await service.create("workspace", {
      url: "https://example.com/article",
      idempotencyKey: crypto.randomUUID(),
    })
    await service.waitForAll()
    expect(await service.get("workspace", created.session.id)).toMatchObject({
      status: "complete",
      summary: "A useful summary",
      suggestedPrompts: [],
    })
    expect(inner.requests).toHaveLength(1)
    const second = await service.create("workspace", {
      url: "https://example.com/second",
      idempotencyKey: crypto.randomUUID(),
    })
    const events = await service.stream("workspace", second.session.id)
    if (!events) throw new Error("Missing stream")
    expect((await collect(events.events)).at(-1)).toMatchObject({
      type: "summary.failed",
      error: { code: "LLM_RATE_LIMITED", message: expect.stringContaining("Wait") },
    })
    expect(inner.requests).toHaveLength(1)
    await budget.dispose()
  })

  it("does not refund an aborted paid attempt", async () => {
    const budget = new GenerationBudget({ ...defaultBudgetPolicy, RATE_LIMIT_PROVIDER_DAY: 1 })
    const inner = new FakeLlm(["Started"], ["Must not call"])
    const llm = new BudgetedLlm(inner, budget)
    const controller = new AbortController()
    const stream = llm.stream({ ...request(), signal: controller.signal })[Symbol.asyncIterator]()
    await stream.next()
    controller.abort()
    await stream.return?.()
    await expect(collect(llm.stream(request()))).rejects.toMatchObject({ code: "LLM_RATE_LIMITED" })
    expect(inner.requests).toHaveLength(1)
    await budget.dispose()
  })

  it("finishes service jobs on timeout even when the provider iterator ignores abort", async () => {
    vi.useFakeTimers()
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_PROVIDER_TIMEOUT_MS: 100,
    })
    const inner = new FakeLlm(async function* () {
      await new Promise<void>(() => {})
      yield "Never"
    })
    const service = new SessionService({
      repository: new MemorySessionRepository(),
      llm: new BudgetedLlm(inner, budget),
      fetchPage: async (url) => ({ finalUrl: url, html: fetchedHtml }),
    })
    const created = await service.create("workspace", {
      url: "https://example.com",
      idempotencyKey: crypto.randomUUID(),
    })
    const finished = service.waitForAll()
    await vi.advanceTimersByTimeAsync(101)
    await finished
    expect(await service.get("workspace", created.session.id)).toMatchObject({
      status: "failed",
      failureCode: "GENERATION_INTERRUPTED",
    })
    service.shutdown()
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("runtime fake-provider injection is guarded in database-free mode", async () => {
    const inner = new FakeLlm(["One"])
    const runtime = await createRuntime(
      environmentSchema.parse({ NO_DATABASE: "true", RATE_LIMIT_PROVIDER_MINUTE: "1" }),
      undefined,
      undefined,
      () => inner,
    )
    if (!runtime.browserCompute) throw new Error("Missing browser compute")
    const body = {
      session: {
        ...createBrowserSession({
          id: crypto.randomUUID(),
          url: "https://example.com",
          attemptNumber: 1,
          generationVersion: 0,
          createdAt: new Date().toISOString(),
        }),
        status: "complete" as const,
        sourceText: "Source facts",
      },
      messages: [],
      request: { content: "Question", idempotencyKey: crypto.randomUUID() },
    }
    expect(
      (await collect((await runtime.browserCompute.chat(body, request().signal)).events)).at(-1)
        ?.type,
    ).toBe("chat.completed")
    const denied = await collect(
      (
        await runtime.browserCompute.chat(
          { ...body, request: { ...body.request, idempotencyKey: crypto.randomUUID() } },
          request().signal,
        )
      ).events,
    )
    expect(denied.at(-1)).toMatchObject({
      type: "chat.failed",
      error: { code: "LLM_RATE_LIMITED" },
    })
    expect(inner.requests).toHaveLength(1)
    runtime.worker.shutdown()
    await runtime.budget.dispose()
  })
})
