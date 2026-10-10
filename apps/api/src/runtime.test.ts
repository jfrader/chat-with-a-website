import { describe, expect, it, vi } from "vitest"
import { createApiApp } from "./app"
import { createLlmFromEnvironment } from "./llm/openai"
import { createRuntime, environmentSchema } from "./runtime"

describe("database-free runtime", () => {
  it("defaults to PostgreSQL and accepts only explicit boolean text", () => {
    expect(environmentSchema.parse({ DATABASE_URL: "postgresql://example" }).NO_DATABASE).toBe(
      false,
    )
    expect(
      environmentSchema.parse({ DATABASE_URL: "postgresql://example", NO_DATABASE: "false" })
        .NO_DATABASE,
    ).toBe(false)
    expect(environmentSchema.parse({ NO_DATABASE: "true" }).NO_DATABASE).toBe(true)
    expect(environmentSchema.safeParse({}).success).toBe(false)
    for (const flag of ["1", "0", "", "TRUE", "yes"]) {
      expect(
        environmentSchema.safeParse({ NO_DATABASE: flag, DATABASE_URL: "postgresql://example" })
          .success,
      ).toBe(false)
    }
  })
  it("validates the optional provider token-limit field", async () => {
    for (const value of ["max_tokens", "max_completion_tokens"]) {
      expect(
        environmentSchema.parse({ NO_DATABASE: "true", LLM_TOKEN_LIMIT_FIELD: value })
          .LLM_TOKEN_LIMIT_FIELD,
      ).toBe(value)
    }
    for (const value of ["", "tokens", "MAX_TOKENS"]) {
      expect(
        environmentSchema.safeParse({ NO_DATABASE: "true", LLM_TOKEN_LIMIT_FIELD: value }).success,
      ).toBe(false)
    }
    const llmFactory = vi.fn(() => createLlmFromEnvironment({ LLM_MODEL: "test" }))
    const runtime = await createRuntime(
      environmentSchema.parse({ NO_DATABASE: "true", LLM_TOKEN_LIMIT_FIELD: "max_tokens" }),
      undefined,
      undefined,
      llmFactory,
    )
    expect(llmFactory).toHaveBeenCalledWith(
      expect.objectContaining({ LLM_TOKEN_LIMIT_FIELD: "max_tokens" }),
    )
    runtime.worker.shutdown()
    await runtime.budget.dispose()
  })
  it("does not construct a database or migrate even with an unreachable URL", async () => {
    const database = vi.fn(() => {
      throw new Error("must not connect")
    })
    const migrate = vi.fn(async () => {
      throw new Error("must not migrate")
    })
    const runtime = await createRuntime(
      environmentSchema.parse({ NO_DATABASE: "true", DATABASE_URL: "postgresql://unreachable" }),
      database,
      migrate,
    )
    expect(database).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
    expect(runtime.database).toBeUndefined()
    if (!runtime.browserCompute) throw new Error("Missing browser compute")
    const app = createApiApp({ databaseFree: true, browserCompute: runtime.browserCompute })
    expect(await (await app.request("/config")).json()).toEqual({ databaseFree: true })
    expect((await app.request("/health/ready")).status).toBe(200)
    expect((await app.request("/api/sessions")).status).toBe(404)
    runtime.worker.shutdown()
  })
  it("retains default migration-before-database startup and runtime mode", async () => {
    const order: string[] = []
    const database = vi.fn(() => {
      order.push("database")
      throw new Error("database boundary")
    })
    const migrate = vi.fn(async () => {
      order.push("migration")
    })
    await expect(
      createRuntime(
        environmentSchema.parse({ DATABASE_URL: "postgresql://example", NO_DATABASE: "false" }),
        database,
        migrate,
      ),
    ).rejects.toThrow("database boundary")
    expect(order).toEqual(["migration", "database"])
    expect(await (await createApiApp().request("/config")).json()).toEqual({ databaseFree: false })
  })
})
