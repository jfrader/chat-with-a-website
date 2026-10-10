import { serveStatic } from "@hono/node-server/serve-static"
import { configSchema, healthSchema } from "@chat-with-a-website/contracts"
import { Hono } from "hono"
import { createApiError, ServiceError } from "./errors"
import { registerSessionRoutes } from "./routes/sessions"
import { registerBrowserRoutes } from "./routes/browser"
import type { BrowserCompute } from "./sessions/browser-compute"
import type { SessionServiceApi } from "./sessions/service"
import { GenerationBudget } from "./limits/generation-budget"
import { generationAdmission, type ClientAddressResolver } from "./limits/http-admission"
import { MINUTE_SECONDS } from "./limits/policy"

export type ApiAppOptions = {
  isReady?: () => boolean | Promise<boolean>
  sessionService?: SessionServiceApi
  staticRoot?: string
  databaseFree?: boolean
  browserCompute?: BrowserCompute
  budget?: GenerationBudget
  clientAddress?: ClientAddressResolver
}

const reservedApplicationPathRoots = ["/api", "/health", "/assets", "/config"] as const

const errorStatus = (code: ServiceError["code"]) => {
  if (code === "SESSION_NOT_FOUND") return 404 as const
  if (code === "IDEMPOTENCY_CONFLICT") return 409 as const
  if (code === "RATE_LIMITED" || code === "LLM_RATE_LIMITED") return 429 as const
  if (code === "LLM_UNAVAILABLE" || code === "GENERATION_INTERRUPTED") return 503 as const
  if (code === "INVALID_MESSAGE" || code === "INVALID_URL") return 400 as const
  return 500 as const
}

const isPathOrDescendant = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`)

const isReservedApplicationPath = (path: string) =>
  reservedApplicationPathRoots.some((root) => isPathOrDescendant(path, root))

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono()
  const isReady = options.isReady ?? (() => true)
  const databaseFree = options.databaseFree ?? false
  app.use(
    "/api/*",
    generationAdmission(options.budget ?? new GenerationBudget(), options.clientAddress),
  )

  app.get("/health/live", (context) => context.json(healthSchema.parse({ status: "ok" })))

  app.get("/health/ready", async (context) => {
    const ready = await isReady()
    const response = healthSchema.parse({ status: ready ? "ok" : "unavailable" })
    return context.json(response, ready ? 200 : 503)
  })

  app.get("/config", (context) => {
    return context.json(configSchema.parse({ databaseFree }))
  })

  if (options.browserCompute) registerBrowserRoutes(app, options.browserCompute)
  registerSessionRoutes(app, databaseFree ? undefined : options.sessionService)

  if (options.staticRoot) {
    app.use(
      "/assets/*",
      serveStatic({
        root: options.staticRoot,
        onFound(_path, context) {
          context.res.headers.set("Cache-Control", "public, max-age=31536000, immutable")
        },
      }),
    )
    app.get(
      "/app-icon.svg",
      serveStatic({
        root: options.staticRoot,
        onFound(_path, context) {
          context.res.headers.set("Cache-Control", "no-cache")
        },
      }),
    )

    const serveIndex = serveStatic({ root: options.staticRoot, path: "index.html" })

    app.get("*", async (context, next) => {
      if (isReservedApplicationPath(context.req.path)) {
        return context.notFound()
      }

      context.header("Cache-Control", "no-cache")
      return serveIndex(context, next)
    })
  }

  app.notFound((context) => {
    if (isPathOrDescendant(context.req.path, "/api")) {
      return context.json(createApiError("SESSION_NOT_FOUND"), 404)
    }

    return context.text("Not found", 404)
  })

  app.onError((error, context) => {
    if (error instanceof ServiceError) {
      context.header("Cache-Control", "no-store")
      if (error.code === "RATE_LIMITED" || error.code === "LLM_RATE_LIMITED") {
        context.header("Retry-After", String(MINUTE_SECONDS))
      }
      return context.json(createApiError(error.code), errorStatus(error.code))
    }
    console.error("Unhandled API error", error)
    return context.json(createApiError("INTERNAL_ERROR"), 500)
  })

  return app
}
