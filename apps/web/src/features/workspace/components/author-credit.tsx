const AUTHOR_WEBSITE_URL = "https://jfrader.com"

export function AuthorCredit() {
  return (
    <footer className="flex shrink-0 justify-center px-4">
      <a
        className="inline-flex min-h-(--control-touch-target) items-center rounded-(--radius-card) px-2 text-xs text-(--theme-text-muted) underline decoration-transparent underline-offset-4 transition-colors hover:text-(--theme-text-primary) hover:decoration-current focus-visible:text-(--theme-text-primary) active:text-(--theme-link)"
        href={AUTHOR_WEBSITE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Made by Fran
      </a>
    </footer>
  )
}
