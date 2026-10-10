import OpenAI from "openai"
import { describe, expect, it, vi } from "vitest"
import {
  createLlmFromEnvironment,
  OpenAiLlm,
  readOpenAiDeltas,
  type TokenLimitField,
} from "./openai"

const signal = new AbortController().signal

describe("OpenAiLlm", () => {
  const tokenCases: {
    baseUrl: string
    tokenLimitField?: TokenLimitField
    expected: TokenLimitField
  }[] = [
    { baseUrl: "https://api.deepseek.com/v1", expected: "max_tokens" },
    { baseUrl: "https://api.openai.com/v1", expected: "max_completion_tokens" },
    { baseUrl: "https://api.deepseek.com.example.invalid/v1", expected: "max_completion_tokens" },
    {
      baseUrl: "https://proxy.example.invalid/v1",
      tokenLimitField: "max_tokens",
      expected: "max_tokens",
    },
    {
      baseUrl: "https://api.deepseek.com/v1",
      tokenLimitField: "max_completion_tokens",
      expected: "max_completion_tokens",
    },
  ]
  it.each(tokenCases)("sends only $expected to $baseUrl", async (options) => {
    const bodies: unknown[] = []
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      bodies.push(await new Request(input, init).json())
      return new Response(
        'data: {"choices":[{"delta":{"content":"result"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      )
    })
    const client = new OpenAI({
      apiKey: "fake-test-key",
      baseURL: options.baseUrl,
      fetch: fetcher,
    })
    const llm = new OpenAiLlm({
      apiKey: "fake-test-key",
      model: "chosen-model",
      client,
      ...(options.tokenLimitField ? { tokenLimitField: options.tokenLimitField } : {}),
    })
    const output = []
    for await (const delta of llm.stream({
      signal,
      maxOutputTokens: 321,
      messages: [{ role: "user", content: "prompt" }],
    })) {
      output.push(delta)
    }
    expect(output).toEqual([{ type: "content", text: "result" }])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ [options.expected]: 321 })
    expect(bodies[0]).not.toHaveProperty(
      options.expected === "max_tokens" ? "max_completion_tokens" : "max_tokens",
    )
  })
  it("parses only non-empty text deltas from streaming chat completions", async () => {
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "Hello" } }] }
        yield { choices: [{ delta: { content: null } }] }
        yield { choices: [] }
        yield { choices: [{ delta: { content: " world" } }] }
      },
    }
    const values: unknown[] = []
    for await (const delta of readOpenAiDeltas(chunks as never, signal)) values.push(delta)
    expect(values).toEqual([
      { type: "content", text: "Hello" },
      { type: "content", text: " world" },
    ])
  })

  it("uses streaming Chat Completions with the configured model", async () => {
    const create = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "result" } }] }
      },
    }))
    const client = { chat: { completions: { create } } } as unknown as OpenAI
    const llm = new OpenAiLlm({ apiKey: "test", model: "chosen-model", client, timeoutMs: 1_234 })
    const output: unknown[] = []
    for await (const delta of llm.stream({
      signal,
      maxOutputTokens: 321,
      messages: [{ role: "user", content: "prompt" }],
    })) {
      output.push(delta)
    }
    expect(output).toEqual([{ type: "content", text: "result" }])
    expect(create).toHaveBeenCalledWith(
      {
        model: "chosen-model",
        messages: [{ role: "user", content: "prompt" }],
        stream: true,
        max_completion_tokens: 321,
      },
      { signal, maxRetries: 0, timeout: 1_234 },
    )
  })

  it("does not retry a real SDK request even when the injected client enables retries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ error: { message: "Unavailable" } }, { status: 503 }),
    )
    const client = new OpenAI({
      apiKey: "fake-test-key",
      baseURL: "https://example.com/v1",
      fetch: fetcher,
      maxRetries: 2,
    })
    const llm = new OpenAiLlm({ apiKey: "fake-test-key", model: "test", client })
    const consume = async () => {
      for await (const _delta of llm.stream({ signal, messages: [] })) {
      }
    }
    await expect(consume()).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("fails safely when provider configuration is missing", async () => {
    const llm = createLlmFromEnvironment({ LLM_MODEL: "configured-model" })
    const consume = async () => {
      for await (const _delta of llm.stream({ signal, messages: [] })) {
        // The unavailable adapter never yields.
      }
    }
    await expect(consume()).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" })
  })
})
