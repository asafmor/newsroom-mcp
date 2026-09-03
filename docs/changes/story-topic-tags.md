# Agent-assigned story topic tags

**Status:** shipped · **Branch:** `dev/story-topic-tags`

## What it is and why

The curating agent already decides what a story is about; the feed never
asked it to say so. This change lets the agent attach topic tags to a story
— `model-release`, `research`, `regulation`, `funding`, `product-launch`,
`safety`, `infrastructure`, `enterprise-adoption`, `open-source`, `opinion`
— through `create-story` and `update-story`, and surfaces them everywhere a
reader sees the feed. A reader can now narrow the feed to, say, just
`regulation` stories, the same way they already filter by provider.

The vocabulary is fixed and closed: no free text, no catch-all "other". A
story that fits none of the ten values gets no tags at all. A wrong tag is
worse than a missing one, because tags drive a reader-facing filter — an
agent guessing at a tag would mislead readers who trust the filter.

## What it was required to do

- `create-story` and `update-story` accept an optional `tags` field drawn
  only from the fixed ten-value vocabulary, at most three tags, no
  duplicates. Out-of-vocabulary values, more than three tags, or duplicates
  are rejected outright — never silently truncated or deduplicated.
- Omitting `tags` on create leaves the story untagged (`[]`); omitting it on
  update preserves whatever tags the story already has; passing `[]` on
  update clears them. `tags` is one field with replace semantics, not an
  add/remove API.
- `merge-stories` does not touch tags: the surviving story keeps exactly its
  own pre-merge tags, and the losing story's tags are dropped.
- `tags` appears on `get-active-stories`, `get-feed`, and the published
  `feed.json`, using the same values throughout.
- The shared feed UI (the MCP View and the static site) lets a reader filter
  by tag, the same way the existing provider filter works.
- The already-published, tags-less `feed.json` must keep rendering until the
  next `npm run publish-feed`.
- No new dependency, no new tool, negligible growth in `feed.json` size.

## How it was implemented

### Server

- `src/domain/story.ts` — new `StoryTag` union (the ten fixed values).
  `Story.tags: StoryTag[]` is never `null`/`undefined`; an untagged story is
  `[]`. `CreateStoryInput.tags?` and `UpdateStoryInput.tags?` carry the
  create/preserve/replace/clear semantics above.
- `src/domain/feed.ts` — `FeedStory.tags: StoryTag[]`, same non-nullable
  contract.
- `src/sqlite/migrations/002_story_tags.sql` — `ALTER TABLE stories ADD
  COLUMN tags_json TEXT`, nullable, storing a JSON array — the same pattern
  already used for `content_items.authors_json`. Every pre-existing row
  reads back as `NULL`.
- `src/sqlite/sqlite-story-repository.ts` — `create()` writes `tags_json`
  and includes `tags` in its return object; `update()`'s dynamic `SET`
  builder only touches `tags_json` when `patch.tags !== undefined`, which is
  what makes "omit to preserve" work; `toDomain()` turns a `NULL` column
  into `[]`. `mergeStories()` was deliberately left untouched — it never
  reads or writes `tags_json`, so the survivor keeps its own tags and the
  loser's are simply dropped along with the rest of its row.
- `src/tools/schemas.ts` — `storyTagSchema` (a Zod enum of the ten values)
  and `storyTagsSchema` (`.max(3)`, a `.refine()` rejecting duplicates, and
  a `.describe()` that spells out the vocabulary and replace semantics for
  the calling agent). Wired into `storySchema`, `feedStorySchema`, and the
  `create-story`/`update-story` input schemas.
- `src/tools/update-story-tool.ts` — tool description updated to mention
  topic tags and that `tags` replaces the whole set.
- `docs/agent-system-prompt.md` — `create-story` and `update-story`
  signatures now show `tags?`, with the vocabulary and the omit/replace/clear
  rules spelled out. Without this, the field would exist but the agent would
  never populate it.
- `get-feed-tool.ts`, `get-active-stories-tool.ts`, `serialize.ts`, and
  `scripts/publish-feed.ts` needed no changes — they all spread `...story`,
  so `tags` flows through to output and to `feed.json` automatically.

### Shared feed UI (`views/_shared/feed/`)

- `types.ts` — mirrors the `StoryTag` union, but `FeedStory.tags` is
  **optional here on purpose**, unlike the server type. The static site
  fetches whatever `feed.json` is currently published, and that snapshot
  predates this field.
- `formatters.ts` — `storyTags()` (defaults to `[]`), `availableTags()`
  (the sorted set of tags actually present across loaded stories), and
  `storyMatchesFilters()`, extended to AND the tag filter together with the
  existing provider and search filters.
- `FeedHeader.tsx` — a single-select tag dropdown next to the provider
  filter, with an "All tags" default. It's hidden entirely when no loaded
  story carries a tag, so a pre-tags `feed.json` snapshot doesn't show a
  dead control.
- `FeedApp.tsx` — new `tagFilter` state; the existing empty-results state is
  reused when a tag filter matches nothing.
- `feed.css` — `.tag-select` shares the `.provider-select` rule rather than
  duplicating it.

### Feed size

One short enum string per story, at most three of them: worst case roughly
4 KB added at the 50-story publish limit. `feed.json` stays well within the
tens-of-KB range the committed-snapshot design assumes.

### Tests

100 tests passing, including:

- `test/unit/schemas.test.ts` (new) — the vocabulary, the three-tag limit,
  and duplicate rejection.
- `test/unit/sqlite-story-repository.test.ts` — create with and without
  tags, update replace/preserve/clear, and a `NULL` column read back as `[]`
  to simulate a pre-migration row.
- `test/unit/feed-service.test.ts` and `test/unit/feed-formatters.test.ts` —
  tags carried through to `get-feed` and through the UI helpers.
- `test/mcp-server.test.ts` — over the real MCP transport: an out-of-
  vocabulary tag is rejected, tags survive a tag-less update, and a merge
  keeps only the survivor's tags.

Verified on the committed tree: `npm run verify` (lint, 100 tests,
typecheck), `npm run build`, and `npm run build:site` all pass.

### Known gaps (recorded honestly)

- Tags are filterable but not yet *displayed* on the story card or source
  sheet — a reader can filter to `regulation` without seeing which tag a
  given story carries. Deliberately deferred.
- The tag filter is single-select; a reader can't combine two tags.
- Existing stories stay untagged until a future curation run revisits them
  via `update-story` — there is no backfill.
- The dropdown only appears once a published `feed.json` actually contains
  tagged stories.
