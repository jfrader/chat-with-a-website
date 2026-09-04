import { SummaryActionButton } from "./summary-action-button"

const fallbackSuggestions = [
  "What are the three most important takeaways?",
  "What evidence supports the main argument?",
  "What should I read or verify next?",
]

export function FollowUpSuggestions({
  onOpenChat,
  prompts,
}: {
  onOpenChat: (prompt: string) => void
  prompts: string[]
}) {
  const suggestions = prompts.length ? prompts : fallbackSuggestions
  return (
    <section
      className="mt-10 grid gap-4 border-t border-(--theme-line-subtle-color) pt-6"
      aria-labelledby="follow-up-title"
    >
      <div>
        <h2 className="m-0 text-base" id="follow-up-title">
          Keep exploring
        </h2>
        <p className="mt-1 mb-0 text-xs text-(--theme-text-muted)">
          Choose a question to ask it in chat.
        </p>
      </div>
      <div className="grid gap-2">
        {suggestions.map((suggestion) => (
          <SummaryActionButton
            className="w-full justify-start rounded-(--radius-card) text-left"
            type="button"
            key={suggestion}
            onClick={() => onOpenChat(suggestion)}
          >
            {suggestion}
          </SummaryActionButton>
        ))}
      </div>
    </section>
  )
}
