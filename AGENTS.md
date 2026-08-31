# AGENTS.md

This repository is a TypeScript MCP server named `newsroom-mcp`, built with
`mcp-use` v2. It's a private AI news curation server: it ingests AI-related
content from RSS/Atom feeds, Hacker News, and GDELT, and exposes MCP tools
for a calling AI agent to cluster that content into curated "stories" and
read back a feed. See `IDEA.md` for the full original design spec.

## Project Shape

- `src/composition.ts` builds every repository/service once
  (`buildNewsroomServices()`) and registers all 8 tools onto a transport-
  agnostic `ToolRegistrar` (`registerNewsroomTools()`). Both entry points
  below just call these two functions.
- `index.ts` — the HTTP entry point: wraps a real `MCPServer` (mcp-use) as a
  `ToolRegistrar` and default-exports it. This is what `mcp-use dev` /
  `build` / `start` run, and what `npm run dev` serves on
  `http://localhost:3000/mcp`.
- `stdio.ts` — the stdio entry point (`npm run start:stdio`, via `tsx`):
  bridges the raw SDK's `McpServer` to the same `ToolRegistrar` interface
  via `src/tools/stdio-tool-registrar.ts`. Chooses stdio vs. HTTP is a
  launch-time choice (which script/command a client runs), not a runtime
  flag — HTTP stays the default.
- `src/domain/` — plain interfaces/types (`ContentItem`, `Story`, `Feed`,
  ...), no logic.
- `src/providers/` — one `ContentProvider` per source (`rss/`,
  `hacker-news/`, `gdelt/`), plus the `ContentProviderRegistry`. Never touch
  SQLite or make relevance/ranking decisions. See `docs/providers.md`.
- `src/repositories/` — repository interfaces (no SQL). `src/sqlite/` — the
  `node:sqlite`-backed implementations plus migrations. See
  `docs/sqlite-schema.md`.
- `src/services/` — `IngestionService` (polls every provider concurrently,
  isolates per-provider failures), `StoryService` (the
  `lastMeaningfulUpdateAt` rule — only a `meaningful-update` attachment
  bumps it — plus archiving stories stale 30+ days), `FeedService` (the
  `get-feed` view: hides stories stale 7+ days, ranks survivors by
  importance decayed toward zero since their last meaningful update). All
  business rules live here.
- `src/tools/` — MCP tool registration (`register<Name>Tool(registrar,
  ...)`), Zod schemas (`schemas.ts`), date serialization (`serialize.ts`),
  the transport-agnostic `ToolRegistrar` interface, and standardized error
  handling (`tool-errors.ts`). See `docs/mcp-tools.md`.
- `src/config.ts` — env var loading (`NEWSROOM_*`). `src/config/providers.ts`
  — the curated provider list.
- `test/unit/` — fast, no-network tests (in-memory SQLite, stubbed
  `fetch`). `test/mcp-server.test.ts` — protocol-level test against the real
  server. `test/live/` — opt-in live sanity tests against real APIs. See
  `docs/testing.md`.

## Current MCP Tools

See `docs/mcp-tools.md` for the full table. Summary: `fetch-new-items`,
`get-unprocessed-items`, `get-active-stories`, `create-story`,
`attach-item-to-story`, `update-story`, `mark-item-processed`, `get-feed`.

## Project Guides

Read the applicable guide before making changes:

- `docs/architecture.md` — layering, responsibility boundaries, why the AI
  agent (not the server) does relevance/clustering/summarization/ranking.
- `docs/providers.md` — per-source incremental-fetch strategy and how to add
  a new provider.
- `docs/sqlite-schema.md` — tables, indexes, migration mechanism.
- `docs/mcp-tools.md` — the tool surface and the business rule it enforces.
- `docs/testing.md` — the three testing layers and how to run each.

## Common Commands

```bash
npm run dev        # serve http://localhost:3000/mcp and the inspector
npm run start:stdio # serve over stdio instead (a client spawns the process)
npm run lint        # run ESLint
npm run test         # run Vitest (unit + protocol, no network)
npm run test:live    # opt-in live sanity tests (NEWSROOM_LIVE_TESTS=1)
npm run typecheck    # run mcp-use typecheck
npm run verify        # lint, test, and typecheck
npm run build          # build with mcp-use
```

Run `npm run verify` before handing off changes. For MCP behavior changes,
keep or extend the protocol-level test in `test/mcp-server.test.ts`.

## Implementation Notes

- ESM + `NodeNext` module resolution: every relative import ends in `.js`
  even though the source file is `.ts`.
- No new SQLite driver dependency: uses Node's built-in `node:sqlite`
  (`DatabaseSync`), not `better-sqlite3`.
- No React/Views — this project has no UI surface, unlike sibling projects
  that use `mcp-use` Views.
- Providers fetch with native `fetch()`, not a full HTTP client library.
- Every tool follows the same shape: validate with Zod, call one
  service/repository method, serialize `Date` fields to ISO 8601 strings via
  `src/tools/serialize.ts`, return `structuredContent` matching
  `outputSchema` plus a short text summary, catch errors via
  `toolErrorResult`.
- Keep domain logic in `src/services/` and `src/sqlite/` so it's unit
  testable without starting an MCP server; tool files stay thin.
- `IngestionService.fetchNewItems()` runs every provider concurrently
  (`Promise.all`); each provider owns its own try/catch, so one flaky
  provider never sinks the whole poll or blocks the others.
- No time-based archival job exists outside of `fetch-new-items` — stories
  only get archived as a side effect of that tool running
  (`StoryService.archiveStaleStories()`), since it's the one guaranteed
  periodic entry point.

## Environment

- Node.js must satisfy `>=22.5.0` (native `node:sqlite`, native `fetch`).
- ESM + TypeScript `NodeNext` module resolution.
- Env vars are documented in `.env.example`; see `src/config.ts` for
  defaults and validation.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
