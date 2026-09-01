# Architecture

newsroom-mcp is a hexagonal-ish pipeline: external sources → normalized
content → AI-curated stories → a read-only feed. Each layer only talks to the
one below it.

```
ContentProvider (RSS / Hacker News)
        ↓ ContentItem
IngestionService → ContentItemRepository, ProviderStateRepository
        ↓ StoredContentItem (SQLite)
AI agent (via MCP tools) decides relevance & clustering
        ↓
StoryService → StoryRepository
        ↓ Story / StoryItem (SQLite)
FeedService → StoryRepository + ContentProviderRegistry
        ↓ Feed (read model)
```

## Layers

- **`src/domain/`** — plain interfaces/types, no logic. `ContentItem`,
  `Story`, `Feed`, etc. This is the vocabulary every other layer shares.
- **`src/providers/`** — one `ContentProvider` implementation per source. A
  provider only translates an external API into `ContentItem[]` plus its next
  `ProviderState` cursor. It never touches SQLite, decides relevance,
  summarizes, ranks, or calls an LLM — see [providers.md](./providers.md).
- **`src/repositories/`** (interfaces) + **`src/sqlite/`** (implementations)
  — all SQL lives here. Services and tools never see SQL. See
  [sqlite-schema.md](./sqlite-schema.md).
- **`src/services/`** — business rules: `IngestionService` (poll every
  provider concurrently, isolating per-provider failures), `StoryService`
  (create/attach/update stories — owns the `lastMeaningfulUpdateAt` rule —
  plus `archiveStaleStories()`, which archives anything with no
  meaningful-update in 30+ days), `FeedService` (read-only feed view: hides
  stories stale 7+ days and ranks survivors by importance decayed toward
  zero since `lastMeaningfulUpdateAt`, resolves provider ids to display
  names via the registry).
- **`src/tools/`** — the MCP protocol layer. Thin: validate input via Zod,
  call one service/repository method, serialize `Date`s to ISO strings,
  return `structuredContent` + a short text summary. See
  [mcp-tools.md](./mcp-tools.md).
- **`src/composition.ts`** — composition root. `buildNewsroomServices()`
  opens the database, builds the provider registry, and constructs every
  service once; `registerNewsroomTools()` registers all 8 tools onto a
  transport-agnostic `ToolRegistrar`. `index.ts` (HTTP, the default) and
  `stdio.ts` (stdio) both just call these two functions against their own
  transport.

## Why the AI agent does the semantic work

Relevance judgment, clustering, meaningful-update detection, summarization,
and ranking all require reasoning about text — that's what the calling AI
agent is for. The MCP server's job is to give it exactly the tools it needs
to express those decisions (`create-story`, `attach-item-to-story` with a
`contribution`, `update-story`) and nothing lower-level (no `execute-sql`).
See [mcp-tools.md](./mcp-tools.md) for the full tool surface.

## Duplicate handling

Two different kinds of "duplicate" exist and are handled at different
layers:

- **Exact duplicate** — the same external item fetched again. Handled
  deterministically by the `(provider_id, external_id)` UNIQUE constraint in
  SQLite; the AI agent never sees this.
- **Semantic duplicate** — different articles about the same real-world
  event. These remain distinct `ContentItem`s; the AI agent clusters them
  into one `Story` via `attach-item-to-story`.
