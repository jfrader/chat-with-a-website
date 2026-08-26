import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router"
import { listSessionsQuerySchema } from "@profound/contracts"
import { WorkspaceShell } from "../features/workspace/workspace-shell"

const rootRoute = createRootRoute({
  validateSearch: (search) => {
    const parsed = listSessionsQuerySchema.pick({ query: true }).safeParse({ query: search.query })
    const query = parsed.success ? parsed.data.query : ""
    return query ? { query } : {}
  },
  component: WorkspaceShell,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Outlet,
})

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: Outlet,
})

export const routeTree = rootRoute.addChildren([indexRoute, sessionRoute])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) })
}

export const router = createAppRouter()

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
