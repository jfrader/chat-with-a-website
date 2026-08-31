import type { ReactNode } from "react"
import { SessionApiContext } from "../api/session-api-context"
import type { SessionApi } from "../api/session-client"

export function SessionApiProvider({ api, children }: { api: SessionApi; children: ReactNode }) {
  return <SessionApiContext value={api}>{children}</SessionApiContext>
}
