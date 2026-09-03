# Fixes from the shared feed UI review

**Status:** shipped · **Branch:** `dev/ui-review-findings-feed` · **Commit:** `9629770`

## What it is and why

This isn't a new feature. It's the fix for four findings from a read-only
Codex UI/UX review of the shared story-card feed UI
(`views/_shared/feed/`), which both the MCP `get-feed` View
(`views/get-feed/view.tsx`) and the standalone static site (`site/`)
render. The review's first verdict was "Not ready." After two rounds of
fixes and re-review, it's "Ready with concerns."

## What the review required

Four findings, ranked by severity:

- **P1 — focus escaped the modal.** Opening a source's detail sheet should
  trap keyboard focus inside it; Tab and Shift+Tab were reaching cards
  hidden behind the overlay.
- **P1 — the mobile filter row broke.** At narrow widths the search box
  and two select dropdowns fought for one row and lost; search shrank to
  roughly one character wide at 320px.
- **P2 — long summaries wrecked the grid.** Unbounded summary text made
  card heights vary wildly, producing a ragged two-column desktop layout
  and pushing content far down the page.
- **P2 — freshness was ambiguous after midnight.** The header showed only
  a time ("Updated 8:02 PM") with no way to tell whether that time was
  today's or yesterday's.

## How it was implemented

Read the diff directly (`git show 9629770`) for the exact changes. Files
touched: `views/_shared/feed/FeedApp.tsx`, `FeedHeader.tsx`,
`SourceSheet.tsx`, `feed.css`, `formatters.ts`, and a new `focus-trap.ts`;
tests in `feed-css.test.ts`, `feed-formatters.test.ts`, and a new
`feed-focus-trap.test.ts`.

### Focus trap

Two mechanisms, not one. `inert={selected !== undefined}` on `.app-shell`
in `FeedApp.tsx` removes the background from the tab order and
accessibility tree natively when a sheet is open. A cyclic focus boundary
(`focus-trap.ts`, wired into `SourceSheet.tsx`'s existing keydown effect)
keeps Tab/Shift+Tab cycling through the dialog's Copy, Close, and source
links.

The part worth remembering: binding `inert` to the open state initially
broke focus *restoration*. `closeSheet()` called `setSelected(undefined)`
and then `.focus()` on the card that opened the sheet — but React batches
the state update, so the DOM hadn't yet removed `inert` when `.focus()`
ran. Per the HTML spec, focusing an element inside an inert subtree is a
silent no-op. jsdom doesn't enforce that rule, so a unit test passed while
every real browser failed. The fix wraps the state update in `flushSync`
inside `closeSheet`, forcing the DOM to commit before the focus call.

### Mobile filter row

`.filter-row` now wraps instead of squeezing three controls onto one
line: search takes `flex: 1 1 100%` on its own row, and the provider and
tag selects share the row below at `flex: 1 1 0`. A `>=640px` override
scoped to `:not(.newsroomFeed--mcp)` restores the original single-row
layout for the site only — the fixed-width MCP panel keeps the narrower
composition deliberately. The provider select's "All" label became "All
providers" so its purpose reads without opening it. A follow-up removed
`overflow: hidden` from the selects after the reviewer caught the label
failing to paint in the no-tags state.

### Summary length

`.story-summary` clamps to a three-line preview. `SourceSheet` gained a
`.sheet-summary` paragraph carrying the full, untruncated text — a
summary that previously wasn't shown there at all. Bounding the dominant
source of card-height variance fixed the ragged grid; no masonry layout
or JS measurement was needed. Measured effect: document height fell from
13,993px to 11,366px on mobile and 7,102px to 5,710px on desktop; card
heights went from 257–474px to 189–238px; the worst desktop row gap is
now 33px, and eight cards fit in the first desktop viewport.

### Freshness

`freshness()` in `formatters.ts` compares local calendar days via
`toDateString()` instead of subtracting 24 hours. That distinction
matters: a snapshot from 11pm yesterday is only about two hours old but
did not happen today. The function returns a time-only string for today,
a dated string ("Sep 2, 8:02 PM") otherwise, and a `stale` flag once the
snapshot passes six hours old — roughly 12x the ~30-minute publish
cadence described in `docs/agent-system-prompt.md`, loose enough to
tolerate a skipped run or two but tight enough to catch an overnight
stall. `FeedHeader` shows an explicit "Stale" text badge rather than a
color-only cue, matching how the unread count already works.

### Tests

`npm run verify` (lint, 448 tests, typecheck), `npm run build`, and
`npm run build:site` all pass.

`feed-focus-trap.test.ts` covers the pure wrap-decision logic only. It
deliberately does not assert focus restoration in jsdom, because jsdom's
failure to enforce `inert` would let such a test pass against the
known-broken code. Real-browser focus behavior is covered only by the
Codex UI review — worth remembering before anyone "improves" coverage
with a jsdom test that proves nothing.

## Known limitations

Two issues were deferred on purpose, not overlooked:

- At 320px, focusing the provider select can transiently show "All"
  instead of "All providers" until blur. The DOM, `aria-label`, and box
  dimensions stay correct throughout; four isolated fresh Chromium
  profiles rendered it correctly. The reviewer judged it
  compositor-specific and not a release blocker.
- The standalone site's `position: sticky` header doesn't stick — it's
  sticky within `.scroll-area`, but the site scrolls the document
  instead. This predates this change. It's deferred because the header
  is now 176px tall (about 21% of a 390x844 viewport, 31% of a 320x568
  one), and making it stick properly needs its own compact-scrolled-state
  design, not a one-line fix. The reviewer agreed with deferring it. A
  code comment marks the spot in `feed.css`.

## Review evidence

Review runs live under `.ui-review/runs/` (Git-ignored, so referenced
here by timestamp rather than link):

- `2026-09-03T18-22-47-510Z` — original review, "Not ready"
- `2026-09-03T18-53-27-144Z` — round 1 re-review, "Not ready"
- `2026-09-03T19-28-55-201Z` — round 2 re-review, "Ready with concerns"
