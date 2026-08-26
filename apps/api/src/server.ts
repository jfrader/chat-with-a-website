import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { createDatabaseClient } from "@profound/db"
import closeWithGrace from "close-with-grace"
import { z } from "zod"
import { createApiApp } from "./app"
import { DrizzleSessionRepository } from "./session-repository"
import { SessionService } from "./session-service"

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(4311),
})

const environment = environmentSchema.parse(process.env)
const database = createDatabaseClient(environment.DATABASE_URL)
const sessionService = new SessionService({
  repository: new DrizzleSessionRepository(database.db),
})
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

  sessionService.closeStreams()
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
