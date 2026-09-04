import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import { apiErrorSchema, healthSchema } from "@chat-with-a-website/contracts"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createApiApp } from "./app"

describe("API routes", () => {
  it("reports liveness without checking the database", async () => {
    const isReady = vi.fn(() => false)
    const response = await createApiApp({ isReady }).request("/health/live")

    expect(response.status).toBe(200)
    expect(healthSchema.parse(await response.json())).toEqual({ status: "ok" })
    expect(isReady).not.toHaveBeenCalled()
  })

  it("reports readiness failures safely", async () => {
    const response = await createApiApp({ isReady: () => false }).request("/health/ready")

    expect(response.status).toBe(503)
    expect(healthSchema.parse(await response.json())).toEqual({ status: "unavailable" })
  })

  it("does not route unknown API paths into an HTML fallback", async () => {
    const response = await createApiApp().request("/api/unknown")

    expect(response.status).toBe(404)
    expect(response.headers.get("content-type")).toContain("application/json")
  })
})

describe("production static routes", () => {
  let staticRoot: string

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), "chat-with-a-website-api-static-"))
    await mkdir(join(staticRoot, "assets"))
    await Promise.all([
      writeFile(
        join(staticRoot, "index.html"),
        "<!doctype html><title>Chat With a Website</title>",
      ),
      writeFile(join(staticRoot, "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" />'),
      writeFile(join(staticRoot, "assets", "app-ABC123.js"), "export {}"),
    ])
  })

  afterAll(async () => {
    if (staticRoot) {
      await rm(staticRoot, { recursive: true, force: true })
    }
  })

  it("serves HTML fallbacks without caching", async () => {
    const app = createApiApp({ staticRoot })

    for (const path of ["/", "/sessions/example"]) {
      const response = await app.request(path)

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(response.headers.get("cache-control")).toBe("no-cache")
    }
  })

  it("serves versioned and root assets with appropriate metadata", async () => {
    const app = createApiApp({ staticRoot })
    const versionedAsset = await app.request("/assets/app-ABC123.js")
    const favicon = await app.request("/favicon.svg")

    expect(versionedAsset.status).toBe(200)
    expect(versionedAsset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(favicon.status).toBe(200)
    expect(favicon.headers.get("content-type")).toContain("image/svg+xml")
    expect(favicon.headers.get("cache-control")).toBe("no-cache")
  })

  it.each(["/api", "/api/missing", "/health", "/health/missing", "/assets", "/assets/missing.js"])(
    "never serves SPA HTML for %s",
    async (path) => {
      const response = await createApiApp({ staticRoot }).request(path)

      expect(response.status).toBe(404)
      expect(response.headers.get("content-type") ?? "").not.toContain("text/html")
      expect(response.headers.get("cache-control")).toBeNull()
    },
  )

  it.each(["/api", "/api/missing"])("returns structured errors for %s", async (path) => {
    const response = await createApiApp({ staticRoot }).request(path)

    expect(response.headers.get("content-type")).toContain("application/json")
    expect(apiErrorSchema.parse(await response.json()).code).toBe("SESSION_NOT_FOUND")
  })

  it("does not cache a missing asset through the Node server adapter", async () => {
    const server = serve({
      fetch: createApiApp({ staticRoot }).fetch,
      hostname: "127.0.0.1",
      port: 0,
    })

    try {
      if (!server.listening) {
        await once(server, "listening")
      }

      const address = server.address()
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a TCP address")
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/assets/missing.js`)

      expect(response.status).toBe(404)
      expect(response.headers.get("cache-control")).toBeNull()
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })
})
