import { configSchema } from "@chat-with-a-website/contracts"
import { useQuery } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { localSessionApi } from "../features/session/api/local-session-api"
import { sessionApi } from "../features/session/api/session-client"
import { SessionApiProvider } from "../features/session/components/session-api-provider"
import { OpeningSummary } from "../features/session/components/opening-summary"
import { SessionFailureButton } from "../features/session/components/session-failure-button"
import { SessionFailureView } from "../features/session/components/session-failure-view"
import { router } from "./router"

export function RuntimeApp() {
  const config = useQuery({
    queryKey: ["runtime-config"],
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetch("/config", { signal })
      if (!response.ok) throw new Error("App configuration could not be loaded. Retry.")
      return configSchema.parse(await response.json())
    },
  })
  if (config.isPending) return <OpeningSummary />
  if (config.isError)
    return (
      <SessionFailureView
        label="Connection unavailable"
        title="The app could not be loaded"
        message="App configuration could not be loaded. Retry."
        actions={
          <SessionFailureButton
            type="button"
            disabled={config.isFetching}
            onClick={() => void config.refetch()}
          >
            Retry
          </SessionFailureButton>
        }
      />
    )
  return (
    <SessionApiProvider api={config.data.databaseFree ? localSessionApi : sessionApi}>
      <RouterProvider router={router} />
    </SessionApiProvider>
  )
}
