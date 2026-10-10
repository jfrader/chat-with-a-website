import { getConnInfo } from "@hono/node-server/conninfo"
import type { Context, MiddlewareHandler } from "hono"
import ipaddr from "ipaddr.js"
import { createApiError } from "../errors"
import { BudgetExceeded, type GenerationBudget } from "./generation-budget"

export type ClientAddressResolver = (context: Context) => string | undefined
export const socketAddress: ClientAddressResolver = (context) => getConnInfo(context).remote.address

export function normalizeClientAddress(address: string): string {
  const parsed = ipaddr.process(address)
  if (parsed.kind() === "ipv4") return parsed.toString()
  const bytes = parsed.toByteArray().slice(0, 8)
  return `${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}/64`
}

export const isGenerationRequest = (method: string, path: string) =>
  method === "POST" &&
  (/^\/api\/sessions\/?$/.test(path) ||
    /^\/api\/sessions\/[^/]+\/(regenerate|messages)\/?$/.test(path) ||
    /^\/api\/browser\/(summary|chat)\/?$/.test(path))

export function generationAdmission(
  budget: GenerationBudget,
  resolve: ClientAddressResolver = socketAddress,
): MiddlewareHandler {
  return async (context, next) => {
    if (!isGenerationRequest(context.req.method, context.req.path)) return next()
    try {
      const address = resolve(context)
      if (!address) throw new Error("Missing socket address")
      await budget.admit(normalizeClientAddress(address))
    } catch (error) {
      context.header("Cache-Control", "no-store")
      if (error instanceof BudgetExceeded) {
        context.header("Retry-After", String(error.retryAfterSeconds))
        return context.json(createApiError("RATE_LIMITED"), 429)
      }
      return context.json(
        {
          ...createApiError("LLM_UNAVAILABLE"),
          message: "Request limits are unavailable. Retry later.",
        },
        503,
      )
    }
    return next()
  }
}
