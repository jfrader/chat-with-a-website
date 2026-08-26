import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/inter"
import { queryClient } from "./app/query-client"
import { router } from "./app/router"
import "./app/styles.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Application root element was not found")
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
