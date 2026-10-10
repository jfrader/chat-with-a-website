import { z } from "zod"

const positiveInteger = (fallback: number, maximum: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .default(String(fallback))
    .transform(Number)
    .pipe(z.number().int().positive().max(maximum))

export const budgetEnvironmentSchema = z.object({
  RATE_LIMIT_CLIENT_MINUTE: positiveInteger(5, 10_000),
  RATE_LIMIT_CLIENT_DAY: positiveInteger(30, 100_000),
  RATE_LIMIT_GLOBAL_MINUTE: positiveInteger(20, 100_000),
  RATE_LIMIT_GLOBAL_DAY: positiveInteger(100, 1_000_000),
  RATE_LIMIT_PROVIDER_MINUTE: positiveInteger(20, 100_000),
  RATE_LIMIT_PROVIDER_DAY: positiveInteger(150, 1_000_000),
  RATE_LIMIT_PROVIDER_CONCURRENCY: positiveInteger(4, 64),
  RATE_LIMIT_PROVIDER_TIMEOUT_MS: positiveInteger(60_000, 300_000),
  RATE_LIMIT_MAX_CLIENTS: positiveInteger(1_024, 65_536),
})
export type BudgetPolicy = z.output<typeof budgetEnvironmentSchema>
export const defaultBudgetPolicy = Object.freeze(budgetEnvironmentSchema.parse({}))
export const MINUTE_SECONDS = 60
export const DAY_SECONDS = 86_400
