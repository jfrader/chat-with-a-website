import type { SessionDto } from "@chat-with-a-website/contracts"

function safeSourceUrl(session: SessionDto) {
  const value = session.finalUrl ?? session.canonicalUrl
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

export function SummaryHeader({ session }: { session: SessionDto }) {
  const sourceUrl = safeSourceUrl(session)
  const title = session.title ?? session.host

  return (
    <header>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-(--theme-text-muted)">
        {sourceUrl ? (
          <a
            className="text-(--theme-text-secondary) no-underline hover:text-(--theme-text-primary)"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {session.siteName ?? session.host}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span>{session.siteName ?? session.host}</span>
        )}
        {session.sourceWordCount > 0 ? (
          <span>{session.sourceWordCount.toLocaleString()} source words</span>
        ) : null}
      </div>
      <h1
        className="m-0 text-[28px] leading-8 font-semibold tracking-(--tracking-title) text-(--theme-text-primary) max-mobile:text-2xl"
        id="session-title"
      >
        {title}
      </h1>
      {session.description ? (
        <p className="mt-3 mb-0 text-sm leading-[1.6] text-(--theme-text-description)">
          {session.description}
        </p>
      ) : null}
    </header>
  )
}
