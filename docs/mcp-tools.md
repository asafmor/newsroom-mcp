# MCP Tools

Twelve tools: the eight from `IDEA.md` §41–48, `merge-stories`, `get-story`,
and the two Phase-1 podcast-digest tools (`get-podcast-status`,
`submit-podcast-episode`) described below. Each is a thin adapter: validate
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
| `get-story` | Fetch one story by id (active or archived) with its complete attached-item history, oldest-attached-first, no truncation — the only tool that exposes each attachment's `reason`. Errors if the id doesn't exist. | `StoryRepository.findById()` + `findAttachedContent()` |
| `create-story` | Create a story from one or more content items that don't belong to an existing one. | `StoryService.createStory()` |
| `attach-item-to-story` | Attach an item to an existing story with a `contribution` (`supporting` / `meaningful-update` / `background`). | `StoryService.attachItem()` |
| `update-story` | Update the AI-maintained summary/scores after new information arrives. | `StoryService.updateStory()` |
| `merge-stories` | Combine two active stories that turned out to be the same real-world event: reassign every content item from the losing story onto the surviving story, reconcile the surviving story's timestamps, and archive the losing story. Never touches `title`/`summary`/scores. | `StoryService.mergeStories()` |
| `mark-item-processed` | Finalize an item that shouldn't be linked to any story (`ignored`), or `linked` without a story tool call. Prevents reconsideration on the next poll. | `ContentItemRepository.markIgnored()` / `markLinked()` |
| `get-feed` | Retrieve the curated feed as stories (never raw content items). Excludes stories with no `meaningful-update` in the last 7 days; survivors are ranked by `importanceScore` decayed toward zero with a 3-day half-life since `lastMeaningfulUpdateAt`, so a stale-but-important story fades instead of camping at #1. Each story's `sources[]` are oldest-attached-first, and each source carries the `contribution` the curating agent recorded for it, so a reader can tell which reports introduced a new development from those that only corroborate or add context. Paginated via `limit`/`offset`, applied in-process after the full ranking is computed (the decay score is time-varying, so pagination is a slice of one ranking pass rather than a SQL `LIMIT`/`OFFSET`); response includes `totalCount`/`hasMore`. Bound to the `views/get-feed/` MCP App, which renders `structuredContent` as story cards for hosts that support MCP Apps UI. | `FeedService.getFeed()` |
| `get-podcast-status` (read-only) | Report the weekly podcast digest's status: the current ISO week identifier, whether an episode already exists for it, whether one is `due` (advisory only — see below), and metadata-only summaries (id, ISO week, title, audio state, submitted-at — never the transcript) of the most recent episodes, newest first, bounded by `limit` (default 5, max 20). Call once per curation run, alongside the `get-feed` confirmation step. | `PodcastService.getStatus()` |
| `submit-podcast-episode` (write) | Submit one episode's script — `title`, an ordered `segments[]` array, an optional `voice` (default `alloy`), an optional `instructions` tone string (default: "warm, clear, moderate pace, professional newsroom narrator") — for the CURRENT ISO week. On success, persists the episode with audio state `pending` and returns its full metadata + script. On a duplicate-week conflict, returns a clear error naming the existing episode's id/ISO week rather than a raw storage error. | `PodcastService.submitEpisode()` |

## The one business rule the tools enforce for you

`attach-item-to-story`'s `contribution` field is the whole point of the
tool split: the AI agent expresses *intent* (does this item report the same
thing, or does it introduce something new?), and `StoryRepository.attachItem`
enforces the *consequence* — only `meaningful-update` bumps
`lastMeaningfulUpdateAt`, which drives story freshness. Getting this wrong
either stalls a genuinely developing story or makes a stale one look fresh.

## `merge-stories`' timestamp and collision rules

`merge-stories` takes a `survivingStoryId` and a `losingStoryId`. Both must
exist and be `active` (checking `status === 'active'` is unique to this
tool's path — `attach-item-to-story`/`update-story` deliberately don't check
it), and they must be different stories. On success:

- The surviving story's `firstSeenAt` becomes the **earlier** of the two
  pre-merge values, `lastItemAttachedAt` the **later**, and
  `lastMeaningfulUpdateAt` the **later of the two pre-merge values** — never
  the time the merge ran. Bumping it to "now" would let a story that's
  actually gone stale jump back onto `get-feed`.
- If the same content item is attached to both stories, exactly one
  association survives: whichever has the stronger `contribution`
  (`meaningful-update` > `supporting` > `background`), along with that
  association's `reason`/`attachedAt`. A tie keeps the surviving story's own
  pre-existing association unchanged.
- The losing story is archived as part of the same transaction; it's absent
  from `get-active-stories`/`get-feed` afterward. Merging is all-or-nothing —
  a concurrent reader never observes a half-merged state.
- `title`, `summary`, `relevanceScore`, and `importanceScore` are untouched;
  use `update-story` for those.

## The `summary` structure nudge

`create-story` and `update-story` both evaluate one shared, non-semantic
predicate (`src/tools/summary-structure.ts`) against exactly the `summary`
text submitted in that call: is it longer than 280 characters and lacking
valid lede+bullets structure (a real line break, a lede line, and every
remaining line starting with `- `)? "Valid structure" is defined identically
to `views/_shared/feed/formatters.ts`'s `parseSummary` — the function this
predicate reuses — so the predicate and the reader-facing renderer can never
disagree. When true, the call still succeeds exactly as before (the stored
summary and `structuredContent` are unaffected) and only the free-text
confirmation message gains a short additional sentence suggesting a
restructure. `update-story` evaluates this only when the call actually
supplies a `summary`; omitting it never triggers the advisory, regardless of
how long the story's already-stored summary is. No other tool carries this
nudge (`attach-item-to-story` has no `summary` input). `npm run
measure-summary-adoption -- <feed.json>` reports how often summaries in a
published snapshot actually use the structure — a manual, read-only
measurement, not a gate.

## The weekly podcast digest (`get-podcast-status` / `submit-podcast-episode`)

A weekly, AI-narrated audio companion to the feed, in two phases:

- **Phase 1 (semantic, in-process, these two MCP tools)** — the curating
  agent authors a 5-10 minute spoken-style script for the current ISO week
  and submits it. `src/shared/iso-week.ts` computes the ISO-8601 week
  identifier (`<ISO year>-W<zero-padded week>`, Monday-start, week 1
  contains that year's first Thursday) from an explicitly injected
  reference time — it never reads the wall clock itself, so it's
  deterministic under test. "Due" is true iff no episode exists yet for the
  current ISO week AND the reference time is at/after 08:00:00 UTC on that
  week's Friday; it's **advisory only** — `submit-podcast-episode` accepts a
  submission at any time. The only hard-enforced rule at submission time is
  the one-episode-per-ISO-week `UNIQUE (iso_week)` constraint (see
  [sqlite-schema.md](./sqlite-schema.md)) — a second submission for a week
  that already has one fails at the storage layer and surfaces as a clear
  `PodcastWeekConflictError`, never a crash or duplicate row. An episode's
  script (title/segments/voice/instructions) is **immutable** once
  submitted — there is no edit/delete tool.
- **Phase 2 (mechanical, GitHub Actions, no AI reasoning)** — a scheduled
  workflow (`.github/workflows/synthesize-podcast.yml`) turns any episode
  `podcast.json` reports as `pending` or `failed` into real synthesized
  speech via the OpenAI TTS API, concatenates the result with `ffmpeg`
  (re-encoded — mono, 64kbps — never `-c copy`/naive byte concatenation),
  probes the final duration with `ffprobe`, and commits the MP3 onto the
  `feed` branch at `audio/<episode-id>.mp3` in the SAME commit as the
  `podcast.json` update (`audio.url` is that relative path). The mp3 is
  **not** uploaded as a GitHub Release asset: Release assets are served as
  `application/octet-stream` with `Content-Disposition: attachment` and no
  CORS headers, which iOS Safari refuses to play inline — serving the file
  same-origin off GitHub Pages alongside the rest of the static site avoids
  that entirely. This never touches the database — only the published
  `podcast.json`/`audio/` snapshot on `feed`. See `src/podcast/` for the
  chunking/synthesis/ffmpeg logic (each external call — HTTP,
  `ffmpeg`/`ffprobe` — sits behind an injectable seam so the default test
  suite never makes a real call) and `scripts/synthesize-podcast.ts`, which
  is the exact same script the workflow and a local run both call.

Segment/length validation (`submitPodcastEpisodeInputSchema`, Zod): each
segment must be non-empty after trimming and at most 1,500 characters —
comfortably under the TTS API's hard 4,096-character per-request limit, so
`src/podcast/chunking.ts`'s greedy whole-segment packing can never itself
exceed that limit. At least 1, at most 60 segments. Total script length
(sum of segment lengths) must fall between 4,500 and 9,000 characters
(~150 wpm x 5-10 minutes x ~6 chars/word) — a submission outside this range
is rejected with the computed total and the allowed range.

Publishing (`npm run publish-podcast`, `scripts/publish-podcast.ts`):
mirrors `publish-feed`'s pattern (direct in-process call, no MCP round
trip, disposable git worktree) but is **merge-only**: it adds any database
episode not already present in `podcast.json` (by id) as `pending`, and
leaves every already-published episode's audio state/metadata untouched —
`podcast.json` is the source of truth for audio state once Phase 2 has run,
the database is the source of truth for script content. Episodes are
sorted newest-ISO-week-first and trimmed to the most recent 26 in the
published file only (never the database or git history); `audio/*.mp3`
files for any episode that falls out of that window get pruned from the
worktree in the same commit. `scripts/synthesize-podcast.ts` writes back
with the same merge-only discipline in reverse, rewriting only the
episode(s) it just processed and staging its mp3 alongside the
`podcast.json` update via `git add -A`, so `podcast.json` is never pushed
pointing at an mp3 that hasn't landed in the same commit. Both writers
retry a rejected push up to 3 total attempts, re-fetching/resetting against
the latest `origin/feed` between attempts, so they and `publish-feed`/the
site-deploy workflow never assume sole ownership of the `feed` branch. Run
`npm run synthesize-podcast` to run Phase 2 locally (reads
`OPENAI_API_KEY` from `process.env` — see `.env.example`; git push auth
reuses whatever credentials are already configured for `origin`).

## No low-level tools

There is no `execute-sql`, `update-row`, or `insert-json` tool. The agent
should never need database primitives — see
[architecture.md](./architecture.md#why-the-ai-agent-does-the-semantic-work).
