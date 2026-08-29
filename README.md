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

- Safe public-URL submission with stable validation and idempotent retries.
- Live summary stages and token deltas with refresh-safe persisted partial output.
- Searchable, paginated session history with routed selection and deletion recovery.
- Markdown summaries with source metadata, copy, download, and safe source links.
- Session-scoped, streaming follow-up chat grounded in the extracted source and summary.
- Chat loads a URL or path mentioned in a message through the same SSRF-safe fetcher, so conversations can explore linked pages.
- Suggested follow-up prompts as the additional user-facing experience requested by the brief.
- Responsive history and chat drawers with keyboard, focus, reduced-motion, and touch support.

## Design decisions

The summary remains the dominant reading surface, with history providing orientation and chat acting
as contextual secondary tooling. On narrower screens, those supporting surfaces become modal drawers
instead of compressing the article. Static Figma-specific visuals stay in token-backed CSS Modules;
Tailwind utilities express responsive layout changes beside the components they affect.

Suggested follow-up prompts are the deliberate addition beyond the brief. They turn a completed
summary into clear next actions, reduce blank-composer friction, and open the same source-grounded chat
flow rather than introducing another product surface.

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

1. The browser generates an `idempotencyKey` and reuses it when a create request is retried.
2. PostgreSQL's unique constraint arbitrates concurrent creates. The repository inserts the session
   with `ON CONFLICT DO NOTHING`, then returns either the inserted row or the existing row.
3. The session service starts one local background promise only when the repository reports that the
   row was newly created. Idempotent POSTs return the persisted session without starting another job.
4. That job securely fetches the public URL, deterministically extracts readable content, streams an
   LLM-generated summary, persists each stage and partial result, and publishes typed deltas and
   snapshots over local SSE. GET and terminal SSE snapshots read the persisted session.
5. Chat follows the same durability boundary: user/assistant records are created atomically, partial
   assistant output is batched to PostgreSQL, and terminal messages are persisted before the stream
   closes.

The service treats fetched content as untrusted data, validates every redirect and resolved address
against SSRF restrictions, caps downloaded/extracted content, limits request bodies and concurrent
generations, and sends prompts that forbid following source-page instructions.

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

## Failure and recovery

Typed failures distinguish invalid/private URLs, inaccessible pages, empty content, provider rate
limits, provider outages, interrupted work, and internal failures. Terminal state is persisted before
being published. A process restart marks stale sessions and messages interrupted; an incomplete SSE
connection is treated as recoverable rather than as success.

## Scope and scale path

This challenge intentionally runs as one API process with in-memory ownership of active jobs and
streams. PostgreSQL preserves results and idempotency, but an in-progress job is not resumed after a
restart. Authentication, organizations, billing, long-term retention controls, and a hosted preview
are not included.

Horizontal scaling would require moving admission and execution to a durable queue, assigning each job
an owner/lease, publishing deltas through shared infrastructure, and routing SSE subscribers across
instances. PostgreSQL full-text search and tenant-scoped authorization would replace the current
challenge-sized literal search and unauthenticated workspace.

With more time, the next product improvements would be authenticated workspaces, durable resumable
jobs, richer source context such as pasted text or files, and production observability for model cost,
latency, and stream failures.
