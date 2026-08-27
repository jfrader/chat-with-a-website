# Changelog

## Unreleased

### Added

- Added end-to-end URL summarization with guarded public-page retrieval, persisted sessions, streamed LLM-generated summaries, and structured failure states.
- Added searchable history, routed session selection, summary copy/download actions, and durable source-grounded chat with suggested follow-up prompts.

### Improved

- Rebuilt the URL workspace to match the supplied Profound design, including its focused empty state, FE 6 generation state, stable inline validation, completed summaries, responsive history, and contextual chat.
- Improved stream recovery and cached-data resilience while hardening generated images and streamed chat announcements.
- Set DeepSeek V4 Flash as the default hosted summarization and chat model.
- Fixed the mobile chat shortcut so it opens with an empty composer instead of event text.
- Aligned completed sessions with the supplied design by moving summary actions into history, adding the bottom chat entry, expanding the chat rail, and preserving richer history previews.
- Simplified URL entry by accepting bare domains, delaying malformed-address feedback until submission, and unifying focused URL and chat fields with the supplied design.
