import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import closeWithGrace from "close-with-grace"
import { createApiApp } from "./app"
import { createRuntime, environmentSchema } from "./runtime"

const environment = environmentSchema.parse(process.env)

const migration = process.argv.includes("--migrate")
  ? async () => {
      await import(
        new URL("../node_modules/@chat-with-a-website/db/dist/migrate.js", import.meta.url).href
      )
    }
  : undefined
const { database, worker, sessionService, browserCompute } = await createRuntime(
  environment,
  undefined,
  migration,
)
const staticRoot =
  environment.NODE_ENV === "production"
    ? fileURLToPath(new URL("../public", import.meta.url))
    : undefined

const app = createApiApp({
  isReady: database ? database.isReady : () => true,
  ...(sessionService ? { sessionService } : {}),
  ...(browserCompute ? { browserCompute } : {}),
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

  worker.shutdown()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  await worker.waitForAll()
  if (database) {
    await database.close()
  }
  closeListeners.uninstall()
})
