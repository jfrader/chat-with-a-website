import { randomUUID } from "node:crypto"
import type { ApiErrorCode, ApiErrorDto, SessionStage } from "@profound/contracts"
import { apiErrorSchema } from "@profound/contracts"

const errorDefinitions: Record<ApiErrorCode, { message: string; retryable: boolean }> = {
  INVALID_URL: { message: "The request contains an invalid URL.", retryable: false },
  URL_NOT_ALLOWED: { message: "The destination is not allowed.", retryable: false },
  FETCH_TIMEOUT: { message: "The destination took too long to respond.", retryable: true },
  FETCH_UNREACHABLE: { message: "The destination could not be reached.", retryable: true },
  UNSUPPORTED_CONTENT_TYPE: {
    message: "The destination did not return a supported webpage.",
    retryable: false,
  },
  EMPTY_CONTENT: { message: "No readable content was found on the webpage.", retryable: false },
  CONTENT_TOO_LARGE: { message: "The webpage is too large to process.", retryable: false },
  LLM_UNAVAILABLE: { message: "The language model is currently unavailable.", retryable: true },
  LLM_RATE_LIMITED: { message: "The language model is temporarily rate limited.", retryable: true },
  GENERATION_INTERRUPTED: { message: "Generation was interrupted.", retryable: true },
  INVALID_MESSAGE: { message: "The chat message is invalid.", retryable: false },
  IDEMPOTENCY_CONFLICT: {
    message: "The idempotency key was already used for different input.",
    retryable: false,
  },
  SESSION_NOT_FOUND: { message: "The requested session was not found.", retryable: false },
  RATE_LIMITED: { message: "Too many generations are currently active.", retryable: true },
  INTERNAL_ERROR: { message: "An unexpected error occurred.", retryable: true },
}

export class SessionPipelineError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, options?: ErrorOptions) {
    super(errorDefinitions[code].message, options)
    this.name = "SessionPipelineError"
    this.code = code
  }
}

export class ServiceError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, options?: ErrorOptions) {
    super(errorDefinitions[code].message, options)
    this.name = "ServiceError"
    this.code = code
  }
}

export const createApiError = (code: ApiErrorCode, requestId = randomUUID()): ApiErrorDto =>
  apiErrorSchema.parse({
    code,
    message: errorDefinitions[code].message,
    requestId,
    retryable: errorDefinitions[code].retryable,
  })

export const asPipelineFailure = (
  error: unknown,
  stage: SessionStage,
): { code: ApiErrorCode; stage: SessionStage } => ({
  code:
    error instanceof SessionPipelineError || error instanceof ServiceError
      ? error.code
      : "INTERNAL_ERROR",
  stage,
})
