import {
  createChatRequestSchema,
  createSessionRequestSchema,
  listSessionsQuerySchema,
  listSessionsResponseSchema,
  messagesResponseSchema,
} from "@profound/contracts"
import type { Context, Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { getCookie, setCookie } from "hono/cookie"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import { createApiError } from "../errors"
import type { SessionServiceApi } from "../sessions/service"

const maxCreateSessionBodyBytes = 4_096
const maxChatBodyBytes = 8_192
const streamHeartbeatIntervalMs = 15_000
const workspaceCookieName = "profound_workspace"
const workspaceCookieMaxAgeSeconds = 60 * 60 * 24 * 365

const getWorkspaceId = (context: Context): string => {
  const workspaceId = z.uuid().safeParse(getCookie(context, workspaceCookieName))
  if (workspaceId.success) return workspaceId.data

  const createdWorkspaceId = crypto.randomUUID()
  setCookie(context, workspaceCookieName, createdWorkspaceId, {
    httpOnly: true,
    maxAge: workspaceCookieMaxAgeSeconds,
    path: "/",
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
  })
  return createdWorkspaceId
}

type EventStream<Event> = {
  close(): void
  events: AsyncIterable<Event>
}

const streamEvents = <Event extends { eventId: string }>(
  context: Context,
  result: EventStream<Event>,
) =>
  streamSSE(context, async (stream) => {
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

export function registerSessionRoutes(app: Hono, sessionService?: SessionServiceApi): void {
  if (sessionService) {
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

        const result = await sessionService.create(getWorkspaceId(context), request.data)
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
      return context.json(
        listSessionsResponseSchema.parse(
          await sessionService.list(getWorkspaceId(context), query.data),
        ),
      )
    })

    app.post("/api/sessions/:id/regenerate", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }
      const session = await sessionService.regenerate(getWorkspaceId(context), id)
      if (!session) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      return context.json(session, 202)
    })

    app.get("/api/sessions/:id/stream", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }

      const result = await sessionService.stream(getWorkspaceId(context), id)
      if (!result) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      return streamEvents(context, result)
    })

    app.get("/api/sessions/:id/messages", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }
      const messages = await sessionService.messages(getWorkspaceId(context), id)
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
        const result = await sessionService.chat(getWorkspaceId(context), id, request.data)
        if (!result) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
        return streamEvents(context, result)
      },
    )

    app.get("/api/sessions/:id", async (context) => {
      const id = context.req.param("id")
      if (!z.uuid().safeParse(id).success) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }

      const session = await sessionService.get(getWorkspaceId(context), id)
      if (!session) return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      return context.json(session)
    })

    app.delete("/api/sessions/:id", async (context) => {
      const id = context.req.param("id")
      if (
        !z.uuid().safeParse(id).success ||
        !(await sessionService.delete(getWorkspaceId(context), id))
      ) {
        return context.json(createApiError("SESSION_NOT_FOUND"), 404)
      }
      return context.body(null, 204)
    })
  }

  app.all("/api/*", (context) => context.json(createApiError("SESSION_NOT_FOUND"), 404))
}
