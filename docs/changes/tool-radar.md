# Tool Radar

**Status:** shipped · **Branch:** `dev/tool-radar`

## What it is and why

The newsroom's providers are news-shaped. They surface what happened, and the
curating agent clusters that into stories. Nothing in the system surfaced
practical tooling — the libraries, frameworks, models and demos an AI
practitioner would want to try — as its own thing.

The obvious implementation was to ingest a tooling source as another provider
and let trending repos become stories. The user ruled that out up front, and
their reasoning shaped the whole design: tooling discovery is not news
consumption. You browse and compare tools rather than skim headlines. Tools
update on a different cadence than events. A tool stays relevant far longer
than a news story, so the feed's decay-and-hide lifecycle would be wrong for
it. And a reader wants to bookmark a tool and come back to it, which no story
card supports.

So Tool Radar is a separate surface with its own model, its own publish
cadence, and its own UI, sharing the site shell but nothing of the
Story/Feed pipeline.

## What it was required to do

- Surface trending AI tools, libraries, frameworks, models and demos as a
  browsable board, never interleaved into the story feed.
- Draw only from sources reliable enough to schedule against. The user
  explicitly warned off fragile scraping: a weekly unattended job cannot
  depend on someone's HTML layout.
- Degrade per source. One endpoint failing must not empty the board or fail
  the run; a total outage must say so plainly.
- Let a reader filter by kind, bookmark tools for later, and copy an install
  command without leaving the page.
- Fit the existing static-site constraint — a committed JSON snapshot plus a
  client-side build — and the existing periodic-work pattern (a scheduled
  GitHub Action), without new infrastructure.

## Source selection

Two sources ship:

- **GitHub Search API** — `/search/repositories`, one query per curated AI
  topic (`llm`, `generative-ai`, `ai-agents`, `machine-learning`), each
  filtered to a recent `created:` window and sorted by stars. Official,
  documented, versioned.
- **Hugging Face** `/api/models` and `/api/spaces` — the official trending
  endpoints, sorted by `trendingScore`.

Several candidates were evaluated and rejected, and the rejections are worth
recording because they are the kind of source someone will propose again:
GitHub Trending (no API at all — an HTML scrape), Product Hunt, npms.io,
awesome-lists, and pypistats. Each is either unofficial, scraped, or
otherwise too fragile to put behind an unattended weekly cron.

## How it was implemented

### Shape: the podcast Phase-2 precedent, taken literally

Tool Radar has no MCP tool, no SQLite table, no repository, and no service.
`src/composition.ts` never imports it. It is mechanical work with no AI
reasoning in it, so it follows the line `docs/architecture.md` already draws
and lives entirely outside the MCP server process — the same place the
podcast synthesis pipeline lives.

- `src/tool-radar/fetch.ts` — the HTTP seam. Native `fetch()` with a 15s
  `AbortSignal.timeout` per request, exactly as `RssContentProvider` does.
  Every endpoint is independently try/caught, and the module never throws to
  its caller: it returns a `RawSourceResult` that is either `ok` with items
  or `error` with a message. GitHub's four topic queries run under
  `Promise.allSettled`, so one topic failing costs three others nothing; the
  source reports `error` only if all four failed, and a partial failure is
  logged for the operator without dropping any items or changing the
  published status.
- `src/tool-radar/transform.ts` — the pure part. Raw JSON in, ranked and
  capped `ToolEntry[]` plus per-source status out. No network, no
  filesystem, no git, so it is unit-testable the way the podcast's
  chunk-packing is testable apart from its TTS seam.
- `scripts/publish-tool-radar.ts` (`npm run publish-tool-radar`) — wires the
  two together and publishes `tools.json`.
- `.github/workflows/publish-tool-radar.yml` — Monday 08:00 UTC cron plus
  `workflow_dispatch`. Monday deliberately, so the two scheduled `feed`-branch
  writers do not habitually collide with the Friday podcast job.

### Stateless by necessity — and why there are no trend arrows

This is the single most important thing for a future reader to understand.

An early analysis proposed week-over-week deltas and trend arrows: this repo
gained 400 stars since last week, that model is climbing. It had to be
killed, because the foundation cannot carry it. `data/` and `*.db` are
gitignored. `scripts/publish-feed.ts` runs locally, not in CI. No scheduled
Action opens SQLite at all. A scheduled GitHub Action therefore has no
server-side history to compare against — every run starts from nothing.

So `buildToolRadarSnapshot()` is deterministic from one run's data only. No
stored history, no deltas, no velocity, no trend arrows. `recencyLabel()`
("last pushed 3 days ago") and the section-level `generatedAt` stand in for a
momentum number, and no such number ever reaches the UI.

Anyone proposing deltas later needs to start by changing that foundation —
giving the scheduled job somewhere to keep history — not by adding a field.

### Ranking, caps, and one ordering bug worth remembering

Per-source caps (24 GitHub, 18 HF models, 18 HF Spaces) keep one healthy
source from crowding out a struggling sibling. Entries are de-duplicated by
id, preserving first occurrence, which matters because the four GitHub topic
queries legitimately return the same repo more than once.

The two sources are ordered differently, on purpose:

- **Hugging Face** preserves the API's own `sort=trendingScore` response
  order verbatim. There is no local re-scoring, and `trendingScore` itself is
  never read into a `ToolEntry` — it drives fetch-time order only and never
  appears in published output.
- **GitHub** is explicitly re-sorted by `stargazers_count` descending
  *before* the cap is applied. Each topic query is already asked to sort by
  stars, but merging and de-duplicating four such lists does not preserve
  that order. The first implementation capped before sorting, so the cap
  boundary silently discarded the highest-starred repos in the merged set —
  caught in review, and the reason `normalizeSource()`'s `sortBy` parameter
  documents that it runs before the slice.

Normalization is defensive throughout: an item missing owner, name, url, or a
parseable `createdAt` is dropped rather than published with a placeholder,
and no field is ever fabricated. HF models genuinely have no description
field, so `description` is simply omitted for models rather than filled with
an invented one — the UI explains that absence once instead of printing 18
identical "No description available" lines.

The published artifact is about 34 KB, which matters because it is committed
straight into git rather than served from a store.

### Publishing

`tools.json` lands on the `feed` branch beside `feed.json` and
`podcast.json`, using the same disposable-worktree pattern as the other
publishers. That pattern was generalized for this feature:
`scripts/lib/podcast-worktree-publish.ts` became
`scripts/lib/worktree-publish.ts` with a `publishJsonFile(filename, ...)`
entry point, and `publishPodcastJson()` is now a thin filename-fixed wrapper
so the two existing podcast publishers were untouched. All three writers
share one push-retry loop, which re-fetches, recomputes against the latest
`origin/feed`, and retries a non-fast-forward rejection up to three times.

Unlike `podcast.json`, `tools.json` is a full overwrite, not a merge: there
is no per-item state to preserve across runs, since every entry is recomputed
from scratch. The publish happens unconditionally, even when every source
failed, so `generatedAt` always reflects the last run — but a total outage
sets a non-zero exit code so CI reports it rather than a false green. Partial
degradation stays exit 0.

Two supporting changes make that safe: `.github/workflows/deploy-feed-site.yml`
had a cleanup step that deletes everything on the `feed` branch except a
listed set, so `tools.json` was added to that exclusion list (the same trap
`podcast.json` fell into once already), and `npm run dev:site` now mirrors
`tools.json` locally.

`GITHUB_TOKEN` and `HF_TOKEN` are read directly from `process.env`,
script/CI-only, and are never part of `src/config.ts`/`NewsroomConfig` — the
MCP server has no use for them. Both are optional: every request works
unauthenticated at a lower rate limit, and `npm run verify` never needs
either. Error messages are bounded to 200 characters and built only from HTTP
status text or the runtime's own network error, so a token cannot leak into
`tools.json` or a log line.

### The reader surface

`views/_shared/tools/` holds a card board of its own — not a reskinned story
card — mounted only by `site/src/main.tsx`. No MCP View binds to it, the same
position the podcast UI was in when it shipped. A missing `tools.json` (404,
before the first publish) is treated as a normal empty state, not an error.

- **Kind filter chips** follow the repo's existing `role="group"` /
  `aria-pressed` `sort-tabs` pattern rather than the `<select>` FeedHeader
  uses, and only render when more than one kind is present.
- **Copy-to-clipboard install commands** appear only where an install command
  is meaningful — HF models get `huggingface-cli download <id>`; a Space is
  used in the browser, so it has none. A denied clipboard write fails
  silently, since the command text stays selectable either way.
- Freshness reuses the feed's `freshness()` helper, which grew an overridable
  staleness threshold: 10 days for a weekly cadence, against the feed's 6
  hours.
- Per-source failure surfaces as a banner naming the sources that did not
  respond, and a full outage gets its own message distinct from "sources fine,
  nothing found".

**Bookmarks** carry most of the design decisions worth reading:

- They store **full `ToolEntry` snapshots, not bare ids**. A weekly snapshot
  turns over completely; if bookmarks were ids resolved against the current
  snapshot, saving a tool would mean watching it silently disappear a week
  later. A stored entry stays fully renderable after it leaves the snapshot,
  marked "No longer trending" so eras never mix silently.
- **An empty current snapshot is treated as no evidence.** If every source
  failed, `bookmarkedEntries()` does not brand every saved tool as no longer
  trending — the guard lives in the helper, not the call site, so a future
  caller inherits it.
- **Persistence is synchronous inside the click handler**: persist first,
  commit to state only on success. A denied write can therefore never render
  as a filled star. The state committed is what actually persisted, not what
  was requested, because the one-eviction retry may drop the oldest bookmark
  to make room.
- `localStorage` handling follows FeedApp's existing tri-state discipline —
  `undefined` means storage is inaccessible (a sandboxed MCP View host), so
  the whole bookmarking feature is suppressed rather than rendering a "0
  bookmarked" lie; empty means first visit; populated is normal. Tool Radar
  adds a fourth state, readable-but-not-writable, surfaced as a dismissible
  notice pinned to the viewport. Dismissible because storage denial is a
  standing condition, not a transient one, and an undismissable notice under a
  permanent denial never goes away.
- Turnover never prunes a bookmark. Only an explicit unbookmark removes one.

### A pre-existing bug fixed along the way

Adding a "Tool Radar" entry point next to the existing "Weekly digest"
shortcut meant wrapping both in a row — and that exposed a silent regression.
The shortcut carried `position: sticky` on the bar itself, but a sticky
element can only travel within its own containing block, and the new row is
exactly as tall as the bars inside it. Sticky on the children gave them zero
travel, so both shortcuts scrolled away with the feed. Sticky moved to
`.entry-bar-row`, which is the element with room to move. The test that was
supposed to guard this had been passing vacuously; it now pins the element
that actually carries the positioning.

## Verification

`npm run verify` passes: 437 tests, lint clean, no type errors. `npm run
build` and `npm run build:site` are both green. Four new test files cover the
fetch seam's failure isolation, the transform's normalization and ordering,
the UI formatters (including bookmark parse/persist/eviction), and the
rendered UI.

Note the testing convention, so nobody "fixes" it later: **this repo has no
DOM or React test harness.** UI tests assert against component source text
read with `readFileSync`. That is deliberate and documented in
`docs/testing.md` — a UI test here checks that the source says what it should,
not that a rendered tree behaves.

## Honest limitations

- **No history, no deltas, no trend arrows** — see the stateless section
  above. This is a foundation constraint, not an oversight.
- One extreme-length model name still clamps at the 2-line limit with only a
  pointer-only `title` tooltip, so a touch reader cannot reveal it. Deferred
  as P3: it affected 1 entry out of 60, and the full identifier is available
  in that card's install command.
- The `topics` field's bookmark sanitizer and the publish-side transform
  disagree slightly on whether an empty array is preserved or omitted.
  Harmless today, since the UI renders an empty topic list as nothing either
  way.
- The final independent UI/UX confirmation round could not run: the external
  review tool hit a usage limit. The two fixes it would have re-measured — the
  dismissible save-denial notice, and wrapping the kind-chip strip instead of
  scrolling it — were verified at source level by the code reviewer instead.
- GitHub disables `schedule:`-triggered workflows after 60 days with no
  commits to the default branch, silently. Tool Radar inherits that from the
  podcast workflow; `workflow_dispatch` is the manual recovery path.

## Operator notes

- The weekly Action needs nothing configured to work. `GITHUB_TOKEN` is
  supplied automatically; `HF_TOKEN` is an optional repository secret that
  only raises rate limits.
- `npm run publish-tool-radar` runs the same pipeline locally, publishing to
  the real `feed` branch. It reuses whatever `origin` credentials the checkout
  already has.
- A run that logs "all three sources failed" still published `tools.json`
  with `entries: []`; the site falls back to the reader's bookmarks in that
  case rather than showing an empty page.
