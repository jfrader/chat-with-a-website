import { RateLimiterMemory } from "rate-limiter-flexible"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApiApp } from "../app"
import { BudgetedLlm } from "../llm/budgeted"
import { BrowserCompute } from "../sessions/browser-compute"
import { SessionService } from "../sessions/service"
import { FakeLlm, fetchedHtml, MemorySessionRepository } from "../sessions/test-support"
import { BudgetExceeded, GenerationBudget } from "./generation-budget"
import { normalizeClientAddress } from "./http-admission"
import { budgetEnvironmentSchema, defaultBudgetPolicy, DAY_SECONDS } from "./policy"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const paths = [
  "/api/sessions",
  "/api/sessions/33333333-3333-4333-8333-333333333333/regenerate",
  "/api/sessions/33333333-3333-4333-8333-333333333333/messages",
  "/api/browser/summary",
  "/api/browser/chat",
]

describe("generation admission", () => {
  it("shares client allowance across all five paths and both modes, ignoring identity headers/cookies", async () => {
    const budget = new GenerationBudget()
    const apps = [false, true].map((databaseFree) =>
      createApiApp({ databaseFree, budget, clientAddress: () => "::ffff:192.0.2.1" }),
    )
    for (const [index, path] of paths.entries()) {
      expect(
        (
          await apps[index % 2]?.request(path, {
            method: "POST",
            headers: {
              "X-Forwarded-For": `198.51.100.${index}`,
              "X-Real-IP": `203.0.113.${index}`,
              Cookie: `workspace=${index}`,
            },
            body: "{}",
          })
        )?.status,
      ).not.toBe(429)
    }
    const response = await apps[0]?.request(paths[0] ?? "", { method: "POST", body: "{}" })
    expect(response?.status).toBe(429)
    expect(response?.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/)
    expect(response?.headers.get("Cache-Control")).toBe("no-store")
    expect(await response?.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true })
    for (const path of ["/api/sessions", "/health/live", "/health/ready", "/config"]) {
      expect((await apps[0]?.request(path))?.status).not.toBe(429)
    }
    expect((await apps[0]?.request(paths[0] ?? "", { method: "DELETE" }))?.status).not.toBe(429)
    await budget.dispose()
  })

  it("enforces the same global bucket despite rotating IPs before allocating client identities", async () => {
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_GLOBAL_MINUTE: 2,
      RATE_LIMIT_MAX_CLIENTS: 1,
    })
    await budget.admit("one")
    await expect(budget.admit("two")).rejects.toBeInstanceOf(BudgetExceeded)
    await expect(budget.admit("three")).rejects.toMatchObject({
      retryAfterSeconds: expect.any(Number),
    })
    await budget.dispose()
  })

  it("rejects every generation path before reading even a streaming body or invoking jobs", async () => {
    const budget = new GenerationBudget({ ...defaultBudgetPolicy, RATE_LIMIT_CLIENT_MINUTE: 1 })
    await budget.admit("192.0.2.1")
    const app = createApiApp({ budget, clientAddress: () => "192.0.2.1" })
    for (const path of paths) {
      const body = new ReadableStream<Uint8Array>()
      const read = vi.spyOn(body, "getReader")
      const request = new Request(`http://localhost${path}`, {
        method: "POST",
        body,
        duplex: "half",
      })
      const response = await app.fetch(request)
      expect(response.status).toBe(429)
      expect(read).not.toHaveBeenCalled()
    }
    await budget.dispose()
  })

  it("rolls windows over without a short-window denial bypassing the daily ceiling", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_CLIENT_MINUTE: 1,
      RATE_LIMIT_CLIENT_DAY: 2,
    })
    await budget.admit("one")
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(budget.admit("one")).rejects.toMatchObject({
      retryAfterSeconds: expect.any(Number),
    })
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000)
    await expect(budget.admit("one")).resolves.toBeUndefined()
    await budget.dispose()
  })

  it("never evicts active identities to reset allowances; inactive identities expire", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_MAX_CLIENTS: 1,
      RATE_LIMIT_CLIENT_MINUTE: 1,
    })
    await budget.admit("one")
    await expect(budget.admit("two")).rejects.toBeInstanceOf(BudgetExceeded)
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000 + 1)
    await expect(budget.admit("two")).resolves.toBeUndefined()
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps the global daily ceiling when a short-window request is denied", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_GLOBAL_MINUTE: 1,
      RATE_LIMIT_GLOBAL_DAY: 2,
    })
    await budget.admit("one")
    await expect(budget.admit("two")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(budget.admit("three")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000)
    await expect(budget.admit("four")).resolves.toBeUndefined()
    await budget.dispose()
  })

  it("fails closed on missing socket or internal limiter failure", async () => {
    const app = createApiApp({ clientAddress: () => undefined })
    expect((await app.request(paths[0] ?? "", { method: "POST" })).status).toBe(503)
    vi.spyOn(RateLimiterMemory.prototype, "consume").mockRejectedValue(new Error("Store failed"))
    const guarded = createApiApp({ clientAddress: () => "192.0.2.1" })
    const result = await guarded.request(paths[0] ?? "", { method: "POST" })
    expect(result.status).toBe(503)
    expect(result.headers.get("Cache-Control")).toBe("no-store")
  })

  it("normalizes mapped IPv4 and groups IPv6 clients by /64", () => {
    expect(normalizeClientAddress("::ffff:192.0.2.1")).toBe(normalizeClientAddress("192.0.2.1"))
    expect(normalizeClientAddress("2001:db8:1234:abcd::1")).toBe(
      normalizeClientAddress("2001:db8:1234:abcd::ffff"),
    )
    expect(normalizeClientAddress("2001:db8:1234:abce::1")).not.toBe(
      normalizeClientAddress("2001:db8:1234:abcd::1"),
    )
    expect(() => normalizeClientAddress("forwarded.example")).toThrow()
  })

  it("uses adapter socket bindings rather than attacker-controlled forwarded headers", async () => {
    const budget = new GenerationBudget()
    const app = createApiApp({ budget })
    for (let index = 0; index < 6; index++) {
      const result = await app.fetch(
        new Request("http://localhost/api/browser/summary", {
          method: "POST",
          headers: { "X-Forwarded-For": `198.51.100.${index}`, "X-Real-IP": `192.0.2.${index}` },
          body: "{}",
        }),
        {
          incoming: {
            socket: {
              remoteAddress: `2001:db8:abcd:1234::${index + 1}`,
              remoteFamily: "IPv6",
              remotePort: 1234,
            },
          },
        },
      )
      expect(result.status).toBe(index < 5 ? 404 : 429)
    }
    await budget.dispose()
  })

  it("rejects before any real service job, page fetch or provider attempt across modes", async () => {
    const budget = new GenerationBudget({ ...defaultBudgetPolicy, RATE_LIMIT_GLOBAL_MINUTE: 1 })
    const inner = new FakeLlm(["Summary"], ['{"questions":[]}'])
    const fetchPage = vi.fn(async (url: string) => ({ finalUrl: url, html: fetchedHtml }))
    const llm = new BudgetedLlm(inner, budget)
    const repository = new MemorySessionRepository()
    const service = new SessionService({ repository, llm, fetchPage })
    const compute = new BrowserCompute({ llm, fetchPage })
    const app = createApiApp({
      budget,
      sessionService: service,
      browserCompute: compute,
      clientAddress: () => "192.0.2.1",
    })
    const first = await app.request("/api/browser/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        url: "https://example.com/article",
        attemptNumber: 1,
        generationVersion: 0,
        createdAt: new Date().toISOString(),
      }),
    })
    expect(first.status).toBe(200)
    expect(await first.text()).toContain("summary.completed")
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(inner.requests).toHaveLength(2)
    const denied = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/second",
        idempotencyKey: crypto.randomUUID(),
      }),
    })
    expect(denied.status).toBe(429)
    expect(repository.records.size).toBe(0)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(inner.requests).toHaveLength(2)
    service.shutdown()
    compute.shutdown()
    await budget.dispose()
  })

  it("rejects empty, non-finite, zero, negative and excessive policy settings", () => {
    for (const key of Object.keys(defaultBudgetPolicy)) {
      for (const value of ["", "0", "-1", "NaN", "Infinity", "1.5", "1000000000", " 5 "]) {
        expect(budgetEnvironmentSchema.safeParse({ [key]: value }).success).toBe(false)
      }
    }
    expect(budgetEnvironmentSchema.parse({})).toEqual(defaultBudgetPolicy)
  })
})
