import { load } from "cheerio"
import { SessionPipelineError } from "./session-errors"

export const MAX_SOURCE_CHARACTERS = 120_000
export const SUMMARY_MAX_CHARACTERS = 1_200
export const MAX_CANONICAL_URL_CHARACTERS = 2_048
export const MAX_TITLE_CHARACTERS = 300
export const MAX_SITE_NAME_CHARACTERS = 120
export const MAX_DESCRIPTION_CHARACTERS = 500

export type ExtractedPage = {
  canonicalUrl: string
  title: string | null
  siteName: string | null
  description: string | null
  sourceText: string
  sourceWordCount: number
  sourceTruncated: boolean
  metadataOnly: boolean
}

const cleanMetadata = (value: string | undefined, maxCharacters: number) =>
  value?.replace(/\s+/g, " ").trim().slice(0, maxCharacters) || null

const resolveCanonicalUrl = (value: string | undefined, finalUrl: string) => {
  if (!value || value.length > MAX_CANONICAL_URL_CHARACTERS) return finalUrl

  try {
    const canonicalUrl = new URL(value, finalUrl)
    if (canonicalUrl.protocol === "http:" || canonicalUrl.protocol === "https:") {
      return canonicalUrl.toString()
    }
  } catch {
    return finalUrl
  }

  return finalUrl
}

export function extractReadableContent(html: string, finalUrl: string): ExtractedPage {
  const $ = load(html)
  const title = cleanMetadata(
    $("meta[property='og:title']").attr("content") ?? $("title").first().text(),
    MAX_TITLE_CHARACTERS,
  )
  const siteName = cleanMetadata(
    $("meta[property='og:site_name']").attr("content"),
    MAX_SITE_NAME_CHARACTERS,
  )
  const description = cleanMetadata(
    $("meta[name='description']").attr("content") ??
      $("meta[property='og:description']").attr("content"),
    MAX_DESCRIPTION_CHARACTERS,
  )
  const canonicalUrl = resolveCanonicalUrl($("link[rel='canonical']").attr("href"), finalUrl)

  $(
    "script,style,noscript,template,svg,canvas,nav,footer,header,aside,form,dialog,[hidden],[aria-hidden='true']",
  ).remove()

  const contentRoot = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("[role='main']").first().length
        ? $("[role='main']").first()
        : $("body").first()
  contentRoot.find("br").replaceWith(" ")
  contentRoot
    .find(
      "address,blockquote,dd,div,dl,dt,figcaption,figure,h1,h2,h3,h4,h5,h6,li,ol,p,pre,section,table,td,th,tr,ul",
    )
    .each((_index, element) => {
      $(element).append(" ")
    })
  const readableText = contentRoot.text().replace(/\s+/g, " ").trim()
  const sourceWordCount = readableText ? readableText.split(/\s+/).length : 0

  if (sourceWordCount < 5) {
    const metadataText = [
      title ? `Title: ${title}` : null,
      siteName ? `Site: ${siteName}` : null,
      description ? `Description: ${description}` : null,
    ]
      .filter(Boolean)
      .join("\n")
    const metadataWordCount = metadataText ? metadataText.split(/\s+/).length : 0
    if (metadataWordCount < 5) throw new SessionPipelineError("EMPTY_CONTENT")

    return {
      canonicalUrl,
      title,
      siteName,
      description,
      sourceText: metadataText,
      sourceWordCount: metadataWordCount,
      sourceTruncated: false,
      metadataOnly: true,
    }
  }

  const sourceTruncated = readableText.length > MAX_SOURCE_CHARACTERS
  const sourceText = sourceTruncated
    ? readableText.slice(0, MAX_SOURCE_CHARACTERS).trimEnd()
    : readableText

  return {
    canonicalUrl,
    title,
    siteName,
    description,
    sourceText,
    sourceWordCount,
    sourceTruncated,
    metadataOnly: false,
  }
}

export function summarizeExtractively(sourceText: string): string {
  const sentences = sourceText
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20)
  const candidates = sentences.length > 0 ? sentences : [sourceText.trim()]
  const selected: string[] = []

  for (const sentence of candidates) {
    const next = [...selected, sentence].join(" ")
    if (selected.length > 0 && next.length > SUMMARY_MAX_CHARACTERS) break
    selected.push(sentence)
    if (selected.length === 4 || next.length >= SUMMARY_MAX_CHARACTERS) break
  }

  const summary = selected.join(" ").slice(0, SUMMARY_MAX_CHARACTERS).trim()
  if (!summary) throw new SessionPipelineError("EMPTY_CONTENT")
  return summary
}

export function splitSummaryDeltas(summary: string, chunkSize = 240): string[] {
  const deltas: string[] = []
  for (let offset = 0; offset < summary.length; offset += chunkSize) {
    deltas.push(summary.slice(offset, offset + chunkSize))
  }
  return deltas
}
