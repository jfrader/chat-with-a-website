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
- Matched the completed-summary chat entry to the supplied design's exact width and bottom spacing.
- Simplified URL entry by accepting bare domains, delaying malformed-address feedback until submission, and unifying focused URL and chat fields with the supplied design.
- Replaced browser autofill on the URL field with in-app history suggestions that appear from a partial address while typing and add a new-summary option once the address is valid.
- Rejected addresses without a domain suffix at submission so text like “truco” gets inline feedback instead of recording an unreachable failed session.
- Preferred IPv4 answers with family fallback in the SSRF-safe fetcher so hosts with unroutable IPv6 no longer time out.
- Capped the development network MTU below common VPN tunnel sizes so container fetches are never silently dropped.
- Added a Try again action to the unavailable-summary state so a transient load failure no longer forces a return home.
- Added a Try again action to failed summaries that reruns the same URL and replaces the failed session in history.
- Enabled grayscale font antialiasing so light-on-dark text renders without subpixel color fringing.
- Summarized client-rendered pages from their metadata, clearly labeled, instead of failing with empty content.
- Themed all scrollbars with the accent color and moved the summary and history scrollbars to their pane edges instead of hugging the text.
- Let chat explore beyond thin sources with clearly labeled general knowledge and next steps instead of dead-end refusals.
- Kept scroll position while chat replies stream, following the stream only when already at the bottom, and let streaming summaries be followed the same way.
- Let chat load a URL or path mentioned in a message through the SSRF-safe fetcher so conversations can explore linked pages.
- Matched the session actions menu to the supplied design's floating copy, download, and delete pills.
- Matched the empty workspace sidebar, empty chat panel, and chat composer copy to the supplied design.
- Added a collapsible Thought line above assistant chat replies whenever the model streams reasoning content.
