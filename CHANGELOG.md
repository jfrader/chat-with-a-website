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
- Wrote page-specific follow-up questions during summarization and sent chosen questions immediately instead of only prefilling the chat.
- Kept follow-up questions short and showed a loading skeleton in the Keep exploring section while they are written.
- Matched the selected history card to the supplied design with full-bleed cards, a right-edge accent line, and a glow that builds toward it.
- Replaced the Complete label on history cards with a model-written mini tagline describing each page.
- Added a regenerate button on completed summaries that reruns the pipeline in the same session with a fresh attempt.
- Fixed the invisible copy icon in the session actions menu and kept the menu open through the scroll caused by opening it.
- Centered the session actions trigger and sized its circle to the dots while keeping the full touch target.
- Fixed the collapsed history rail so the expand control stays visible and centered instead of being pushed out of view.
- Slid the history sidebar smoothly between states and aligned the collapse control evenly with the sidebar's top and right edges.
- Slid the chat panel in on open and replaced the chat entry's plus button with a chat icon that opens the conversation.
- Rebuilt the history search on the shared composer field so it matches the other inputs with an aligned icon.
- Showed the link icon with the full address on history cards, dropped the duplicated domain line, and kept taglines to one line.
- Placed a chat toggle where the chat close control lands so closing chat never leaves the pointer on the regenerate button.
- Shrank the chat toggle away while chat is open and grew it back on close, collapsing its space so the regenerate button sits flush.
- Played interface transitions regardless of the reduced-motion preference, which now pauses only looping effects like skeletons and the streaming caret.
- Slid the chat panel open and closed by animating its real width so the layout glides instead of jumping.
- Fixed mobile summary scrolling and moved the summary actions into the mobile top bar as clear regenerate and chat icons.
- Named the open session in the chat header, aligned its close control with the top bar, and slid the now full-width mobile history drawer.
- Kept the session actions menu open on touch, copied without a secure clipboard, and confirmed copy and download with a visible message.
- Made the session actions menu keyboard operable and dropped it below its trigger on narrow screens with a solid backdrop.
- Copied the session link from the actions menu, matching the design's copy-beside-URL pill, while Download Markdown keeps exporting the summary.
- Matched the session actions menu to the supplied design's floating copy, download, and delete pills.
- Matched the empty workspace sidebar, empty chat panel, and chat composer copy to the supplied design.
- Added a collapsible Thought line above assistant chat replies whenever the model streams reasoning content.
