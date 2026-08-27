import type { SessionDto } from "@profound/contracts"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useSessionApi } from "./session-api-context"
import { type SessionPages, sessionKeys, updateSessionInPages } from "./session-queries"

const isTerminal = (session: SessionDto) =>
  session.status === "complete" || session.status === "failed"

export function useSummaryStream(session: SessionDto | undefined) {
  const api = useSessionApi()
  const queryClient = useQueryClient()
  const [connectionError, setConnectionError] = useState<string>()
  const activeSessionId = session && !isTerminal(session) ? session.id : undefined
  const activeVersion = session && !isTerminal(session) ? session.generationVersion : undefined
  const initialOffset = useRef(0)
  initialOffset.current = session?.summary.length ?? 0

  useEffect(() => {
    if (!activeSessionId || activeVersion === undefined) {
      setConnectionError(undefined)
      return
    }

    const controller = new AbortController()
    const sessionId = activeSessionId
    let terminalReceived = false
    let lastVersion = activeVersion
    let lastOffset = initialOffset.current

    const follow = async () => {
      try {
        await api.stream(
          sessionId,
          (event) => {
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
            setConnectionError(undefined)
            queryClient.setQueryData(sessionKeys.detail(sessionId), event.session)
            queryClient.setQueriesData<SessionPages>({ queryKey: sessionKeys.lists() }, (data) =>
              updateSessionInPages(data, event.session),
            )
          },
          controller.signal,
        )
      } catch {
        if (controller.signal.aborted) return
      }

      if (controller.signal.aborted) return
      const latest = await queryClient
        .fetchQuery({
          queryKey: sessionKeys.detail(sessionId),
          queryFn: () => api.get(sessionId),
          staleTime: 0,
        })
        .catch(() => undefined)
      if (!terminalReceived && (!latest || !isTerminal(latest))) {
        setConnectionError("Live progress disconnected. Refresh to check the summary again.")
      }
      if (terminalReceived || (latest && isTerminal(latest))) {
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) })
        void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() })
      }
    }

    void follow()
    return () => controller.abort()
  }, [activeSessionId, activeVersion, api, queryClient])

  return connectionError
}
