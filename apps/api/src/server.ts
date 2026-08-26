import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { createDatabaseClient } from "@profound/db"
import closeWithGrace from "close-with-grace"
import { z } from "zod"
import { createApiApp } from "./app"
import { createLlmFromEnvironment } from "./openai-llm"
import { DrizzleSessionRepository } from "./session-repository"
import { SessionService } from "./session-service"

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LLM_API_KEY: z.preprocess((value) => value || undefined, z.string().min(1).optional()),
  LLM_BASE_URL: z.preprocess((value) => value || undefined, z.string().url().optional()),
  LLM_MODEL: z.string().min(1).default("gpt-4o-mini"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(4311),
})

const environment = environmentSchema.parse(process.env)
const database = createDatabaseClient(environment.DATABASE_URL)
const sessionService = new SessionService({
  llm: createLlmFromEnvironment({
    LLM_MODEL: environment.LLM_MODEL,
    ...(environment.LLM_API_KEY ? { LLM_API_KEY: environment.LLM_API_KEY } : {}),
    ...(environment.LLM_BASE_URL ? { LLM_BASE_URL: environment.LLM_BASE_URL } : {}),
  }),
  repository: new DrizzleSessionRepository(database.db),
})
await sessionService.initialize()
const staticRoot =
  environment.NODE_ENV === "production"
    ? fileURLToPath(new URL("../public", import.meta.url))
    : undefined

const app = createApiApp({
  isReady: database.isReady,
  sessionService,
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
  await database.close()
  closeListeners.uninstall()
})
