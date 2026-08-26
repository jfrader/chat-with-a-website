import type { ApiErrorCode } from "@profound/contracts"

export type LlmMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type LlmRequest = {
  maxOutputTokens?: number
  messages: LlmMessage[]
  signal: AbortSignal
}

export interface Llm {
  readonly model: string
  readonly provider: string
  stream(request: LlmRequest): AsyncIterable<string>
}

export class LlmError extends Error {
  readonly code: Extract<
    ApiErrorCode,
    "GENERATION_INTERRUPTED" | "LLM_RATE_LIMITED" | "LLM_UNAVAILABLE"
  >

  constructor(code: LlmError["code"], options?: ErrorOptions) {
    super(code, options)
    this.name = "LlmError"
    this.code = code
  }
}

export class UnavailableLlm implements Llm {
  readonly model: string
  readonly provider = "openai-compatible"

  constructor(model: string) {
    this.model = model
  }

  stream(): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => Promise.reject(new LlmError("LLM_UNAVAILABLE")),
        }
      },
    }
  }
}
