import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { WorkspaceShell } from "../features/workspace/workspace-shell"

const rootRoute = createRootRoute({
  component: Outlet,
})

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorkspaceShell,
})

const routeTree = rootRoute.addChildren([workspaceRoute])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
