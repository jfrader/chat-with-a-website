# Profound URL Summarization

A focused URL-to-knowledge workspace built with React, Hono, PostgreSQL, and shared Zod contracts.
It turns a public webpage into a streamed Markdown summary, keeps durable history, and supports
source-grounded follow-up chat.

## Development

Copy the example environment and provide a DeepSeek API key:

```sh
cp .env.example .env
```

Set `LLM_API_KEY` in `.env`, then start PostgreSQL, migrations, the API, and the web app with hot
reload:

```sh
docker compose up --build
```

Open http://localhost:4310. Stop the stack with `docker compose down`; add `--volumes` to discard
the local database.

Without a key, the application still starts and exposes its failure states, but summary and chat
generation end with an LLM-unavailable error.

## Native development

Use Node 24 and pnpm 11.24.0:

```sh
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/urlsum pnpm db:migrate
```

Run these in separate terminals:

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/urlsum LLM_API_KEY=... pnpm --filter @profound/api dev
pnpm --filter @profound/web dev
```

Open http://localhost:4310 and stop each process with `Ctrl+C`.

## Production

```sh
LLM_API_KEY=... \
docker compose -f compose.production.yaml up --build
```

Open http://localhost:4311. Stop the stack with
`docker compose -f compose.production.yaml down`.

## Quality

```sh
pnpm format
pnpm check
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/urlsum \
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/urlsum \
pnpm verify
```

`pnpm check` runs formatting, linting, strict typechecking, tests, and production builds.
`pnpm verify` also applies the committed database migrations. `TEST_DATABASE_URL` enables the real
PostgreSQL repository tests; use a disposable database because those tests truncate session data.

## Product

- Submit a public URL and create a summary without duplicate sessions on retries.
- Watch the summary appear as it is generated. Partial output remains after a refresh.
- Search, open, and delete previous sessions.
- Copy or download a Markdown summary and open its source page.
- Ask follow-up questions about the source and summary.
- Include another URL or path in chat to load and discuss a related page.
- Use suggested questions to continue exploring a completed summary.
- Use history and chat on desktop or mobile with a keyboard or touch screen.

## Design decisions

The summary is the main reading area. History helps users find earlier work, and chat supports the
open summary. On small screens, history and chat open as drawers instead of making the summary narrow.

CSS Modules hold design-specific styles. Tailwind handles responsive layout changes. Suggested
questions give users a simple next step and open the existing chat.

## Architecture

```text
apps/web             React 19, Vite 8, TanStack Router/Query, Tailwind responsive utilities,
                     token-backed CSS Modules
apps/api             Hono API, health routes, static production server, graceful shutdown
packages/contracts   Browser-safe Zod requests, DTOs, stream envelopes, safe errors
packages/db          Drizzle schema, PostgreSQL client, generated SQL migrations
```

The web package can import contracts but is linted against server and database imports. Development
runs separate Vite and Hono processes; production serves the API and compiled SPA from one Hono
process. The production image runs as a non-root user with pruned dependencies.

### Session flow

1. The browser creates an `idempotencyKey` and reuses it if the request is retried.
2. PostgreSQL uses that key to prevent duplicate sessions and returns the existing session when needed.
3. Only a new session starts a background summary job.
4. The job checks and fetches the URL, extracts readable content, streams the summary, saves partial
   results, and sends live updates through SSE.
5. Chat saves user messages and partial assistant replies before each stream closes.

Fetched pages are treated as untrusted. The service checks every URL and redirect to block private
addresses, limits download and request sizes, limits concurrent generation, and tells the model not to
follow instructions found in the source page.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `LLM_API_KEY` | DeepSeek or compatible-provider API key | No generation without it |
| `LLM_MODEL` | Chat-completions model | `deepseek-v4-flash` |
| `LLM_BASE_URL` | OpenAI-compatible provider endpoint | `https://api.deepseek.com` |
| `PORT` | Hono API port | `4311` |
| `API_PROXY_TARGET` | Vite development API target | `http://localhost:4311` |

Local `.env` files are ignored by Git and Docker build context.
