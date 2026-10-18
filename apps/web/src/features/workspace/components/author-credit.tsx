const AUTHOR_WEBSITE_URL = "https://jfrader.com"

export function AuthorCredit() {
  return (
    <footer className="flex shrink-0 justify-center px-4">
      <a
        className="inline-flex min-h-(--control-touch-target) items-center rounded-(--ui-radius-sm) px-2 text-(length:--ui-text-size-sm) text-(--ui-color-text-subtle) underline decoration-transparent underline-offset-4 transition-colors hover:text-(--ui-color-text) hover:decoration-current focus-visible:text-(--ui-color-text) active:text-(--ui-color-accent-text)"
        href={AUTHOR_WEBSITE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Made by Fran
      </a>
    </footer>
  )
}
