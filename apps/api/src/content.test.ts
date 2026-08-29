import { describe, expect, it } from "vitest"
import {
  extractReadableContent,
  MAX_DESCRIPTION_CHARACTERS,
  MAX_SITE_NAME_CHARACTERS,
  MAX_TITLE_CHARACTERS,
  splitSummaryDeltas,
  summarizeExtractively,
} from "./content"
import { SessionPipelineError } from "./session-errors"

describe("content extraction", () => {
  it("extracts metadata and readable article text while removing page chrome", () => {
    const extracted = extractReadableContent(
      `<!doctype html>
        <html>
          <head>
            <title>Fallback title</title>
            <meta property="og:title" content=" A useful article ">
            <meta property="og:site_name" content="Example Journal">
            <meta name="description" content="An evidence-based description.">
            <link rel="canonical" href="/canonical-story">
          </head>
          <body>
            <nav>Navigation should disappear.</nav>
            <article>
              <h1>A useful article</h1>
              <p>The first factual sentence explains the subject clearly.</p>
              <p>The second factual sentence supplies useful supporting context.</p>
              <script>secret()</script>
            </article>
          </body>
        </html>`,
      "https://example.com/redirected",
    )

    expect(extracted).toMatchObject({
      canonicalUrl: "https://example.com/canonical-story",
      title: "A useful article",
      siteName: "Example Journal",
      description: "An evidence-based description.",
      sourceTruncated: false,
    })
    expect(extracted.sourceText).toContain("first factual sentence")
    expect(extracted.sourceText).toContain(
      "A useful article The first factual sentence explains the subject clearly.",
    )
    expect(extracted.sourceText).not.toContain("Navigation should disappear")
    expect(extracted.sourceText).not.toContain("secret")
    expect(extracted.sourceWordCount).toBeGreaterThan(10)
  })

  it("rejects pages without enough readable content or metadata", () => {
    expect(() =>
      extractReadableContent("<html><body>Too short</body></html>", "https://x.com"),
    ).toThrowError(SessionPipelineError)
  })

  it("falls back to page metadata when a client-rendered page has an empty body", () => {
    const extracted = extractReadableContent(
      `<html><head>
        <title>Gurisitos Games — Games to play together</title>
        <meta name="description" content="Independent studio from Argentina. Web games with their own identity." />
        <meta property="og:site_name" content="Gurisitos Games" />
      </head><body><div id="root"></div></body></html>`,
      "https://gurisitos.example",
    )

    expect(extracted.metadataOnly).toBe(true)
    expect(extracted.sourceText).toContain("Title: Gurisitos Games — Games to play together")
    expect(extracted.sourceText).toContain(
      "Description: Independent studio from Argentina. Web games with their own identity.",
    )
    expect(extracted.sourceWordCount).toBeGreaterThan(5)
    expect(extracted.sourceTruncated).toBe(false)
  })

  it("caps page-controlled metadata retained in session events", () => {
    const extracted = extractReadableContent(
      `<html><head>
        <title>${"t".repeat(1_000)}</title>
        <meta property="og:site_name" content="${"s".repeat(1_000)}">
        <meta name="description" content="${"d".repeat(1_000)}">
        <link rel="canonical" href="https://example.com/${"c".repeat(3_000)}">
      </head><body><article>Enough readable words exist here to produce valid extracted content.</article></body></html>`,
      "https://example.com/final",
    )

    expect(extracted.title).toHaveLength(MAX_TITLE_CHARACTERS)
    expect(extracted.siteName).toHaveLength(MAX_SITE_NAME_CHARACTERS)
    expect(extracted.description).toHaveLength(MAX_DESCRIPTION_CHARACTERS)
    expect(extracted.canonicalUrl).toBe("https://example.com/final")
  })
})

describe("local extractive summarization", () => {
  it("deterministically selects source sentences and emits lossless deltas", () => {
    const source = [
      "The opening sentence establishes the central claim with concrete facts.",
      "A second sentence adds supporting evidence from the source material.",
      "The third sentence explains the practical consequence for readers.",
      "The fourth sentence records an important limitation in the evidence.",
      "A fifth sentence should not be selected because the summary is intentionally concise.",
    ].join(" ")

    const first = summarizeExtractively(source)
    const second = summarizeExtractively(source)

    expect(first).toBe(second)
    expect(source).toContain(first)
    expect(first).not.toContain("A fifth sentence")
    expect(splitSummaryDeltas(first, 31).join("")).toBe(first)
    expect(splitSummaryDeltas(first, 31).every((delta) => delta.length > 0)).toBe(true)
  })
})
