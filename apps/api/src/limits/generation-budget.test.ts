import { readFileSync } from "node:fs"
import { RateLimiterMemory } from "rate-limiter-flexible"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApiApp } from "../app"
import { BudgetedLlm } from "../llm/budgeted"
import { BrowserCompute } from "../sessions/browser-compute"
import { SessionService } from "../sessions/service"
import { FakeLlm, fetchedHtml, MemorySessionRepository } from "../sessions/test-support"
import { BudgetExceeded, BudgetUnavailable, GenerationBudget } from "./generation-budget"
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
      RATE_LIMIT_MAX_CLIENTS: 3,
    })
    await budget.admit("one")
    await expect(budget.admit("two")).resolves.toBeUndefined()
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

  it("rolls windows over without charging short-window denials to the daily ceiling", async () => {
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
    await expect(budget.admit("one")).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
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
    await expect(budget.admit("three")).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(budget.admit("four")).rejects.toBeInstanceOf(BudgetExceeded)
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

  it("fails closed after unexpected partial reservation faults and clears all allocated counters", async () => {
    vi.useFakeTimers()
    const budget = new GenerationBudget()
    const consume = vi.spyOn(RateLimiterMemory.prototype, "consume")
    consume.mockRejectedValueOnce(new Error("Unexpected failure"))
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetUnavailable)
    consume.mockRestore()
    await expect(budget.admit("two")).rejects.toBeInstanceOf(BudgetUnavailable)
    await expect(budget.acquireProvider()).rejects.toBeInstanceOf(BudgetUnavailable)
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not consume any counters when preflight state is unavailable", async () => {
    const budget = new GenerationBudget()
    const consume = vi.spyOn(RateLimiterMemory.prototype, "consume")
    vi.spyOn(RateLimiterMemory.prototype, "get").mockRejectedValueOnce(new Error("Unavailable"))
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetUnavailable)
    expect(consume).not.toHaveBeenCalled()
    await budget.dispose()
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

  it("does not let repeated capped-client denials spend global daily allowance", async () => {
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_CLIENT_MINUTE: 1,
      RATE_LIMIT_GLOBAL_DAY: 2,
    })
    await budget.admit("one")
    for (let index = 0; index < 10; index++)
      await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await expect(budget.admit("two")).resolves.toBeUndefined()
    await expect(budget.admit("three")).rejects.toBeInstanceOf(BudgetExceeded)
    await budget.dispose()
  })

  it("does not charge identity-cap denials or retain identities denied by global windows", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const capped = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_MAX_CLIENTS: 1,
      RATE_LIMIT_GLOBAL_DAY: 2,
    })
    await capped.admit("one")
    for (let index = 0; index < 3; index++)
      await expect(capped.admit("two")).rejects.toBeInstanceOf(BudgetExceeded)
    await expect(capped.admit("one")).resolves.toBeUndefined()
    await capped.dispose()

    const global = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_MAX_CLIENTS: 2,
      RATE_LIMIT_GLOBAL_MINUTE: 1,
      RATE_LIMIT_CLIENT_DAY: 1,
    })
    await global.admit("one")
    await expect(global.admit("denied")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(global.admit("two")).resolves.toBeUndefined()
    await global.dispose()
  })

  it("serializes concurrent bursts across client, global and identity ceilings without rollover leaks", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_CLIENT_MINUTE: 1,
      RATE_LIMIT_GLOBAL_MINUTE: 2,
      RATE_LIMIT_GLOBAL_DAY: 4,
      RATE_LIMIT_MAX_CLIENTS: 2,
    })
    const burst = async () => {
      const results = await Promise.allSettled(
        ["one", "one", "two", "two", "three"].map((identity) => budget.admit(identity)),
      )
      expect(results.map((result) => result.status)).toEqual([
        "fulfilled",
        "rejected",
        "fulfilled",
        "rejected",
        "rejected",
      ])
    }
    await burst()
    await vi.advanceTimersByTimeAsync(60_000)
    await burst()
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000)
    await expect(budget.admit("three")).resolves.toBeUndefined()
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("reserves the identity cap atomically during a burst of new clients", async () => {
    const budget = new GenerationBudget({ ...defaultBudgetPolicy, RATE_LIMIT_MAX_CLIENTS: 1 })
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) => budget.admit(`client-${index}`)),
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    await expect(budget.admit("client-0")).resolves.toBeUndefined()
    await budget.dispose()
  })

  it("does not spend client allowance when the global window rejects an existing identity", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_CLIENT_DAY: 2,
      RATE_LIMIT_GLOBAL_MINUTE: 1,
    })
    await budget.admit("one")
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(budget.admit("one")).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await budget.dispose()
  })

  it("does not extend rejected identities or open a short window across daily rollover", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_MAX_CLIENTS: 1,
      RATE_LIMIT_CLIENT_DAY: 1,
      RATE_LIMIT_GLOBAL_DAY: 1,
      RATE_LIMIT_PROVIDER_DAY: 1,
    })
    await budget.admit("one")
    const first = await budget.acquireProvider()
    first()
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000 - 1)
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await expect(budget.acquireProvider()).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(1)
    await expect(budget.admit("two")).resolves.toBeUndefined()
    const next = await budget.acquireProvider()
    next()
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not extend the identity registry on a client-only daily denial", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_MAX_CLIENTS: 1,
      RATE_LIMIT_CLIENT_DAY: 1,
    })
    await budget.admit("one")
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000 - 1)
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(1)
    await expect(budget.admit("two")).resolves.toBeUndefined()
    await budget.dispose()
  })

  it("charges only accepted provider reservations across concurrent windows", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_PROVIDER_MINUTE: 1,
      RATE_LIMIT_PROVIDER_DAY: 2,
    })
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => budget.acquireProvider()),
    )
    const accepted = results.filter((result) => result.status === "fulfilled")
    expect(accepted).toHaveLength(1)
    for (const result of accepted) if (result.status === "fulfilled") result.value()
    await vi.advanceTimersByTimeAsync(60_000)
    const release = await budget.acquireProvider()
    release()
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(budget.acquireProvider()).rejects.toBeInstanceOf(BudgetExceeded)
    await vi.advanceTimersByTimeAsync(DAY_SECONDS * 1_000)
    const next = await budget.acquireProvider()
    next()
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not charge concurrent provider denials and releases a slot only once", async () => {
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_PROVIDER_CONCURRENCY: 1,
      RATE_LIMIT_PROVIDER_DAY: 2,
    })
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => budget.acquireProvider()),
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const first = results[0]
    if (first?.status !== "fulfilled") throw new Error("Missing first reservation")
    first.value()
    first.value()
    const next = await budget.acquireProvider()
    await expect(budget.acquireProvider()).rejects.toBeInstanceOf(BudgetExceeded)
    next()
    await expect(budget.acquireProvider()).rejects.toBeInstanceOf(BudgetExceeded)
    await budget.dispose()
  })

  it("recognizes expired windows even before the library expiration timers run", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const budget = new GenerationBudget({
      ...defaultBudgetPolicy,
      RATE_LIMIT_CLIENT_MINUTE: 1,
      RATE_LIMIT_CLIENT_DAY: 2,
      RATE_LIMIT_GLOBAL_MINUTE: 1,
      RATE_LIMIT_GLOBAL_DAY: 2,
      RATE_LIMIT_PROVIDER_MINUTE: 1,
      RATE_LIMIT_PROVIDER_DAY: 2,
    })
    await budget.admit("one")
    const first = await budget.acquireProvider()
    first()
    vi.setSystemTime(60_000)
    await expect(budget.admit("one")).resolves.toBeUndefined()
    const second = await budget.acquireProvider()
    second()
    await expect(budget.admit("one")).rejects.toBeInstanceOf(BudgetExceeded)
    vi.setSystemTime(DAY_SECONDS * 1_000 + 1)
    await expect(budget.admit("two")).resolves.toBeUndefined()
    const next = await budget.acquireProvider()
    next()
    await budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps README and example environment quota defaults aligned with policy", () => {
    const root = new URL("../../../../", import.meta.url)
    const readme = readFileSync(new URL("README.md", root), "utf8")
    const example = readFileSync(new URL(".env.example", root), "utf8")
    const documented = Object.fromEntries(
      [...readme.matchAll(/^\| `(RATE_LIMIT_\w+)` \| (\d+) \|/gm)].map((match) => [
        match[1],
        Number(match[2]),
      ]),
    )
    const configured = Object.fromEntries(
      [...example.matchAll(/^(RATE_LIMIT_\w+)=(\d+)$/gm)].map((match) => [
        match[1],
        Number(match[2]),
      ]),
    )
    expect(documented).toEqual(defaultBudgetPolicy)
    expect(configured).toEqual(defaultBudgetPolicy)
  })
})
