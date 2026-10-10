import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { SummaryStreamEvent } from "@chat-with-a-website/contracts"
import type { ReactNode } from "react"
import { expect, it, vi } from "vitest"
import { createSession } from "../../../test/fixtures"
import { createTestApi } from "../../../test/render-app"
import { SessionApiProvider } from "../components/session-api-provider"
import { useSummaryStream } from "./use-summary-stream"

it("keeps the stream through extraction version changes and reconnects for a new attempt", () => {
  const signals: AbortSignal[] = []
  const api = createTestApi({
    stream: vi.fn(async (_id, _event, signal) => {
      signals.push(signal)
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
    }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionApiProvider api={api}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionApiProvider>
  )
  const session = createSession({ status: "fetching", generationVersion: 0 })
  const hook = renderHook(({ current }) => useSummaryStream(current), {
    wrapper,
    initialProps: { current: session },
  })
  expect(api.stream).toHaveBeenCalledTimes(1)
  hook.rerender({ current: { ...session, status: "summarizing", generationVersion: 1 } })
  expect(api.stream).toHaveBeenCalledTimes(1)
  expect(signals[0]?.aborted).toBe(false)
  hook.rerender({ current: { ...session, attemptNumber: 2 } })
  expect(api.stream).toHaveBeenCalledTimes(2)
  expect(signals[0]?.aborted).toBe(true)
  hook.unmount()
  expect(signals[1]?.aborted).toBe(true)
})

it("scopes live failures to a session and attempt while retaining terminal failure text", async () => {
  let emit!: (event: SummaryStreamEvent) => void
  const session = createSession({ status: "fetching", generationVersion: 0 })
  const api = createTestApi({
    stream: vi.fn(async (_id, onEvent, signal) => {
      emit = onEvent
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
    }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionApiProvider api={api}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionApiProvider>
  )
  const hook = renderHook(({ current }) => useSummaryStream(current), {
    wrapper,
    initialProps: { current: session },
  })
  const failed = { ...session, status: "failed" as const, failureCode: "LLM_RATE_LIMITED" as const }
  await act(async () =>
    emit({
      type: "summary.failed",
      eventId: "failed",
      version: 0,
      offset: 0,
      session: failed,
      error: {
        code: "LLM_RATE_LIMITED",
        message: "Wait 59 seconds and retry.",
        retryable: true,
        requestId: crypto.randomUUID(),
      },
    }),
  )
  hook.rerender({ current: failed })
  expect(hook.result.current).toBe("Wait 59 seconds and retry.")
  hook.rerender({ current: { ...failed, id: crypto.randomUUID() } })
  expect(hook.result.current).toBeUndefined()
  hook.rerender({ current: { ...session, attemptNumber: 2 } })
  expect(hook.result.current).toBeUndefined()
  hook.rerender({ current: { ...session, status: "complete" } })
  expect(hook.result.current).toBeUndefined()
  hook.unmount()
})
