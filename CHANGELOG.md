# Changelog

All notable user-visible changes to this project.

## Unreleased

### Added
- Optional `NO_DATABASE=true` mode for database-free hosting. Browser localStorage owns session history, summaries, chats and regenerates. Backend still performs secure page fetches, extraction, and LLM processing/streaming using existing logic. Default (flag unset/false) retains full PostgreSQL/Drizzle behavior and data compatibility. One build serves both via runtime /config.

See docs and env for invocation. Cross-device and server-restart resumption of in-progress work not supported in browser mode (data lives in browser only).
