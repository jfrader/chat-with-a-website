import type OpenAI from "openai"
import { describe, expect, it, vi } from "vitest"
import { createLlmFromEnvironment, OpenAiLlm, readOpenAiDeltas } from "./openai-llm"

const signal = new AbortController().signal

describe("OpenAiLlm", () => {
  it("parses only non-empty text deltas from streaming chat completions", async () => {
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "Hello" } }] }
        yield { choices: [{ delta: { content: null } }] }
        yield { choices: [] }
        yield { choices: [{ delta: { content: " world" } }] }
      },
    }
    const values: string[] = []
    for await (const delta of readOpenAiDeltas(chunks as never, signal)) values.push(delta)
    expect(values).toEqual(["Hello", " world"])
  })

  it("uses streaming Chat Completions with the configured model", async () => {
    const create = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "result" } }] }
      },
    }))
    const client = { chat: { completions: { create } } } as unknown as OpenAI
    const llm = new OpenAiLlm({ apiKey: "test", model: "chosen-model", client })
    const output: string[] = []
    for await (const delta of llm.stream({
      signal,
      maxOutputTokens: 321,
      messages: [{ role: "user", content: "prompt" }],
    })) {
      output.push(delta)
    }
    expect(output).toEqual(["result"])
    expect(create).toHaveBeenCalledWith(
      {
        model: "chosen-model",
        messages: [{ role: "user", content: "prompt" }],
        stream: true,
        max_completion_tokens: 321,
      },
      { signal },
    )
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
