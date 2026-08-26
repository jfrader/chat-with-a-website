import type { ApiErrorCode, ApiErrorDto, SessionStage } from "@profound/contracts"
import { apiErrorSchema } from "@profound/contracts"

const errorDetails: Record<ApiErrorCode, { message: string; retryable: boolean }> = {
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
  PROVIDER_RATE_LIMITED: { message: "The summary provider is rate limited.", retryable: true },
  PROVIDER_UNAVAILABLE: { message: "The summary provider is unavailable.", retryable: true },
  GENERATION_INTERRUPTED: { message: "Summary generation was interrupted.", retryable: true },
  SESSION_NOT_FOUND: { message: "The requested session was not found.", retryable: false },
  SESSION_IN_PROGRESS: { message: "The session is still in progress.", retryable: true },
  RATE_LIMITED: { message: "Too many requests were received.", retryable: true },
  INTERNAL_ERROR: { message: "An unexpected error occurred.", retryable: true },
}

export class SessionPipelineError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, options?: ErrorOptions) {
    super(errorDetails[code].message, options)
    this.name = "SessionPipelineError"
    this.code = code
  }
}

export const createApiError = (code: ApiErrorCode): ApiErrorDto =>
  apiErrorSchema.parse({
    code,
    ...errorDetails[code],
    requestId: crypto.randomUUID(),
  })

export const asPipelineFailure = (
  error: unknown,
  stage: SessionStage,
): { code: ApiErrorCode; stage: SessionStage } => ({
  code: error instanceof SessionPipelineError ? error.code : "INTERNAL_ERROR",
  stage,
})
