# Story development markers in the feed

**Status:** shipped · **Branch:** `dev/story-development-markers`

## What it is and why

A curated story often collects four or five sources, and until now they all
looked alike in the feed. But the server already knows they aren't: every
attachment carries a `contribution` the curating agent chose deliberately —
`meaningful-update` (this report introduces a genuinely new development),
`supporting` (another outlet covering the same thing), or `background`
(context, not news). That judgment drives the whole freshness model, since
only a `meaningful-update` bumps `lastMeaningfulUpdateAt`.

`get-feed` threw it away. A reader could see "5 sources" but not whether the
story had actually moved four times or been re-reported four times — a real
difference in a fast-moving AI news cycle. This change carries the
distinction the rest of the system is already built on through to the
reader.

## What it was required to do

- Every source in `get-feed` reports the contribution recorded for it, using
  the same three values the attach tool accepts.
- Source order is unchanged: oldest-attached-first, so the sources read as
  the story's own chronology.
- No existing field changes name, type, or meaning; existing consumers of
  `get-feed` keep working untouched.
- The published `feed.json` snapshot carries the new field through the same
  serialization path, with no extra MCP round trip.
- The reader-facing UI distinguishes sources that reported a new development
  from those that only corroborate, in both hosts that share the feed UI
  (the MCP View and the static site).
- The already-published `feed.json` — written before this field existed —
  must keep rendering until the next `npm run publish-feed`.

Explicitly out of scope: any new tool, any schema migration, any change to
ranking, staleness, or the `lastMeaningfulUpdateAt` rule, and exposing the
agent's free-text `reason` for an attachment (it's an internal justification
written for the desk, not reader-facing copy).

## How it was implemented

No new tool, no new table, no migration — the data already existed in
`story_items` and was already returned by
`StoryRepository.findAttachedContent()`. The change is one field carried
across three layers.

### Server

- `src/domain/feed.ts` — `FeedSource` gains `contribution:
  StoryContribution`, reusing the story domain's own union rather than a
  parallel one.
- `src/services/feed-service.ts` — `toFeedStory()` maps the attached item's
  contribution onto the feed source. One line; no ranking, filtering, or
  ordering behavior changed.
- `src/tools/schemas.ts` — `feedSourceSchema` gains `contribution`, reusing
  the existing `storyContributionSchema` that `attach-item-to-story` and
  `get-active-stories` already share.
- `scripts/publish-feed.ts` needed no change: it spreads each source and
  only overrides the date fields, so the new field flows into `feed.json`
  automatically.

### Shared feed UI (`views/_shared/feed/`)

- `types.ts` — `FeedSource.contribution` is **optional here on purpose**,
  unlike the server type. The static site fetches whatever `feed.json` is
  currently committed on the `feed` branch, and that snapshot predates the
  field. Making it required would have broken the live site between merge
  and the next publish run.
- `formatters.ts` — two small pure helpers: `developmentCount(story)`
  (sources whose contribution is `meaningful-update`) and
  `contributionLabel(contribution)`, which names only the noteworthy roles
  and returns `undefined` for `supporting` and for a missing value, so old
  snapshots simply render unlabeled.
- `StoryCard.tsx` — shows an "N updates" badge when the count is non-zero.
  A story starts at zero, since `create-story` seeds its items as
  `supporting`, so the badge appearing means the story has genuinely moved
  since it was first published.
- `SourceSheet.tsx` — tags individual sources "New development" or
  "Background". `supporting` is the unremarkable majority and stays
  unlabeled, keeping the sheet quiet.
- `feed.css` — accent-tinted badge and tag styles that resolve per theme.

Both hosts pass tool output / `feed.json` straight through to `FeedApp`
without field-by-field mapping, so neither `views/get-feed/view.tsx` nor
`site/src/main.tsx` needed changes.

### Feed size

One short enum string per source: roughly 45 bytes pretty-printed, so about
9 KB at the 50-story publish limit. `feed.json` stays comfortably in the
tens-of-KB range the committed-snapshot design requires. Nothing unbounded
was added — no article bodies, no attachment history, no per-source
free text.

### Tests

79 tests passing:

- `test/unit/feed-service.test.ts` — a story whose sources span all three
  contributions comes back with each one intact, still oldest-attached-first.
- `test/unit/feed-formatters.test.ts` (new) — `developmentCount` and
  `contributionLabel`, including the pre-contribution-snapshot case where
  sources carry no contribution at all.
- `test/unit/feed-css.test.ts` — the badge and the new-development tag keep
  their accent styling; a plain tag stays muted.
- `test/mcp-server.test.ts` — over the real MCP transport, a story created
  from one item and extended by a `meaningful-update` attachment returns
  `["supporting", "meaningful-update"]`.

Verified on the committed tree: `npm run verify` (lint, 79 tests, typecheck),
`npm run build`, and `npm run build:site` all pass.

### Known gaps (recorded honestly)

- Nothing renders the *time* a development landed per source; the UI has the
  attachment order but not `attachedAt`, so "which report moved this story
  on Tuesday" isn't answerable from the feed alone. The story-level
  `lastMeaningfulUpdateAt` still covers the common case.
- The React components have no rendering tests — this repo has no component
  test setup, so the badge/tag logic is covered through the pure formatter
  helpers instead.
