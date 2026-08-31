import type { LookupAddress } from "node:dns"
import { lookup } from "node:dns/promises"
import { isIP, type LookupFunction } from "node:net"
import ipaddr from "ipaddr.js"
import { Agent } from "undici"
import { SessionPipelineError } from "../errors"

const allowedProtocols = new Set(["http:", "https:"])
const redirectStatuses = new Set([301, 302, 303, 307, 308])
const supportedContentTypes = new Set(["text/html", "application/xhtml+xml"])

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000
export const DEFAULT_MAX_REDIRECTS = 5
export const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000
export const DEFAULT_USER_AGENT = "ProfoundURLSummarizer/1.0 (+https://profound.local)"

export type HostResolver = (hostname: string) => Promise<readonly string[]>

export type SecureFetchOptions = {
  fetch?: typeof globalThis.fetch
  resolver?: HostResolver
  signal?: AbortSignal
  timeoutMs?: number
  maxRedirects?: number
  maxResponseBytes?: number
  userAgent?: string
}

export type FetchedPage = {
  finalUrl: string
  html: string
}

type ResolvedPublicUrl = {
  addresses: readonly string[]
  url: URL
}

const stripIpv6Brackets = (hostname: string) =>
  hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname

export const isPublicIpAddress = (address: string): boolean => {
  try {
    const parsed = ipaddr.parse(stripIpv6Brackets(address))
    const normalized =
      parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
        ? (parsed as ipaddr.IPv6).toIPv4Address()
        : parsed
    return normalized.range() === "unicast"
  } catch {
    return false
  }
}

const defaultResolver: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true })
  return results.map(({ address }) => address)
}

async function resolvePublicUrl(
  value: string | URL,
  resolver: HostResolver = defaultResolver,
): Promise<ResolvedPublicUrl> {
  let url: URL

  try {
    url = value instanceof URL ? new URL(value) : new URL(value)
  } catch (error) {
    throw new SessionPipelineError("INVALID_URL", { cause: error })
  }

  if (!allowedProtocols.has(url.protocol) || url.username || url.password) {
    throw new SessionPipelineError("URL_NOT_ALLOWED")
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SessionPipelineError("URL_NOT_ALLOWED")
  }

  let addresses: readonly string[]
  if (ipaddr.isValid(hostname)) {
    addresses = [hostname]
  } else {
    try {
      addresses = await resolver(hostname)
    } catch (error) {
      throw new SessionPipelineError("FETCH_UNREACHABLE", { cause: error })
    }
  }

  if (addresses.length === 0) {
    throw new SessionPipelineError("FETCH_UNREACHABLE")
  }

  if (addresses.some((address) => !isPublicIpAddress(address))) {
    throw new SessionPipelineError("URL_NOT_ALLOWED")
  }

  return { addresses, url }
}

export async function validatePublicUrl(
  value: string | URL,
  resolver: HostResolver = defaultResolver,
): Promise<URL> {
  return (await resolvePublicUrl(value, resolver)).url
}

export const sortPublicAddresses = (addresses: readonly string[]): LookupAddress[] =>
  addresses
    .map((address) => ({ address, family: isIP(address) }))
    .sort((left, right) => left.family - right.family)

function createPinnedDispatcher(addresses: readonly string[]): Agent {
  const vettedAddresses = sortPublicAddresses(addresses)
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    const candidates =
      options.family === 4 || options.family === 6
        ? vettedAddresses.filter(({ family }) => family === options.family)
        : vettedAddresses
    const selected = candidates[0]

    if (!selected) {
      const error = Object.assign(new Error("No vetted address matches the requested family"), {
        code: "ENOTFOUND",
      })
      callback(error, "", 0)
      return
    }

    if (options.all) callback(null, candidates)
    else callback(null, selected.address, selected.family)
  }

  // Reuse only the DNS answers already checked above, preventing a second lookup from rebinding.
  // IPv4-first ordering plus family autoselection keeps hosts reachable when one family has no route.
  return new Agent({ connect: { lookup: pinnedLookup, autoSelectFamily: true } })
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new SessionPipelineError("FETCH_TIMEOUT")

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SessionPipelineError("FETCH_TIMEOUT"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SessionPipelineError("CONTENT_TOO_LARGE")
  }

  if (!response.body) return ""

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new SessionPipelineError("CONTENT_TOO_LARGE")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export async function fetchPublicPage(
  initialUrl: string,
  options: SecureFetchOptions = {},
): Promise<FetchedPage> {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const resolver = options.resolver ?? defaultResolver
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  let currentUrl = initialUrl
  const controller = new AbortController()
  let timedOut = false
  const onCallerAbort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      let dispatcher: Agent | undefined

      try {
        const resolvedUrl = await withAbort(
          resolvePublicUrl(currentUrl, resolver),
          controller.signal,
        )
        dispatcher = options.fetch ? undefined : createPinnedDispatcher(resolvedUrl.addresses)
        const requestOptions = {
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": userAgent,
          },
          redirect: "manual",
          signal: controller.signal,
          ...(dispatcher
            ? {
                dispatcher: dispatcher as unknown as NonNullable<RequestInit["dispatcher"]>,
              }
            : {}),
        } satisfies RequestInit
        const response = await fetchImplementation(resolvedUrl.url, requestOptions)

        if (redirectStatuses.has(response.status)) {
          const location = response.headers.get("location")
          await response.body?.cancel()
          if (!location || redirectCount === maxRedirects) {
            throw new SessionPipelineError("FETCH_UNREACHABLE")
          }
          currentUrl = new URL(location, resolvedUrl.url).toString()
          continue
        }

        if (!response.ok) {
          await response.body?.cancel()
          throw new SessionPipelineError("FETCH_UNREACHABLE")
        }

        const contentType = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase()
        if (!contentType || !supportedContentTypes.has(contentType)) {
          await response.body?.cancel()
          throw new SessionPipelineError("UNSUPPORTED_CONTENT_TYPE")
        }

        return {
          finalUrl: resolvedUrl.url.toString(),
          html: await readLimitedBody(response, maxResponseBytes),
        }
      } finally {
        await dispatcher?.close()
      }
    }

    throw new SessionPipelineError("FETCH_UNREACHABLE")
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SessionPipelineError(timedOut ? "FETCH_TIMEOUT" : "GENERATION_INTERRUPTED", {
        cause: error,
      })
    }
    if (error instanceof SessionPipelineError) throw error
    throw new SessionPipelineError("FETCH_UNREACHABLE", { cause: error })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", onCallerAbort)
  }
}
