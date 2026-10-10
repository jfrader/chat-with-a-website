# Chat With a Website

[![ci](https://img.shields.io/github/actions/workflow/status/jfrader/chat-with-a-website/ci.yml?branch=main&style=flat&label=ci)](https://github.com/jfrader/chat-with-a-website/actions)
[![license](https://img.shields.io/github/license/jfrader/chat-with-a-website?style=flat)](./LICENSE)

Paste any URL and turn the page into a knowledge session: a summary of the page streams in live,
then you keep asking follow-up questions about its content.

![Chat With a Website](docs/screenshot.png)

## Features

- **Summarize any public URL** — the server fetches the page through a hardened client
  (private-IP filtering, redirect limits, strict timeouts) and works even for
  client-rendered pages, falling back to metadata.
- **Live-streamed summaries** — progress and the final summary arrive as server-sent events,
  so content appears while the model is still writing.
- **Chat about the page** — ask follow-up questions in the same session. The model can pull in
  linked pages from the article to ground its answers.
- **Session history** — anonymous, per-browser history with search. Reopening a session restores
  the summary, saved streaming progress, and the whole chat.
- **Quality-of-life** — per-page suggested questions, regenerate a summary in place, retry failed
  URLs, shareable session links, and a responsive dark UI with keyboard and reduced-motion support.

## Stack

| Layer | Technology |
| --- | --- |
| API | Node 24, Hono, server-sent events |
| Database | PostgreSQL, Drizzle ORM |
| Web | React 19, Vite, TanStack Router, TanStack Query |
| Styling | Tailwind CSS 4 + CSS Modules |
| Contracts | Zod schemas shared across the API and web |
| LLM | OpenAI-compatible SDK (DeepSeek by default) |
| Tooling | pnpm workspaces, TypeScript, Biome, Vitest, Docker, GitHub Actions |

## Architecture

```
apps/
  api/         Hono server: routes, sessions, secure page fetching, LLM client
  web/         React SPA: workspace, session views, stream handling
packages/
  contracts/   Shared Zod schemas and types (requests, responses, stream events)
  db/          Drizzle schema, client, and migrations
```

- A session holds the page metadata, the generated summary, and the chat messages.
  Summary and chat progress stream to the client over SSE; Zod schemas validate every event
  on both sides of the wire.
- The web app keeps the selected session and history search in the URL
  (TanStack Router), API data and stream updates in TanStack Query, and purely local UI state
  in components.
- Anonymous workspaces are identified by a cookie so history is isolated per browser without
  requiring an account.

## Run locally

```sh
cp .env.example .env   # set LLM_API_KEY
docker compose up --build
```

Open http://localhost:4310. Stop with `docker compose down`.

### Without PostgreSQL

Set `NO_DATABASE=true` on the API. Unset or `false` keeps PostgreSQL mode;
other values are rejected. No database connection or migration is made in browser mode.

With Node 24 and pnpm 11.24:

```sh
pnpm install --frozen-lockfile
NO_DATABASE=true LLM_API_KEY=your-key pnpm --filter @chat-with-a-website/api dev
# In another terminal:
pnpm --filter @chat-with-a-website/web dev
```

Open http://localhost:4310. For a standalone Docker image:

```sh
docker build -t chat-with-a-website .
docker run --rm -p 4311:4311 -e NO_DATABASE=true -e LLM_API_KEY chat-with-a-website
```

Export `LLM_API_KEY` in the shell before running Docker. `LLM_MODEL` and
`LLM_BASE_URL` remain optional server-side settings. Never put provider keys in
Vite variables or browser storage. The same web build reads the API's runtime mode.
Existing Docker Compose and Render deployments retain their PostgreSQL setup.

History, extracted page text, summaries, and chat messages are stored in this
browser's localStorage, not on the API. Completed sessions can be reopened and
chatted with after an API restart. Clearing site storage deletes that history;
it does not sync across devices, browsers, or origins. In-progress requests cannot
resume after a restart or reload; retry the failed summary or message. Blocked or
full browser storage must be enabled or cleared before new results can be saved.

## Ideas for next steps

- Share a session through a public link.
- Add real authentication for durable cross-device history.
- Show each summarized URL's favicon in the history list.
- Virtualize history and chat lists for very long sessions.

## License

[MIT](LICENSE)
