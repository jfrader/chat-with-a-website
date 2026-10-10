import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { createDatabaseClient } from "@chat-with-a-website/db"
import closeWithGrace from "close-with-grace"
import { z } from "zod"
import { createApiApp } from "./app"
import { createLlmFromEnvironment } from "./llm/openai"
import { DrizzleSessionRepository } from "./sessions/repository"
import { SessionService } from "./sessions/service"

const environmentSchema = z
  .object({
    NO_DATABASE: z.preprocess((value) => {
      if (value === "true" || value === "1") return true
      if (value === "false" || value === "0" || value === undefined || value === "") return false
      throw new Error("NO_DATABASE must be 'true', '1', 'false', '0', or unset")
    }, z.boolean()),
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

const environment = environmentSchema.parse(process.env)

let database: ReturnType<typeof createDatabaseClient> | undefined
let repository: import("./sessions/repository").SessionRepository

if (environment.NO_DATABASE) {
  // Scratch MemoryRepository for in-flight compute jobs only (disposed after terminal, error, abort).
  // Shared process admission budget preserved via service config (maxConcurrentGenerations).
  // Completed data never retained server-side; browser localStorage is owner.
  const { MemorySessionRepository } = await import("./sessions/test-support.js")
  repository = new MemorySessionRepository()
} else {
  if (!environment.DATABASE_URL) {
    throw new Error("DATABASE_URL required")
  }
  database = createDatabaseClient(environment.DATABASE_URL)
  repository = new DrizzleSessionRepository(database.db)
}

const sessionService = new SessionService({
  llm: createLlmFromEnvironment({
    LLM_MODEL: environment.LLM_MODEL,
    ...(environment.LLM_API_KEY ? { LLM_API_KEY: environment.LLM_API_KEY } : {}),
    ...(environment.LLM_BASE_URL ? { LLM_BASE_URL: environment.LLM_BASE_URL } : {}),
  }),
  repository,
})
if (!environment.NO_DATABASE) {
  await sessionService.initialize()
}
const staticRoot =
  environment.NODE_ENV === "production"
    ? fileURLToPath(new URL("../public", import.meta.url))
    : undefined

const app = createApiApp({
  isReady: database ? database.isReady : () => true,
  sessionService,
  databaseFree: environment.NO_DATABASE,
  ...(staticRoot ? { staticRoot } : {}),
})

const server = serve(
  {
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port: environment.PORT,
  },
  (info) => {
    console.log(`API listening on http://${info.address}:${info.port}`)
  },
)

const closeListeners = closeWithGrace({ delay: 20_000 }, async ({ err, signal }) => {
  if (err) {
    console.error("Closing after an unexpected process error", err)
  } else {
    console.log(`Closing after ${signal ?? "manual shutdown"}`)
  }

  sessionService.shutdown()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  await sessionService.waitForAll()
  if (database) {
    await database.close()
  }
  closeListeners.uninstall()
})
