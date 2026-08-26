import { serveStatic } from "@hono/node-server/serve-static"
import { createSessionRequestSchema, healthSchema } from "@profound/contracts"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import { createApiError } from "./session-errors"
import { SessionCapacityError, type SessionServiceApi } from "./session-service"

export type ApiAppOptions = {
  isReady?: () => boolean | Promise<boolean>
  sessionService?: SessionServiceApi
  staticRoot?: string
}

const reservedApplicationPathRoots = ["/api", "/health", "/assets"] as const
const maxCreateSessionBodyBytes = 4_096

const isPathOrDescendant = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`)

const isReservedApplicationPath = (path: string) =>
  reservedApplicationPathRoots.some((root) => isPathOrDescendant(path, root))

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono()
  const isReady = options.isReady ?? (() => true)

  app.get("/health/live", (context) => context.json(healthSchema.parse({ status: "ok" })))

  app.get("/health/ready", async (context) => {
    const ready = await isReady()
    const response = healthSchema.parse({ status: ready ? "ok" : "unavailable" })
    return context.json(response, ready ? 200 : 503)
  })

  if (options.sessionService) {
    const sessionService = options.sessionService

    app.post(
      "/api/sessions",
      bodyLimit({
        maxSize: maxCreateSessionBodyBytes,
        onError: (context) => context.json(createApiError("INVALID_URL"), 413),
      }),
      async (context) => {
        const body = await context.req.json().catch(() => null)
        const request = createSessionRequestSchema.safeParse(body)
        if (!request.success) return context.json(createApiError("INVALID_URL"), 400)

        try {
          const result = await sessionService.create(request.data)
          return context.json(result.session, result.created ? 202 : 200)
        } catch (error) {
          if (error instanceof SessionCapacityError) {
            return context.json(createApiError("RATE_LIMITED"), 429)
          }
          throw error
        }
      },
    )

    app.get("/api/sessions/:id/stream", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }

      let result: Awaited<ReturnType<SessionServiceApi["stream"]>>
      try {
        result = await sessionService.stream(id)
      } catch (error) {
        if (error instanceof SessionCapacityError) {
          return context.json(createApiError("RATE_LIMITED"), 429)
        }
        throw error
      }
      if (!result) return context.json(createApiError("SESSION_NOT_FOUND"), 404)

      return streamSSE(context, async (stream) => {
        stream.onAbort(() => result.close())
        try {
          for await (const event of result.events) {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            })
          }
        } finally {
          result.close()
        }
      })
    })

    app.get("/api/sessions/:id", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }

      const session = await sessionService.get(id)
      if (!session) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      return context.json(session)
    })
  }

  app.all("/api/*", (context) => context.json(createApiError("SESSION_NOT_FOUND"), 404))

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
      "/favicon.svg",
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
    console.error("Unhandled API error", error)
    return context.json(createApiError("INTERNAL_ERROR"), 500)
  })

  return app
}
