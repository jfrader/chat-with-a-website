import { createDatabaseClient } from "@chat-with-a-website/db"
import { z } from "zod"
import { createLlmFromEnvironment } from "./llm/openai"
import { BrowserCompute } from "./sessions/browser-compute"
import { DrizzleSessionRepository } from "./sessions/repository"
import { SessionService } from "./sessions/service"

export const environmentSchema = z
  .object({
    NO_DATABASE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DATABASE_URL: z.string().min(1).optional(),
    LLM_API_KEY: z.preprocess((value) => value || undefined, z.string().min(1).optional()),
    LLM_BASE_URL: z.preprocess(
      (value) => value || undefined,
      z.string().url().default("https://api.deepseek.com"),
    ),
    LLM_MODEL: z.string().min(1).default("deepseek-v4-flash"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().max(65_535).default(4311),
  })
  .refine((data) => data.NO_DATABASE || data.DATABASE_URL, {
    message: "DATABASE_URL is required unless NO_DATABASE=true",
    path: ["DATABASE_URL"],
  })

export async function createRuntime(
  environment: z.infer<typeof environmentSchema>,
  databaseFactory = createDatabaseClient,
  migrate: (() => Promise<void>) | undefined = undefined,
) {
  const llm = createLlmFromEnvironment({
    LLM_MODEL: environment.LLM_MODEL,
    ...(environment.LLM_API_KEY ? { LLM_API_KEY: environment.LLM_API_KEY } : {}),
    LLM_BASE_URL: environment.LLM_BASE_URL,
  })
  if (environment.NO_DATABASE) {
    const browserCompute = new BrowserCompute({ llm })
    return {
      database: undefined,
      worker: browserCompute,
      browserCompute,
      sessionService: undefined,
    }
  }
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required")
  await migrate?.()
  const database = databaseFactory(environment.DATABASE_URL)
  const sessionService = new SessionService({
    llm,
    repository: new DrizzleSessionRepository(database.db),
  })
  await sessionService.initialize()
  return { database, worker: sessionService, sessionService, browserCompute: undefined }
}
