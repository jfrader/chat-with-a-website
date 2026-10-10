import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/inter"
import { configSchema } from "@chat-with-a-website/contracts"
import { queryClient } from "./app/query-client"
import { router } from "./app/router"
import "./app/styles.css"
import { SessionApiProvider } from "./features/session/components/session-api-provider"
import { sessionApi as remoteApi } from "./features/session/api/session-client"
import { localSessionApi } from "./features/session/api/local-session-api"
import type { SessionApi } from "./features/session/api/session-client"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Application root element was not found")
}

function AppRoot() {
  const [api, setApi] = useState<SessionApi | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/config")
      .then((r) => {
        if (!r.ok) throw new Error("config fetch failed")
        return r.json()
      })
      .then((json) => {
        if (cancelled) return
        const parsed = configSchema.parse(json)
        const chosen = parsed.databaseFree ? localSessionApi : remoteApi
        setApi(chosen)
      })
      .catch((e) => {
        if (!cancelled) {
          setError("Failed to load app config. Retry or check server.")
          // explicit no silent fallback
          console.error("config bootstrap error", e)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui" }}>
        {error}{" "}
        <button type="button" onClick={() => location.reload()}>
          Retry
        </button>
      </div>
    )
  }
  if (!api) {
    return <div style={{ padding: 20 }}>Loading config...</div>
  }

  return (
    <SessionApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionApiProvider>
  )
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
)
