import { createContext, type ReactNode, useContext } from "react"
import { type SessionApi, sessionApi } from "./session-client"

const SessionApiContext = createContext<SessionApi>(sessionApi)

export function SessionApiProvider({ api, children }: { api: SessionApi; children: ReactNode }) {
  return <SessionApiContext value={api}>{children}</SessionApiContext>
}

export function useSessionApi() {
  return useContext(SessionApiContext)
}
