# Profound URL Summarization

Preview: [profound-url-summarization.onrender.com](https://profound-url-summarization.onrender.com)

## Run locally

```sh
cp .env.example .env
```

Set `LLM_API_KEY` in `.env`, then run:

```sh
docker compose up --build
```

Open http://localhost:4310. Stop with `docker compose down`.

## Design decisions

- TanStack Router stores the selected session and history search in the URL.
- TanStack Query stores API data and receives summary and chat stream updates.
- Components keep local UI state for drawers, menus, and dialogs.
- Tailwind handles normal layout and typography. CSS Modules handle complex effects and Markdown.
- Shared Zod schemas validate requests, responses, and stream events across the frontend and API.

## Beyond the assignment

- Existing-session matches
- Suggested questions
- Saved streaming progress
- Summary regeneration

**Why I added them:** They cover common cases around the main flow: returning to existing work,
deciding what to ask next, keeping progress during generation, and recovering from a failed summary.

**How they improve the result:** They reduce duplicate work, make chat easier to start, keep streamed
content after a refresh, and let users retry without creating a new session.

## What I would improve with more time

- Add real authentication for durable history that follows users across browsers and devices.
- Get each summarized URL's favicon to show it instead of the default link icon when available.
- Virtualize history and chat lists for better performance when they grow.
- Make the history and chat panels resizable and persist their size and collapsed state.
