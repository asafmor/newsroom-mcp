# get-story tool

**Status:** shipped · **Branch:** `dev/get-story-tool`

## What it is and why

A curating agent asked "what's the latest on the Anthropic pricing story"
had no way to fetch that one story directly. It had to re-scan
`get-active-stories` and reassemble the story's history from a
paginated list — a wasteful round trip for a question that names the story
already.

Three gaps made that re-scan lossy, not just wasteful:

1. `get-active-stories` caps attached-item history at the five most recent
   items (`attached.slice(-5)`) and collapses providers into a deduplicated
   `sourceNames` set. A story with more than five attachments loses history
   there — permanently, since nothing else showed the rest.
2. Every attachment carries a `reason` the curating agent wrote when it
   attached the item (`attach-item-to-story`, `mark-item-processed`), but no
   tool ever read it back. `attachedContentItemSummarySchema` and
   `feedSourceSchema` both omit it.
3. Archived stories — merge losers, or stories gone stale 30+ days — had no
   lookup-by-id path at all, even though `StoryRepository.findById` already
   supports them. `get-feed` is a ranked, paginated, staleness-filtered
   view, not a lookup path, and can simply fail to surface a story that
   still exists in the database.

`get-story` is a direct, single-story deep dive that closes all three.

## What it was required to do

- Take a `storyId` and return the full `Story` record, including `status`,
  so archived stories are reachable through this tool even though `get-feed`
  hides them.
- Return the story's complete attached-item history, not a capped recent
  window — every item, each with its `contribution`, `attachedAt`, and
  `reason` when one was recorded.
- Treat "story not found" as the only error case. An archived story is a
  normal, successful result with `status: "archived"` — not an error.
- Leave `get-active-stories` untouched: its five-item cap, its
  `sourceNames` collapsing, and its lack of `reason` were explicitly kept as
  is. Changing that tool's shape was out of scope for this feature.

## How it was implemented

Tenth MCP tool, following the same thin-adapter pattern as
`get-active-stories-tool.ts`: no new service method and no schema
migration, because `StoryRepository.findById` and `findAttachedContent`
already return everything the tool needs.

- `src/tools/get-story-tool.ts` (new) — validates `storyId` with
  `getStoryInputSchema`, calls `stories.findById`, throws (caught by
  `toolErrorResult`) if the story doesn't exist, then calls
  `stories.findAttachedContent` and maps each row into the output shape.
  `providerName` resolves through `ContentProviderRegistry`, falling back
  to the raw provider id if that provider has since been removed from
  config. `reason` is added only via a conditional spread
  (`...(item.reason !== undefined ? { reason: item.reason } : {})`), so it's
  omitted entirely when absent rather than serialized as `null` or `""`.
- `src/tools/schemas.ts` — `getStoryInputSchema` (`storyId: z.string().min(1)`)
  and `getStoryOutputSchema` (`storySchema.extend({ attachedItems: [...] })`).
  The item shape reuses `attachedContentItemSummarySchema` — the same one
  `get-active-stories` uses — extended with `attachedAt` and an optional
  `reason`, rather than declaring a parallel schema.
- `src/composition.ts` — wires the tool in; the "9 tools" comment became
  "10".
- `AGENTS.md`, `docs/mcp-tools.md` — tool count and tool list updated (the
  developer's own housekeeping, not part of this change's scope here).

### Decisions worth remembering

1. **Items come back oldest-attached-first, and the tool doesn't touch that
   order.** `findAttachedContent` already runs
   `ORDER BY si.attached_at ASC`; the tool passes it straight through
   instead of re-sorting or reversing it.
2. **No limit or pagination on `attachedItems`.** Returning the complete
   history — not a capped window — is the entire reason this tool exists,
   and is what distinguishes it from `get-active-stories`.
3. **Archived is a valid result, not an error.** A nonexistent id throws;
   an archived story does not. That distinction is the tool's contract, so
   a caller can rely on `status` in the response instead of the presence of
   an error to know a story is closed.
4. **`get-active-stories` was deliberately left alone.** It keeps its
   five-item cap and `sourceNames`, and does not gain `reason`. Bringing it
   in line with `get-story` is a possible follow-up, not part of this
   change.
5. **No effect on `feed.json` or the static site.** This tool is
   agent-internal; `scripts/publish-feed.ts` never calls it, so the
   feed-publishing pipeline is unaffected.

### Tests

103 tests passing:

- `test/mcp-server.test.ts` — protocol-level cases: an active story
  returning the full field set, a not-found error for an unknown id, an
  archived (merge-loser) story returning successfully, and a story with six
  attachments returning all six, oldest first.
- `test/unit/schemas.test.ts` — `getStoryInputSchema` accepts a non-empty
  id and rejects an empty or missing one.

Verified on the committed tree: `npm run verify` (lint, 103 tests,
typecheck) and `npm run build` both pass.
