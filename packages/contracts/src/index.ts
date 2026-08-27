import { z } from "zod"

const allowedUrlProtocols = new Set(["http:", "https:"])

export const apiErrorCodes = [
  "INVALID_URL",
  "URL_NOT_ALLOWED",
  "FETCH_TIMEOUT",
  "FETCH_UNREACHABLE",
  "UNSUPPORTED_CONTENT_TYPE",
  "EMPTY_CONTENT",
  "CONTENT_TOO_LARGE",
  "LLM_UNAVAILABLE",
  "LLM_RATE_LIMITED",
  "GENERATION_INTERRUPTED",
  "INVALID_MESSAGE",
  "IDEMPOTENCY_CONFLICT",
  "SESSION_NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const

export const apiErrorCodeSchema = z.enum(apiErrorCodes)
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  requestId: z.uuid(),
})
export type ApiErrorDto = z.infer<typeof apiErrorSchema>

export const httpUrlSchema = z
  .string()
  .trim()
  .min(1, "Paste a webpage address to continue.")
  .max(2048, "The URL must be 2,048 characters or fewer.")
  .superRefine((value, context) => {
    let url: URL

    try {
      url = new URL(value)
    } catch {
      context.addIssue({ code: "custom", message: "That doesn’t look like a webpage address." })
      return
    }

    if (!url.hostname || url.hostname.includes("%")) {
      context.addIssue({ code: "custom", message: "That doesn’t look like a webpage address." })
      return
    }

    if (!allowedUrlProtocols.has(url.protocol)) {
      context.addIssue({ code: "custom", message: "Only standard web links are supported." })
    }

    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "Remove the username or password from this address.",
      })
    }
  })

export const createSessionRequestSchema = z.object({
  url: httpUrlSchema,
  idempotencyKey: z.uuid(),
})
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>

export const listSessionsQuerySchema = z.object({
  query: z.string().trim().max(200).default(""),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>

export const sessionStatusSchema = z.enum([
  "fetching",
  "extracting",
  "summarizing",
  "complete",
  "failed",
])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const sessionStageSchema = z.enum(["fetching", "extracting", "summarizing"])
export type SessionStage = z.infer<typeof sessionStageSchema>

export const sessionSchema = z.object({
  id: z.uuid(),
  originalUrl: z.string().url(),
  canonicalUrl: z.string().url(),
  finalUrl: z.string().url().nullable(),
  host: z.string().min(1),
  title: z.string().nullable(),
  siteName: z.string().nullable(),
  description: z.string().nullable(),
  summary: z.string(),
  status: sessionStatusSchema,
  failureStage: sessionStageSchema.nullable(),
  failureCode: apiErrorCodeSchema.nullable(),
  sourceWordCount: z.number().int().nonnegative(),
  sourceTruncated: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  attemptId: z.uuid(),
  attemptNumber: z.number().int().positive(),
  generationVersion: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})
export type SessionDto = z.infer<typeof sessionSchema>

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema),
  nextCursor: z.string().nullable(),
})
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>

export const messageRoleSchema = z.enum(["user", "assistant"])
export type MessageRole = z.infer<typeof messageRoleSchema>
export const messageStatusSchema = z.enum(["streaming", "complete", "failed"])
export type MessageStatus = z.infer<typeof messageStatusSchema>

export const messageSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  requestId: z.uuid(),
  role: messageRoleSchema,
  content: z.string(),
  status: messageStatusSchema,
  failureCode: apiErrorCodeSchema.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  attemptId: z.uuid().nullable(),
  attemptNumber: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})
export type MessageDto = z.infer<typeof messageSchema>

export const messagesResponseSchema = z.object({ messages: z.array(messageSchema) })
export type MessagesResponse = z.infer<typeof messagesResponseSchema>

export const createChatRequestSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  idempotencyKey: z.uuid(),
})
export type CreateChatRequest = z.infer<typeof createChatRequestSchema>

const summaryEventBaseSchema = z.object({
  eventId: z.string().min(1),
  version: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  session: sessionSchema,
})

export const summaryStreamEventSchema = z.discriminatedUnion("type", [
  summaryEventBaseSchema.extend({ type: z.literal("summary.snapshot") }),
  summaryEventBaseSchema.extend({
    type: z.literal("summary.delta"),
    delta: z.string().min(1),
  }),
  summaryEventBaseSchema.extend({ type: z.literal("summary.completed") }),
  summaryEventBaseSchema.extend({
    type: z.literal("summary.failed"),
    error: apiErrorSchema,
  }),
])
export type SummaryStreamEvent = z.infer<typeof summaryStreamEventSchema>

export const sessionStreamEventSchema = summaryStreamEventSchema
export type SessionStreamEvent = SummaryStreamEvent

const chatEventBaseSchema = z.object({
  eventId: z.string().min(1),
  requestId: z.uuid(),
  offset: z.number().int().nonnegative(),
})

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  chatEventBaseSchema.extend({
    type: z.literal("chat.created"),
    userMessage: messageSchema,
    assistantMessage: messageSchema,
  }),
  chatEventBaseSchema.extend({
    type: z.literal("chat.delta"),
    messageId: z.uuid(),
    delta: z.string().min(1),
  }),
  chatEventBaseSchema.extend({ type: z.literal("chat.completed"), message: messageSchema }),
  chatEventBaseSchema.extend({
    type: z.literal("chat.failed"),
    message: messageSchema,
    error: apiErrorSchema,
  }),
])
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>

export const healthSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
})
export type HealthDto = z.infer<typeof healthSchema>
