import { describe, expect, it, vi } from "vitest"
import {
  fetchPublicPage,
  isPublicIpAddress,
  type HostResolver,
  validatePublicUrl,
} from "./secure-fetch"
import type { SessionPipelineError } from "./session-errors"

const publicResolver: HostResolver = async () => ["93.184.216.34"]

describe("SSRF destination validation", () => {
  it.each([
    ["93.184.216.34", true],
    ["8.8.8.8", true],
    ["2606:4700:4700::1111", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["::ffff:127.0.0.1", false],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected)
  })

  it("rejects localhost and any DNS answer containing a private address", async () => {
    await expect(validatePublicUrl("http://localhost/page", publicResolver)).rejects.toMatchObject({
      code: "URL_NOT_ALLOWED",
    })
    await expect(
      validatePublicUrl("https://mixed.example/page", async () => ["93.184.216.34", "10.0.0.2"]),
    ).rejects.toMatchObject({ code: "URL_NOT_ALLOWED" })
  })
})

describe("secure page fetching", () => {
  it("uses explicit safe fetch settings and validates every redirect destination", async () => {
    const resolver = vi.fn<HostResolver>(async () => ["93.184.216.34"])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://final.example/story" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          "<html><article>Enough useful words for this fetched article.</article></html>",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
      )

    const result = await fetchPublicPage("https://start.example/path", {
      fetch: fetchMock,
      resolver,
    })

    expect(result.finalUrl).toBe("https://final.example/story")
    expect(resolver).toHaveBeenNthCalledWith(1, "start.example")
    expect(resolver).toHaveBeenNthCalledWith(2, "final.example")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": expect.stringContaining("ProfoundURLSummarizer"),
      },
    })
  })

  it("blocks a redirect that resolves to a private address before fetching it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "http://internal.example/admin" } }),
      )
    const resolver: HostResolver = async (hostname) =>
      hostname === "internal.example" ? ["192.168.1.10"] : ["93.184.216.34"]

    await expect(
      fetchPublicPage("https://public.example", { fetch: fetchMock, resolver }),
    ).rejects.toMatchObject({ code: "URL_NOT_ALLOWED" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps one deadline across a redirect chain", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              setTimeout(
                () =>
                  resolve(
                    new Response(null, {
                      status: 302,
                      headers: { location: "https://final.example/story" },
                    }),
                  ),
                6,
              )
            }),
        )
        .mockImplementationOnce((_input, init) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("deadline reached")))
          })
        })
      const result = fetchPublicPage("https://start.example/path", {
        fetch: fetchMock,
        resolver: publicResolver,
        timeoutMs: 10,
      })
      const rejection = expect(result).rejects.toMatchObject({ code: "FETCH_TIMEOUT" })

      await vi.advanceTimersByTimeAsync(10)

      await rejection
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects unsupported content and oversized streamed responses", async () => {
    await expect(
      fetchPublicPage("https://example.com/file", {
        resolver: publicResolver,
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("binary", { headers: { "content-type": "image/png" } })),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" })

    await expect(
      fetchPublicPage("https://example.com/large", {
        resolver: publicResolver,
        maxResponseBytes: 4,
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("12345", { headers: { "content-type": "text/html" } })),
      }),
    ).rejects.toMatchObject({ code: "CONTENT_TOO_LARGE" })
  })

  it("turns an aborted fetch into a safe timeout failure", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("socket details")))
      })
    })

    await expect(
      fetchPublicPage("https://slow.example", {
        fetch: fetchMock,
        resolver: publicResolver,
        timeoutMs: 1,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SessionPipelineError>>({ code: "FETCH_TIMEOUT" }),
    )
  })

  it("applies the request deadline while resolving DNS", async () => {
    await expect(
      fetchPublicPage("https://slow.example", {
        fetch: vi.fn<typeof fetch>(),
        resolver: async () => new Promise<readonly string[]>(() => {}),
        timeoutMs: 1,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SessionPipelineError>>({ code: "FETCH_TIMEOUT" }),
    )
  })

  it("keeps the timeout active while reading the response body", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("body stalled")))
        },
      })

      return Promise.resolve(new Response(body, { headers: { "content-type": "text/html" } }))
    })

    await expect(
      fetchPublicPage("https://slow.example", {
        fetch: fetchMock,
        resolver: publicResolver,
        timeoutMs: 1,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SessionPipelineError>>({ code: "FETCH_TIMEOUT" }),
    )
  })
})
