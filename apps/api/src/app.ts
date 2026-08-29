import { serveStatic } from "@hono/node-server/serve-static"
import {
  createChatRequestSchema,
  createSessionRequestSchema,
  healthSchema,
  listSessionsQuerySchema,
  listSessionsResponseSchema,
  messagesResponseSchema,
} from "@profound/contracts"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import { createApiError, ServiceError } from "./session-errors"
import type { SessionServiceApi } from "./session-service"

export type ApiAppOptions = {
  isReady?: () => boolean | Promise<boolean>
  sessionService?: SessionServiceApi
  staticRoot?: string
}

const reservedApplicationPathRoots = ["/api", "/health", "/assets"] as const
const maxCreateSessionBodyBytes = 4_096
const maxChatBodyBytes = 8_192
const streamHeartbeatIntervalMs = 15_000

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

        const result = await sessionService.create(request.data)
        return context.json(result.session, result.created ? 202 : 200)
      },
    )

    app.get("/api/sessions", async (context) => {
      const query = listSessionsQuerySchema.safeParse({
        query: context.req.query("query"),
        cursor: context.req.query("cursor"),
        limit: context.req.query("limit"),
      })
      if (!query.success) return context.json(createApiError("INVALID_URL"), 400)
      return context.json(listSessionsResponseSchema.parse(await sessionService.list(query.data)))
    })

    app.post("/api/sessions/:id/regenerate", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }
      const session = await sessionService.regenerate(id)
      if (!session) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      return context.json(session, 202)
    })

    app.get("/api/sessions/:id/stream", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }

      const result = await sessionService.stream(id)
      if (!result) return context.json(createApiError("SESSION_NOT_FOUND"), 404)

      return streamSSE(context, async (stream) => {
        stream.onAbort(() => result.close())
        const heartbeat = setInterval(
          () => void stream.write(": heartbeat\n\n"),
          streamHeartbeatIntervalMs,
        )
        heartbeat.unref()
        try {
          for await (const event of result.events) {
            await stream.writeSSE({
              data: JSON.stringify(event),
              id: event.eventId,
            })
          }
        } finally {
          clearInterval(heartbeat)
          result.close()
        }
      })
    })

    app.get("/api/sessions/:id/messages", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }
      const messages = await sessionService.messages(id)
      if (!messages) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      return context.json(messagesResponseSchema.parse({ messages }))
    })

    app.post(
      "/api/sessions/:id/messages",
      bodyLimit({
        maxSize: maxChatBodyBytes,
        onError: (context) => context.json(createApiError("INVALID_MESSAGE"), 413),
      }),
      async (context) => {
        const id = context.req.param("id")
        if (!z.uuid().safeParse(id).success) {
          return context.json(createApiError("SESSION_NOT_FOUND"), 404)
        }
        const body = await context.req.json().catch(() => null)
        const request = createChatRequestSchema.safeParse(body)
        if (!request.success) return context.json(createApiError("INVALID_MESSAGE"), 400)
        const result = await sessionService.chat(id, request.data)
        if (!result) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
        return streamSSE(context, async (stream) => {
          stream.onAbort(() => result.close())
          const heartbeat = setInterval(
            () => void stream.write(": heartbeat\n\n"),
            streamHeartbeatIntervalMs,
          )
          heartbeat.unref()
          try {
            for await (const event of result.events) {
              await stream.writeSSE({ data: JSON.stringify(event), id: event.eventId })
            }
          } finally {
            clearInterval(heartbeat)
            result.close()
          }
        })
      },
    )

    app.get("/api/sessions/:id", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }

      const session = await sessionService.get(id)
      if (!session) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      return context.json(session)
    })

    app.delete("/api/sessions/:id", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success || !(await sessionService.delete(id))) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }
      return context.body(null, 204)
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
    if (error instanceof ServiceError) {
      return context.json(createApiError(error.code), errorStatus(error.code))
    }
    console.error("Unhandled API error", error)
    return context.json(createApiError("INTERNAL_ERROR"), 500)
  })

  return app
}
