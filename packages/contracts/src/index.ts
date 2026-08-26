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
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "GENERATION_INTERRUPTED",
  "SESSION_NOT_FOUND",
  "SESSION_IN_PROGRESS",
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
  .min(1, "Enter a webpage URL.")
  .max(2048, "The URL must be 2,048 characters or fewer.")
  .superRefine((value, context) => {
    let url: URL

    try {
      url = new URL(value)
    } catch {
      context.addIssue({ code: "custom", message: "Enter a complete http or https URL." })
      return
    }

    if (!allowedUrlProtocols.has(url.protocol)) {
      context.addIssue({ code: "custom", message: "Only http and https URLs are supported." })
    }

    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "URLs containing credentials are not supported.",
      })
    }
  })

export const createSessionRequestSchema = z.object({
  url: httpUrlSchema,
  idempotencyKey: z.uuid(),
})
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>

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
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})
export type SessionDto = z.infer<typeof sessionSchema>

export const messageRoleSchema = z.enum(["user", "assistant"])
export const messageStatusSchema = z.enum(["streaming", "complete", "failed"])

export const messageSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  role: messageRoleSchema,
  content: z.string(),
  status: messageStatusSchema,
  failureCode: apiErrorCodeSchema.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  attemptNumber: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})
export type MessageDto = z.infer<typeof messageSchema>

const attemptEventSchema = z.object({ attemptId: z.uuid() })

export const sessionStreamEventSchema = z.discriminatedUnion("type", [
  attemptEventSchema.extend({ type: z.literal("session.created"), session: sessionSchema }),
  attemptEventSchema.extend({ type: z.literal("stage.changed"), stage: sessionStageSchema }),
  attemptEventSchema.extend({ type: z.literal("summary.delta"), delta: z.string().min(1) }),
  attemptEventSchema.extend({ type: z.literal("session.completed"), session: sessionSchema }),
  attemptEventSchema.extend({
    type: z.literal("session.failed"),
    session: sessionSchema,
    error: apiErrorSchema,
  }),
])
export type SessionStreamEvent = z.infer<typeof sessionStreamEventSchema>

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  attemptEventSchema.extend({
    type: z.literal("message.created"),
    userMessage: messageSchema,
    assistantMessage: messageSchema,
  }),
  attemptEventSchema.extend({
    type: z.literal("message.delta"),
    messageId: z.uuid(),
    delta: z.string().min(1),
  }),
  attemptEventSchema.extend({ type: z.literal("message.completed"), message: messageSchema }),
  attemptEventSchema.extend({
    type: z.literal("message.failed"),
    message: messageSchema,
    error: apiErrorSchema,
  }),
])
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>

export const healthSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
})
export type HealthDto = z.infer<typeof healthSchema>
