import OpenAI from "openai"
import type { ChatCompletionChunk } from "openai/resources/chat/completions"
import { z } from "zod"
import { type Llm, type LlmDelta, LlmError, type LlmRequest, UnavailableLlm } from "./client"
import { defaultBudgetPolicy } from "../limits/policy"

export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com"
export const tokenLimitFieldSchema = z.enum(["max_tokens", "max_completion_tokens"])
export type TokenLimitField = z.infer<typeof tokenLimitFieldSchema>
const deepSeekApiHost = new URL(DEFAULT_LLM_BASE_URL).hostname

export type OpenAiLlmOptions = {
  apiKey: string
  baseUrl?: string
  client?: OpenAI
  model: string
  timeoutMs?: number
  tokenLimitField?: TokenLimitField
}

export async function* readOpenAiDeltas(
  chunks: AsyncIterable<Pick<ChatCompletionChunk, "choices">>,
  signal: AbortSignal,
): AsyncIterable<LlmDelta> {
  for await (const chunk of chunks) {
    if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
    const delta = chunk.choices[0]?.delta as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined
    if (delta?.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content }
    if (delta?.content) yield { type: "content", text: delta.content }
  }
}

const asLlmError = (error: unknown, signal: AbortSignal): LlmError => {
  if (signal.aborted) return new LlmError("GENERATION_INTERRUPTED", { cause: error })
  if (error instanceof LlmError) return error
  if (error instanceof OpenAI.APIError && error.status === 429) {
    return new LlmError("LLM_RATE_LIMITED", { cause: error })
  }
  return new LlmError("LLM_UNAVAILABLE", { cause: error })
}

export class OpenAiLlm implements Llm {
  readonly #client: OpenAI
  readonly model: string
  readonly provider = "openai-compatible"
  readonly #timeoutMs: number
  readonly #tokenLimitField: TokenLimitField

  constructor(options: OpenAiLlmOptions) {
    this.model = options.model
    this.#timeoutMs = options.timeoutMs ?? defaultBudgetPolicy.RATE_LIMIT_PROVIDER_TIMEOUT_MS
    this.#client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        maxRetries: 0,
        timeout: this.#timeoutMs,
      })
    const baseUrl = options.baseUrl ?? this.#client.baseURL
    this.#tokenLimitField =
      options.tokenLimitField ??
      (baseUrl && new URL(baseUrl).hostname === deepSeekApiHost
        ? "max_tokens"
        : "max_completion_tokens")
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmDelta> {
    try {
      const chunks = await this.#client.chat.completions.create(
        {
          messages: request.messages,
          model: this.model,
          stream: true,
          ...(request.maxOutputTokens ? { [this.#tokenLimitField]: request.maxOutputTokens } : {}),
        },
        { signal: request.signal, maxRetries: 0, timeout: this.#timeoutMs },
      )
      yield* readOpenAiDeltas(chunks, request.signal)
    } catch (error) {
      throw asLlmError(error, request.signal)
    }
  }
}

export function createLlmFromEnvironment(environment: {
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL: string
  RATE_LIMIT_PROVIDER_TIMEOUT_MS?: number
  LLM_TOKEN_LIMIT_FIELD?: TokenLimitField
}): Llm {
  if (!environment.LLM_API_KEY) return new UnavailableLlm(environment.LLM_MODEL)
  return new OpenAiLlm({
    apiKey: environment.LLM_API_KEY,
    model: environment.LLM_MODEL,
    timeoutMs:
      environment.RATE_LIMIT_PROVIDER_TIMEOUT_MS ??
      defaultBudgetPolicy.RATE_LIMIT_PROVIDER_TIMEOUT_MS,
    ...(environment.LLM_BASE_URL ? { baseUrl: environment.LLM_BASE_URL } : {}),
    ...(environment.LLM_TOKEN_LIMIT_FIELD
      ? { tokenLimitField: environment.LLM_TOKEN_LIMIT_FIELD }
      : {}),
  })
}
