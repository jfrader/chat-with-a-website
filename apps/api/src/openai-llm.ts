import OpenAI from "openai"
import type { ChatCompletionChunk } from "openai/resources/chat/completions"
import { type Llm, LlmError, type LlmRequest, UnavailableLlm } from "./llm"

export type OpenAiLlmOptions = {
  apiKey: string
  baseUrl?: string
  client?: OpenAI
  model: string
}

export async function* readOpenAiDeltas(
  chunks: AsyncIterable<Pick<ChatCompletionChunk, "choices">>,
  signal: AbortSignal,
): AsyncIterable<string> {
  for await (const chunk of chunks) {
    if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
    const delta = chunk.choices[0]?.delta.content
    if (delta) yield delta
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

  constructor(options: OpenAiLlmOptions) {
    this.model = options.model
    this.#client =
      options.client ?? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl })
  }

  async *stream(request: LlmRequest): AsyncIterable<string> {
    try {
      const chunks = await this.#client.chat.completions.create(
        {
          messages: request.messages,
          model: this.model,
          stream: true,
          ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
        },
        { signal: request.signal },
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
}): Llm {
  if (!environment.LLM_API_KEY) return new UnavailableLlm(environment.LLM_MODEL)
  return new OpenAiLlm({
    apiKey: environment.LLM_API_KEY,
    model: environment.LLM_MODEL,
    ...(environment.LLM_BASE_URL ? { baseUrl: environment.LLM_BASE_URL } : {}),
  })
}
