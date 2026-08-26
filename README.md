# Profound URL Summarization

A focused URL-to-knowledge workspace built with React, Hono, PostgreSQL, and shared Zod contracts.

## Development

Docker Compose starts PostgreSQL, applies migrations, and runs the API and web app with hot reload:

```sh
docker compose up --build
```

Open http://localhost:4310. Stop the stack with `docker compose down`; add `--volumes` to discard
the local database.

## UI only

Use Node 24 and pnpm 11.24.0:

```sh
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @profound/web dev
```

Open http://localhost:4310 and stop the process with `Ctrl+C`.

## Production

```sh
docker compose -f compose.production.yaml up --build
```

Open http://localhost:4311. Stop the stack with
`docker compose -f compose.production.yaml down`.

## Quality

```sh
pnpm format
pnpm check
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/urlsum pnpm verify
```

`pnpm check` runs formatting, linting, strict typechecking, tests, and production builds.
`pnpm verify` also applies the committed database migrations.

## Architecture

```text
apps/web             React 19, Vite 8, TanStack Router/Query, token-backed CSS Modules
apps/api             Hono API, health routes, static production server, graceful shutdown
packages/contracts   Browser-safe Zod requests, DTOs, stream envelopes, safe errors
packages/db          Drizzle schema, PostgreSQL client, generated SQL migrations
```

The web package can import contracts but is linted against server and database imports. Development
runs separate Vite and Hono processes; production serves the API and compiled SPA from one Hono
process. The production image runs as a non-root user with pruned dependencies.

## Configuration

Copy `.env.example` for native workflows. `DATABASE_URL` configures PostgreSQL, `PORT` configures the
API, and `API_PROXY_TARGET` configures Vite's development proxy. Local `.env` files are ignored by
Git and Docker.
