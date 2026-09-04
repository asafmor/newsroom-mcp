# Time-of-day theme

**Status:** shipped

## What it is and why

The feed UI had a three-state light/dark/auto toggle in the header, backed by
a persisted `localStorage` preference and a `prefers-color-scheme` fallback.
The idea behind this change is Waze-style: drop the toggle entirely and let
the app decide light vs. dark from the reader's local clock, the same way a
navigation app switches to a dark map at night without asking. No toggle, no
persisted preference, no OS signal — the app decides.

## What it was required to do

- Remove the toggle button, its icons, and the persisted `localStorage`
  preference from the feed UI.
- Pick dark or light from local time alone, with no manual override and no
  `prefers-color-scheme` involvement.
- Re-evaluate the theme when it should actually change: on load, when a
  backgrounded tab comes back to the front, and at the moment a day/night
  boundary passes — not just once at mount.
- Get the boundary-crossing case right for a machine that was asleep or a tab
  that was hidden: re-resolve from the real current time rather than trusting
  that a scheduled wakeup fired exactly on time.

## How it was implemented

Entirely inside `views/_shared/feed/`, the code shared by both feed hosts,
so the MCP `get-feed` View and the static site pick it up identically. The
diff is deletion-heavy.

- **`formatters.ts`** — two new pure functions, following the existing
  `freshness(iso, now = new Date())` injectable-clock convention so both test
  against fixed `Date`s with no fake timers:
  - `resolveTheme(now = new Date())` returns `"light"` for local hours 07:00
    up to (not including) 19:00, `"dark"` otherwise.
  - `msUntilNextThemeBoundary(now = new Date())` returns the milliseconds
    until the next 07:00/19:00 local boundary. It builds candidate local
    `Date`s — today 07:00, today 19:00, tomorrow 07:00 — and takes the first
    one strictly after `now`. Building local-component dates rather than
    doing fixed-hour arithmetic keeps it correct across DST transitions; the
    strict `>` guarantees a boundary-exact instant returns a full 12 hours
    instead of 0, which would otherwise busy-loop the timer.
- **`FeedApp.tsx`** — resolves the theme at mount, re-resolves on the
  `visibilitychange` event, and schedules a single `setTimeout` for
  `msUntilNextThemeBoundary()` that re-resolves the theme and reschedules
  itself. No polling, no `setInterval`. Both re-evaluation paths stay: the
  scheduled timeout covers a tab left open across a boundary, and
  `visibilitychange` catches a backgrounded tab whose timer the browser
  throttled or suspended. Either path re-resolves from the current clock
  rather than assuming the boundary landed on time, so a laptop that slept
  from 18:55 to 22:00 wakes up dark, not light.
- **`FeedHeader.tsx`**, **`types.ts`** — the toggle button, its icons, the
  `Theme` type, and the `theme`/`onThemeChange` props threaded through the
  component tree are gone.
- **`feed.css`** — the toggle button's styles are gone.
- **`test/unit/feed-formatters.test.ts`** — new suites for `resolveTheme` and
  `msUntilNextThemeBoundary` pinning every boundary (06:59/07:00/18:59/19:00
  and the exact-boundary edge case).
- **`test/unit/feed-css.test.ts`** — the now-dead `.theme-toggle` assertion
  is deleted along with the rule it checked.

Not touched: no MCP tool, schema, service, or repository; no `feed.json`
shape or size change; no change to either host wrapper
(`views/get-feed/view.tsx`, `site/`). The deployed static site stays fully
static.

### Notable decisions

- **`prefers-color-scheme` is dropped, not kept as a fallback.** The product
  decision is that the app decides; a second signal (OS appearance) would
  compete with the clock instead of deferring to it.
- **The orphaned `newsroom-theme` `localStorage` key is left inert** for
  returning readers. Nothing reads it anymore; there's no migration or
  cleanup code, since a value nothing reads is harmless.
- **Known trade-off:** a reader who wants dark mode regardless of the actual
  time loses that option — there's no escape hatch. This was the explicit
  request behind the change, but it's worth stating plainly since it's the
  first thing a future reader is likely to question.
- **The boundary timer exists because of a UI review finding.** An earlier
  version only re-resolved on mount and on `visibilitychange`, which a
  read-only UI review caught leaving a foregrounded page light past 19:00
  because nothing re-checked the clock while the tab just sat open. The
  scheduled `setTimeout` closes that gap; `visibilitychange` stays for the
  backgrounded-tab case the timer alone can't cover.

### Verification

`npm run verify` green: lint clean, 322 tests passing, typecheck clean.
`npm run build` and `npm run build:site` both succeed. `msUntilNextThemeBoundary`
was additionally swept across 400 days at one-minute granularity in five DST
timezones (America/New_York, Europe/Dublin, Australia/Lord_Howe,
Pacific/Chatham, America/Santiago), with no non-positive delay and no missed
transition.
