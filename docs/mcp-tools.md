# MCP Tools

Eight tools, matching `IDEA.md` §41–48. Each is a thin adapter: validate
input with Zod, call one service/repository method, serialize `Date`s to
ISO strings, return `structuredContent` (matching the tool's `outputSchema`)
plus a short human-readable text summary. Errors are caught and returned as
a standardized `isError: true` result (`src/tools/tool-errors.ts`) rather
than thrown across the MCP boundary.

| Tool | Purpose | Backed by |
|---|---|---|
| `fetch-new-items` | Poll every configured provider and store new items, then archive stories with no `meaningful-update` in 30+ days. No semantic decisions. | `IngestionService.fetchNewItems()` + `StoryService.archiveStaleStories()` |
| `get-unprocessed-items` | Return `pending` items, oldest first, for the AI agent to triage. Excludes items with `published_at` more than 1 week old. | `ContentItemRepository.findPending()` |
| `get-active-stories` | Return active stories as clustering candidates, each enriched with recent attached items and source names. Ordered by `importanceScore` desc, then `lastMeaningfulUpdateAt` desc. Paginated via `limit`/`offset` (SQL-level, since the sort order is stable); response includes `totalCount`/`hasMore`. | `StoryRepository.findActive()` + `countActive()` + `findAttachedContent()` |
| `create-story` | Create a story from one or more content items that don't belong to an existing one. | `StoryService.createStory()` |
| `attach-item-to-story` | Attach an item to an existing story with a `contribution` (`supporting` / `meaningful-update` / `background`). | `StoryService.attachItem()` |
| `update-story` | Update the AI-maintained summary/scores after new information arrives. | `StoryService.updateStory()` |
| `mark-item-processed` | Finalize an item that shouldn't be linked to any story (`ignored`), or `linked` without a story tool call. Prevents reconsideration on the next poll. | `ContentItemRepository.markIgnored()` / `markLinked()` |
| `get-feed` | Retrieve the curated feed as stories (never raw content items). Excludes stories with no `meaningful-update` in the last 7 days; survivors are ranked by `importanceScore` decayed toward zero with a 3-day half-life since `lastMeaningfulUpdateAt`, so a stale-but-important story fades instead of camping at #1. Each story's `sources[]` are oldest-attached-first. Paginated via `limit`/`offset`, applied in-process after the full ranking is computed (the decay score is time-varying, so pagination is a slice of one ranking pass rather than a SQL `LIMIT`/`OFFSET`); response includes `totalCount`/`hasMore`. | `FeedService.getFeed()` |

## The one business rule the tools enforce for you

`attach-item-to-story`'s `contribution` field is the whole point of the
tool split: the AI agent expresses *intent* (does this item report the same
thing, or does it introduce something new?), and `StoryRepository.attachItem`
enforces the *consequence* — only `meaningful-update` bumps
`lastMeaningfulUpdateAt`, which drives story freshness. Getting this wrong
either stalls a genuinely developing story or makes a stale one look fresh.

## No low-level tools

There is no `execute-sql`, `update-row`, or `insert-json` tool. The agent
should never need database primitives — see
[architecture.md](./architecture.md#why-the-ai-agent-does-the-semantic-work).
