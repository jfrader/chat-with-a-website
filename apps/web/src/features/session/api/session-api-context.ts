import { createContext } from "react"
import { type SessionApi, sessionApi } from "./session-client"

export const SessionApiContext = createContext<SessionApi>(sessionApi)
