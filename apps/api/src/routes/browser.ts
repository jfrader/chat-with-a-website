import {
  browserChatRequestSchema,
  browserSummaryRequestSchema,
  MAX_BROWSER_REQUEST_BYTES,
} from "@chat-with-a-website/contracts"
import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { createApiError } from "../errors"
import type { BrowserCompute } from "../sessions/browser-compute"
import { streamEvents } from "./sessions"

export function registerBrowserRoutes(app: Hono, compute: BrowserCompute): void {
  app.use(
    "/api/browser/*",
    bodyLimit({
      maxSize: MAX_BROWSER_REQUEST_BYTES,
      onError: (context) => context.json(createApiError("CONTENT_TOO_LARGE"), 413),
    }),
  )
  app.post("/api/browser/summary", async (context) => {
    const request = browserSummaryRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    )
    if (!request.success) return context.json(createApiError("INVALID_URL"), 400)
    return streamEvents(context, await compute.summary(request.data, context.req.raw.signal))
  })
  app.post("/api/browser/chat", async (context) => {
    const request = browserChatRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!request.success) return context.json(createApiError("INVALID_MESSAGE"), 400)
    return streamEvents(context, await compute.chat(request.data, context.req.raw.signal))
  })
}
