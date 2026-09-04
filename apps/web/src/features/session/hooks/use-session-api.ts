import { useContext } from "react"
import { SessionApiContext } from "../api/session-api-context"

export function useSessionApi() {
  return useContext(SessionApiContext)
}
