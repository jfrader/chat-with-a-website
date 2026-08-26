import type { SessionDto, SessionStreamEvent } from "@profound/contracts"
import { useEffect, useState } from "react"
import { type SessionApi, sessionApi as defaultSessionApi } from "../session/session-client"
import { SessionWorkspace } from "../session/session-workspace"
import { HistoryNavigation } from "./history-navigation"
import { UrlComposer } from "./url-composer"
import styles from "./workspace-shell.module.css"

interface WorkspaceShellProps {
  api?: SessionApi
}

const reconnectBaseDelayMs = 250
const reconnectMaxDelayMs = 8_000
const isTerminalSession = (session: SessionDto) =>
  session.status === "complete" || session.status === "failed"

function applyStreamEvent(current: SessionDto, event: SessionStreamEvent): SessionDto {
  switch (event.type) {
    case "session.created":
    case "session.completed":
    case "session.failed": {
      if (event.session.attemptNumber < current.attemptNumber) return current
      if (
        event.session.attemptNumber === current.attemptNumber &&
        event.attemptId !== current.attemptId
      ) {
        return current
      }
      return event.session
    }
    case "stage.changed": {
      if (event.attemptId !== current.attemptId || isTerminalSession(current)) return current
      return { ...current, status: event.stage }
    }
    case "summary.delta": {
      if (event.attemptId !== current.attemptId || isTerminalSession(current)) return current
      return { ...current, summary: current.summary + event.delta }
    }
  }
}

function applySessionSnapshot(
  current: SessionDto | undefined,
  latest: SessionDto,
  sessionId: string,
): SessionDto | undefined {
  if (current?.id !== sessionId) return current
  if (latest.attemptNumber < current.attemptNumber) return current
  if (latest.attemptNumber === current.attemptNumber && latest.attemptId !== current.attemptId) {
    return current
  }
  if (latest.attemptNumber > current.attemptNumber) return latest
  if (isTerminalSession(current) && !isTerminalSession(latest)) return current
  if (isTerminalSession(latest)) return latest
  if (Date.parse(latest.updatedAt) < Date.parse(current.updatedAt)) return current
  return latest
}

function reconnectDelay(attempt: number): number {
  const exponential = Math.min(reconnectBaseDelayMs * 2 ** attempt, reconnectMaxDelayMs)
  return exponential * (0.8 + Math.random() * 0.4)
}

function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timeout = setTimeout(finish, delayMs)
    signal.addEventListener("abort", finish, { once: true })
  })
}

export function WorkspaceShell({ api = defaultSessionApi }: WorkspaceShellProps) {
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [session, setSession] = useState<SessionDto>()
  const [connectionError, setConnectionError] = useState<string>()
  const activeSessionId =
    session?.status === "fetching" ||
    session?.status === "extracting" ||
    session?.status === "summarizing"
      ? session.id
      : undefined
  const activeAttemptId = activeSessionId ? session?.attemptId : undefined
  const activeAttemptNumber = activeSessionId ? session?.attemptNumber : undefined

  useEffect(() => {
    if (!activeSessionId) return

    const controller = new AbortController()
    const sessionId = activeSessionId
    const attemptId = activeAttemptId
    const attemptNumber = activeAttemptNumber
    let reconnectAttempt = 0

    const onEvent = (event: SessionStreamEvent) => {
      setConnectionError(undefined)
      setSession((current) =>
        current?.id === sessionId ? applyStreamEvent(current, event) : current,
      )
      if (event.type === "stage.changed" && event.stage === "summarizing") {
        void api
          .get(sessionId)
          .then((latest) => {
            setSession((current) => applySessionSnapshot(current, latest, sessionId))
          })
          .catch(() => undefined)
      }
    }

    const followSession = async () => {
      while (!controller.signal.aborted) {
        try {
          await api.stream(sessionId, onEvent, controller.signal)
        } catch {
          if (controller.signal.aborted) return
        }

        if (controller.signal.aborted) return

        try {
          const latest = await api.get(sessionId)
          setSession((current) => applySessionSnapshot(current, latest, sessionId))
          const latestAttemptIsCurrentOrNewer =
            attemptId !== undefined &&
            attemptNumber !== undefined &&
            (latest.attemptNumber > attemptNumber ||
              (latest.attemptNumber === attemptNumber && latest.attemptId === attemptId))
          if (isTerminalSession(latest) && latestAttemptIsCurrentOrNewer) {
            setConnectionError(undefined)
            return
          }
          setConnectionError("Live progress disconnected. The summary is still processing.")
        } catch {
          setConnectionError("Live progress disconnected. Refresh to check the summary again.")
        }

        await waitForReconnect(controller.signal, reconnectDelay(reconnectAttempt))
        reconnectAttempt += 1
      }
    }

    void followSession()

    return () => controller.abort()
  }, [api, activeSessionId, activeAttemptId, activeAttemptNumber])

  async function createSession(url: string, idempotencyKey: string) {
    setConnectionError(undefined)
    setSession(await api.create(url, idempotencyKey))
  }

  function resetSession() {
    setConnectionError(undefined)
    setSession(undefined)
  }

  return (
    <div className={styles.shell}>
      <div
        className={`${styles.background} ${session ? styles.activeBackground : ""}`}
        aria-hidden="true"
      />
      <HistoryNavigation
        active={Boolean(session)}
        collapsed={historyCollapsed}
        onReset={resetSession}
        onToggle={() => setHistoryCollapsed((collapsed) => !collapsed)}
        session={session}
      />

      <main className={styles.main}>
        {session ? (
          <SessionWorkspace
            session={session}
            connectionError={connectionError}
            onReset={resetSession}
          />
        ) : (
          <section className={styles.prompt} aria-labelledby="workspace-heading">
            <div className={styles.glow} aria-hidden="true" />
            <div className={styles.copy}>
              <h1 id="workspace-heading">Let’s get to it</h1>
              <p>Paste a URL to summarize and understand any content instantly</p>
            </div>
            <UrlComposer onSubmit={createSession} />
          </section>
        )}
      </main>
    </div>
  )
}
