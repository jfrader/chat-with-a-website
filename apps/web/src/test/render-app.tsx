import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render } from "@testing-library/react"
import { createAppRouter } from "../app/router"
import { SessionApiProvider } from "../features/session/session-api-context"
import type { SessionApi } from "../features/session/session-client"

export function createTestApi(overrides: Partial<SessionApi> = {}): SessionApi {
  return {
    list: async () => ({ sessions: [], nextCursor: null }),
    create: async () => {
      throw new Error("Unexpected create request")
    },
    get: async () => {
      throw new Error("Unexpected detail request")
    },
    delete: async () => {},
    messages: async () => [],
    chat: async () => {},
    stream: async () => {},
    ...overrides,
  }
}

export function renderApp(api: SessionApi, initialEntry = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  })
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialEntry] }))
  const result = render(
    <SessionApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionApiProvider>,
  )
  return { ...result, queryClient, router }
}
