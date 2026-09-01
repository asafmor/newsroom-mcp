# newsroom-mcp

A private AI news curation MCP server. It ingests AI-related content from RSS/Atom
feeds and Hacker News, and exposes MCP tools that let an AI agent
cluster that content into curated "stories" and read back a ranked feed —
without the server itself making any relevance, clustering, summarization,
or ranking decisions. See [IDEA.md](./IDEA.md) for the original design spec.

## Quick start

```bash
npm install
cp .env.example .env   # optional — sensible defaults exist without one
npm run dev             # serves http://localhost:3000/mcp + the Inspector
```

Two ways to run the server — pick whichever fits your client:

- **HTTP (default)** — `npm run dev` / `npm run start`. Point a client at
  `http://localhost:3000/mcp`. Requires the server to stay running.
- **stdio** — `npm run start:stdio` (or configure your MCP client to run
  `npx tsx stdio.ts` directly). The client spawns the process itself, so
  nothing needs to be kept running in the background. Both entrypoints share
  the same tool registrations (`src/composition.ts`) and the same SQLite
  database.

## Connecting an MCP client

### HTTP

Requires `npm run dev` (or `npm run start`) already running on port 3000.

`claude mcp add` (creates/updates `.mcp.json`):

```bash
claude mcp add --transport http newsroom-mcp http://localhost:3000/mcp
```

Equivalent `.mcp.json`:

```json
{
  "mcpServers": {
    "newsroom-mcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### stdio

No server needs to be running — Claude spawns the process itself and kills
it when the session ends.

`claude mcp add`:

```bash
claude mcp add newsroom-mcp -- npx tsx /absolute/path/to/newsroom-mcp/stdio.ts
```

Equivalent `.mcp.json`:

```json
{
  "mcpServers": {
    "newsroom-mcp": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/newsroom-mcp/stdio.ts"]
    }
  }
}
```

`stdio.ts` resolves its working directory relative to itself, so the command
works from anywhere — but `npx tsx` still needs to run with this repo's
`node_modules` in scope, hence the absolute path rather than a relative one.

## MCP Tools

| Tool | Purpose |
|---|---|
| `fetch-new-items` | Poll every configured provider, store new items, and archive stories stale 30+ days. |
| `get-unprocessed-items` | List content awaiting AI triage (items older than 1 week are excluded). |
| `get-active-stories` | List active stories as clustering candidates. |
| `create-story` | Create a story from one or more content items. |
| `attach-item-to-story` | Attach an item to an existing story. |
| `update-story` | Update a story's AI-maintained summary/scores. |
| `mark-item-processed` | Finalize an irrelevant item so it's never reconsidered. |
| `get-feed` | Retrieve the curated feed as stories, hiding anything stale 7+ days and decaying the rest by recency. |

Full details, including the `contribution` freshness rule, in
[docs/mcp-tools.md](./docs/mcp-tools.md).

## Content sources

- **RSS/Atom** — curated AI-news feeds (OpenAI, DeepMind, Hugging Face,
  TechCrunch AI, VentureBeat AI, MIT Technology Review AI, Anthropic, xAI,
  and more); see `src/config/providers.ts`.
- **Hacker News** — via the Algolia search API, query configurable via
  `NEWSROOM_HN_QUERY`.

More on each provider's incremental-fetch strategy in
[docs/providers.md](./docs/providers.md).

## Feed site

The curated feed is also published as a standalone read-only site (GitHub
Pages, served from the `feed` branch), a Vite React app (`site/`) sharing
its story-card UI with the in-app `get-feed` MCP View via `views/_shared/feed/`.
`npm run build:site` builds it; `.github/workflows/deploy-feed-site.yml`
deploys it to the `feed` branch's GitHub Pages root on every `main` push
touching `site/**`/`views/_shared/**`. The `feed.json` data it reads is
published separately by `npm run publish-feed` after a curation run.

## Development

```bash
npm run lint        # ESLint
npm run test         # Vitest: unit + protocol tests, no network
NEWSROOM_LIVE_TESTS=1 npm run test:live   # opt-in live sanity tests against real APIs
npm run typecheck    # mcp-use typecheck
npm run verify        # lint + test + typecheck
npm run build          # build with mcp-use
```

Testing strategy explained in [docs/testing.md](./docs/testing.md).
Architecture and layering in [docs/architecture.md](./docs/architecture.md).
SQLite schema in [docs/sqlite-schema.md](./docs/sqlite-schema.md).

## Environment variables

See [.env.example](./.env.example) for the full list (`NEWSROOM_DB_PATH`,
`NEWSROOM_LOG_LEVEL`, `NEWSROOM_HN_QUERY`, `NEWSROOM_FETCH_TIMEOUT_MS`,
`NEWSROOM_LIVE_TESTS`). None are required — every var has a working default.

## Project layout

```
src/domain/         plain interfaces/types, no logic
src/providers/       one ContentProvider per source + the registry
src/repositories/    persistence interfaces (no SQL)
src/sqlite/          node:sqlite-backed repositories + migrations
src/services/        business rules (IngestionService, StoryService, FeedService)
src/tools/           MCP tool registration, Zod schemas, serialization
src/config.ts        env var loading
src/config/providers.ts  curated provider list
test/unit/           fast, no-network tests
test/mcp-server.test.ts  protocol-level test against the real server
test/live/           opt-in live sanity tests
docs/                architecture, providers, schema, tools, testing guides
views/_shared/feed/ story-card UI shared by the MCP View and the standalone site
site/                standalone Vite React feed site (fed by published feed.json)
```
