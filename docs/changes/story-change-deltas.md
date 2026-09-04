# Per-story change deltas in the feed

**Status:** shipped · **Branch:** `dev/story-change-deltas`

## What it is and why

The read-state feature already told a reader which cards they'd opened
before, but every returning card still looked exactly as it had on the first
visit. A story that had picked up three new sources since yesterday was
visually identical to one that had sat unchanged for a day — the reader had
to re-read a story to find out whether re-reading was worth it.

This came out of a research pass on news-reader UI patterns (Google Living
Stories, Microsoft Research's NewsJunkie) that flagged "what changed since
you last looked" as the highest-value pattern for a static feed reader. This
change adds it entirely client-side: each device caches a small snapshot of
every story it has loaded, diffs the next load against that snapshot, and
surfaces the real difference — new sources, new developments, or a plain
"Updated" — instead of a static, unchanging card.

## What it was required to do

- Cache a minimal per-story snapshot in `localStorage` on every feed load —
  unique source URLs, development count, tags, and summary bullets — nothing
  that isn't diffed against later.
- On the next load, diff each story against its own cached snapshot and
  turn the result into real, specific text: never a fabricated "+0", and no
  badge at all when nothing tracked changed.
- Show the delta only on a card the reader has already opened. An unread
  card never shows a delta badge, even if one exists.
- In the detail sheet, tag the specific things that changed inline: a "New
  source" tag on source rows absent from the cached snapshot, and a "New"
  tag on summary bullets absent from it.
- Once a card shows a delta badge, stop double-counting: the existing
  cumulative "N updates" badge and the new delta badge must never both
  render in the same slot.
- Degrade silently if storage is unavailable, holds malformed JSON, or has
  never been written — same discipline as the existing read-state feature,
  never a crash and never a lying "0 changes".
- No server, schema, MCP tool, or `feed.json` change — the deployed site is
  a static snapshot of one committed `feed.json`, so "what YOU last saw" can
  only live on the device.

## How it was implemented

Entirely inside `views/_shared/feed/`, the code shared by both feed hosts
(the MCP `get-feed` View and the standalone static site), so it reaches both
with no per-host changes.

- **`formatters.ts`** — `StorySnapshot` (the cached shape),
  `toStorySnapshot(story)` (captures it), and `computeStoryDelta(prior,
  story)`, a pure function that returns `undefined` for a story with no
  cached snapshot (first-ever visit) or a `StoryDelta` carrying the new
  source URLs, the new bullets, and a `badgeText` string built from real
  counts (`"+2 sources, 1 new development"`) or `"Updated"` for a tag-only
  change, `undefined` when nothing badge-worthy changed. Unit-tested in
  `test/unit/feed-formatters.test.ts`.
- **`FeedApp.tsx`** — a `newsroom-story-snapshots` `localStorage` key,
  `getInitialSnapshots()` (mirrors the existing `getInitialReadIds`
  tri-state pattern), and two effects keyed on `generatedAt` (unique per
  `get-feed` call, so this is the true "one load" boundary rather than
  the `stories` array reference): a `useMemo` that computes each story's
  delta against the snapshot cache *as it stood before this load*, and a
  `useEffect` that overwrites the cache afterwards, pruning entries for
  stories no longer in the feed by reusing the existing `pruneReadIds`
  helper rather than a parallel Map-pruning function.
- **`StoryCard.tsx`** — a `delta` prop. On a read card with a non-empty
  delta, `.delta-badge` replaces the cumulative `.development-badge` in the
  same slot (never both). The cumulative badge itself gets an
  `.is-historical` class on a read card, dropping the pill fill so it reads
  as plain metadata and the accent treatment means one thing only:
  something changed since your last visit.
- **`SourceSheet.tsx`** — the same `delta` prop, used to tag source rows
  ("New source") and summary bullets ("New") absent from the cached
  snapshot. No `isRead` gate here, unlike the card: opening the sheet at all
  is the read event, since `openStory` marks the story read in the same
  update that opens it.
- **`feed.css`** — `.delta-badge` shares one rule with `.development-badge`
  (same pill, same accent), plus `.development-badge.is-historical`, which
  drops the pill background entirely rather than tinting it a faint grey so
  it inherits `.story-meta-row`'s own `--muted`-on-surface pair (4.76:1
  light, 5.11:1 dark) instead of landing on a mid-tone chip that missed
  WCAG AA for 10px text.
- **`test/unit/feed-css.test.ts`** — regex guards on the new rules.

### Notable decisions

- **Tri-state storage, mirroring `getInitialReadIds`.** `undefined` means
  `localStorage` itself is inaccessible (the sandboxed MCP View host can
  throw on access), and the whole feature goes silent — no badges, no
  sheet flags, no write attempts. That's distinct from an empty/absent
  cache, which is a normal first visit and seeds without showing anything.
- **Read-before-write, keyed on `generatedAt`.** The delta `useMemo` and the
  cache-overwrite `useEffect` both key on `generatedAt` rather than the
  `stories` array. An earlier draft keyed on `stories` and happened to work
  only because `mcp-use` preserves object identity across unrelated
  re-renders — an undocumented invariant not worth depending on.
  `generatedAt` is the actual semantic load boundary. A `useRef` frozen at
  mount was considered and rejected: it would keep diffing against the
  first load forever if a host ever called `get-feed` more than once
  against the same mounted view.
- **Bullets never vote on the card badge.** Bullet "new" detection is a
  plain set difference against the cached bullet list, not a real text
  diff, so an edited bullet reads as an addition. That's the noisiest
  signal of the three, so it's excluded from the card badge every scanning
  reader sees and surfaces only in the detail sheet, on an intentional
  open. A test locks this in, and the known ceiling is marked with a
  `ponytail:` comment in `formatters.ts`.
- **Snapshot pruning reuses `pruneReadIds`** instead of a second Map-pruning
  function, so a snapshot for a story no longer in the feed never lingers
  past a load.
- **Source URLs are deduped before diffing**, so a URL repeated across two
  sources in the same story isn't reported as new.
- **Upgrade behavior:** this ships after read-ids is already populated for
  returning readers, so on the first load after deploy every story is a
  first-ever visit to the new snapshot cache and shows no delta — expected,
  and self-correcting from the next load on.

### Verification

`npm run verify` green: lint clean, 155/155 tests passing (up from a 140
baseline), typecheck clean. `npm run build` and `npm run build:site` both
succeed. An independent read-only UI/UX review (`npm run review:ui`)
checked mobile web at 390px and 320px, desktop at 1440px, and the MCP App
in both themes; it confirmed a card never shows both badges at once, that
first visits show no fabricated deltas, and that the sheet's new tags stay
legible at 320px. Its first finding — that the delta badge and the
historical cumulative badge originally shared an identical accent
treatment, weakening the at-a-glance distinction the feature exists for —
produced the `.is-historical` demotion described above. A second pass on
that fix measured the demoted pill's light-theme contrast at 4.20:1,
under the 4.5:1 WCAG AA threshold for its 10px text; dropping the pill
fill rather than tinting it resolved that at 4.76:1 light and 5.11:1
dark.

There's no React component test harness in this project, so the pure delta
logic is unit-tested directly in `formatters.ts`, and CSS/markup invariants
are asserted by regex in `test/unit/feed-css.test.ts` — the same split used
for prior UI changes in this feed.
