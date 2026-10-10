import type { SessionDto } from "@chat-with-a-website/contracts"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { type SessionPages, sessionKeys, updateSessionInPages } from "./session-queries"
import { useSessionApi } from "./use-session-api"
import { SessionApiError } from "../api/session-client"

const isTerminal = (session: SessionDto) =>
  session.status === "complete" || session.status === "failed"

export function useSummaryStream(session: SessionDto | undefined) {
  const api = useSessionApi()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<{ sessionId: string; attempt: number; message: string }>()
  const activeSessionId = session && !isTerminal(session) ? session.id : undefined
  const activeAttempt = session && !isTerminal(session) ? session.attemptNumber : undefined
  const initialVersion = useRef(0)
  initialVersion.current = session?.generationVersion ?? 0
  const initialOffset = useRef(0)
  initialOffset.current = session?.summary.length ?? 0

  useEffect(() => {
    if (!activeSessionId || activeAttempt === undefined) {
      return
    }

    const controller = new AbortController()
    const sessionId = activeSessionId
    const attempt = activeAttempt
    const showFailure = (message: string) => setFailure({ sessionId, attempt, message })
    setFailure(undefined)
    let terminalReceived = false
    let lastVersion = initialVersion.current
    let lastOffset = initialOffset.current

    const follow = async () => {
      let streamError: string | undefined
      try {
        await api.stream(
          sessionId,
          (event) => {
            if (
              controller.signal.aborted ||
              event.session.id !== sessionId ||
              event.session.attemptNumber !== attempt
            )
              return
            if (event.version < lastVersion) return
            if (
              event.version === lastVersion &&
              event.offset < lastOffset &&
              event.type !== "summary.completed" &&
              event.type !== "summary.failed"
            ) {
              return
            }
            lastVersion = event.version
            lastOffset = Math.max(event.offset, event.session.summary.length)
            terminalReceived = isTerminal(event.session)
            if (event.type === "summary.failed") showFailure(event.error.message)
            else setFailure(undefined)
            queryClient.setQueryData(sessionKeys.detail(sessionId), event.session)
            queryClient.setQueriesData<SessionPages>({ queryKey: sessionKeys.lists() }, (data) =>
              updateSessionInPages(data, event.session),
            )
          },
          controller.signal,
        )
      } catch (error) {
        if (controller.signal.aborted) return
        streamError =
          error instanceof SessionApiError
            ? error.message
            : "Live progress disconnected. Refresh to check the summary again."
        showFailure(streamError)
      }

      if (controller.signal.aborted) return
      let latest: SessionDto | undefined
      try {
        latest = await queryClient.fetchQuery({
          queryKey: sessionKeys.detail(sessionId),
          queryFn: () => api.get(sessionId),
          staleTime: 0,
        })
      } catch (error) {
        if (!controller.signal.aborted && !streamError && !terminalReceived) {
          showFailure(
            error instanceof Error ? error.message : "The summary could not be loaded. Retry.",
          )
        }
        return
      }
      if (controller.signal.aborted || !latest) return
      if (latest.status === "complete") setFailure(undefined)
      else if (!terminalReceived && !isTerminal(latest) && !streamError)
        showFailure("Live progress disconnected. Refresh to check the summary again.")
      if (terminalReceived || (latest && isTerminal(latest))) {
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) })
        void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() })
      }
    }

    void follow()
    return () => controller.abort()
  }, [activeSessionId, activeAttempt, api, queryClient])

  return session &&
    session.status !== "complete" &&
    failure?.sessionId === session.id &&
    failure.attempt === session.attemptNumber
    ? failure.message
    : undefined
}
