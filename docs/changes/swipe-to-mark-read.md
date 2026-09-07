# Swipe to mark a story read

**Status:** shipped · **Branch:** `dev/swipe-to-mark-read`

## What it is and why

Read state already existed — opening a story's detail sheet marked it read
(see `docs/changes/story-read-state.md`) — but on a touch device that meant
tapping in, then tapping back out, just to dismiss a story you'd already
skimmed the headline for. This change adds a second, faster way to do the
same thing on mobile: swipe the story card left or right and it's marked
read without opening anything. Desktop is untouched — mouse and keyboard
still only mark a story read by opening it.

## What it was required to do

- Work via real touch on Android Chrome and iOS Safari; do nothing new for
  mouse, pen, or keyboard input.
- Either swipe direction marks the story read — never marks it unread, since
  no input method in this product can mark a story unread. Swiping an
  already-read card is a no-op: the card may still follow the finger, but
  nothing signals a change.
- Never remove the card from the list, matching the existing rule that
  opening a story doesn't remove it either — so no undo affordance is
  needed, because nothing disappears.
- Decide the gesture's direction from only its early movement, and don't
  act (no transform, no scroll interference) until that's decided — a
  vertical drag must keep the feed scrolling exactly as it always has.
- Commit on either a firm drag (roughly 30% of the card's width, clamped to
  a sane px range at both very narrow and very wide cards) or a fast flick
  short of that distance, and give a visible "armed" cue once a live drag
  has crossed the commit distance, before the finger lifts.
- Cap how far the card visually follows the finger, so the drag-follow
  never looks like the card is leaving the list.
- Treat a stationary tap (no meaningful movement, released within a small
  jitter tolerance) exactly like the existing click path: open the sheet.
- Respect the existing three-state read storage: if `localStorage` is
  unreadable this session, attach no swipe behavior at all — no drag,
  no affordance — rather than appear to work and do nothing.

## How it was implemented

- **`views/_shared/feed/swipe.ts`** (new) — dependency-free, pure gesture
  classification: `classifyAxis` (pending/horizontal/vertical, from a start
  and current sample), `classifyGestureEnd` (tap/commit/cancel — the single
  function both the tap path and the swipe path resolve through, so their
  thresholds can't drift apart), `releaseVelocityX` and `velocityX`,
  `commitThresholdPx`/`swipeProgress`/`isArmed` (the 30%-of-width distance
  rule, clamped to 72–160px), and `clampDragX` (60%-of-width visual cap).
  No DOM or browser API — it operates purely on `{x, y, t}` samples, which
  is what makes it unit-testable in a project with no jsdom.
- **`views/_shared/feed/useSwipeToRead.ts`** (new) — a thin hook that wires
  native `TouchEvent`s to that pure logic and exposes a `cardRef`, an
  optional drag-follow `cardStyle`, and an `affordance` (visibility, armed
  state, style) for `StoryCard` to render. Registers `touchstart` as
  passive, `touchmove` as non-passive (so it can call `preventDefault()`
  once the axis locks horizontal), and `touchend`/`touchcancel`.
- **`views/_shared/feed/StoryCard.tsx`** — new `.story-card-wrap` element
  wrapping the card, hosting the reveal layer (a checkmark icon) behind it;
  a new `onMarkRead` prop; the ripple effect is suppressed for touch
  pointer-downs so a gesture that turns into a swipe never first flashes
  "this will open something".
- **`views/_shared/feed/FeedApp.tsx`** — a new `markRead(story)` function
  alongside the existing `openStory`, performing the same idempotent
  `readIds` `Set` update without opening the sheet. Kept as a separate
  function rather than a flag on `openStory` so `StoryCard` has no path
  from the swipe gesture to opening the sheet.
- **`views/_shared/feed/feed.css`** — `.story-card-wrap`, `.story-card {
  touch-action: pan-y }` (lets native vertical scroll through while
  `useSwipeToRead` owns horizontal), `.swipe-affordance`, and
  `.swipe-affordance--armed` (a discrete color flip once the live drag
  crosses the commit threshold).
- **`views/_shared/feed/ripple.ts`** — extracted `spawnRippleAt(el, x, y)`
  so the tap path in `useSwipeToRead` can spawn the ripple itself once a
  gesture actually resolves as a tap; `spawnRipple` now wraps it.
- **`test/unit/feed-swipe.test.ts`** (new) — unit tests for the pure
  classification functions (axis lock, the tap/commit/cancel matrix,
  direction symmetry, threshold clamp edges, the two velocity regressions
  below) plus source-text guards asserting the touch listeners are wired
  with the right passive flags and that the mark-read callback only fires
  for a known-unread card.
- **`test/unit/feed-css.test.ts`** — new guards for `touch-action: pan-y`,
  that the new wrapper never reintroduces `overflow: hidden`, and that the
  armed state is visually distinct from the resting affordance.

This ships entirely inside `views/_shared/feed/`, so it reaches both the
sandboxed `get-feed` MCP View and the standalone static site at once.

## Design decisions worth recording

These are non-obvious, and a future edit could easily undo them.

1. **Left and right do the same thing — mark read.** There is deliberately
   no mark-as-unread in either direction, because this product has no
   mark-as-unread anywhere (tap, keyboard, or otherwise). A direction-only
   unread would let touch users reach a state no other input method can
   produce or reverse. For the same reason, swiping an already-read card is
   a state no-op: the card may still visually drag, but nothing marks a
   change.
2. **The card is never removed from the list**, matching the existing rule
   that opening a story never removes it. That's also why there's no
   undo/snackbar: nothing disappears, the change is visible exactly where it
   happened, and read state is a display treatment, not a filter.
3. **Native Touch Events, not Pointer Events** — the same choice
   `SourceSheet`'s existing drag-to-dismiss already made and documents:
   Chrome cancels a Pointer Events drag once it recognizes native panning,
   which `touch-action: pan-y` deliberately permits so vertical feed
   scrolling stays native.
4. **`touchend` calls `preventDefault()` for every outcome**, and the tap
   path opens the sheet itself instead of relying on the browser's
   synthetic click — this sidesteps Chromium's post-drag click suppression.
   There's a pre-existing sibling guard in `feed-css.test.ts` about
   `.sheet-drag-header` and `touch-action` worth reading alongside this.
5. **The wrapper deliberately has no `overflow: hidden` or
   `border-radius`.** Adding either clips `.story-card:hover`'s box-shadow.
   A CSS guard test pins this down.
6. **Reduced motion comes for free.** The settle/spring-back animation is
   driven by `.story-card`'s existing class-level `transition`, already
   covered by `feed.css`'s global `.newsroomFeed *` reduced-motion rule, so
   no separate override exists or is needed.
7. **Storage's three-state rule extends to swipe.** When `readIds` is
   `undefined` (localStorage inaccessible, as in some sandboxed MCP hosts)
   the swipe attaches nothing at all — no drag-follow, no affordance —
   rather than appearing to work and silently doing nothing.

## Two real bugs the read-only UI/UX review caught

Both are subtle and easy to reintroduce, so it's worth recording exactly
what went wrong and why the fix works.

1. **A paused drag committed a finished flick.** A stationary finger emits
   no `touchmove` at all, so the newest movement sample stays frozen
   wherever movement stopped. Measuring velocity across the whole gesture
   therefore reported the speed of a flick that had already ended: "drag
   60px in 100ms, rest a full second, then lift" computed 0.6px/ms and
   marked the story read from a drag the reader had visibly abandoned.
   Fixed by measuring release velocity against the actual `touchend`
   timestamp (`releaseVelocityX`), so a hold decays it to zero.
2. **Flick recognition depended on the device's touch event delivery
   rate.** Anchoring that measurement to the oldest sample *inside* the
   velocity window meant an identical 80px flick (movement 200–300ms,
   released at 325ms) committed when intermediate samples existed but
   cancelled when only the endpoints did — the opening sample fell outside
   the window and the surviving one sat at the release position, measuring
   zero movement across a real flick. Fixed by anchoring to the sample that
   *spans* the window boundary, so dense and sparse sampling agree. The
   same change makes a degenerate zero-duration gesture return 0 rather
   than riding the 1ms denominator floor to a huge velocity.

## Testing notes

This repo has no jsdom and no `@testing-library` — `vitest.config.ts` sets
no environment, so tests run in plain Node. That constraint is *why* the
gesture decisions were pushed into pure functions in `swipe.ts`: real touch
event objects and real scroll physics can't be constructed in this test
environment at all. `test/unit/feed-swipe.test.ts` covers the
classification logic directly (axis lock, the tap/commit/cancel matrix,
direction symmetry, threshold clamp edges, and both velocity regressions
above) plus source-text guards for the touch wiring, in the same spirit as
the existing `feed-css.test.ts` guards. Be clear-eyed that real touch/scroll
physics and real-device behavior are not simulated by the unit suite —
those tests can only prove the pure logic is correct, not that a real
finger on real glass produces the samples the logic assumes.

Verification beyond unit tests came from `npm run review:ui`, which drove
synthesized `TouchEvent`s through the actually-mounted handlers in
Chromium and confirmed, in both directions: a dense 80px flick commits, an
equivalent sparse flick commits, a 60px-then-one-second-hold cancels, a
60px drag with immediate release commits, and a 10px identical-timestamp
gesture cancels. Committed gestures removed the unread marker, cancelled
ones preserved it, and no gesture opened the detail sheet.

**Remaining limitation, stated plainly:** real Android Chrome and iOS
Safari hardware was not available, so device behavior beyond synthesized
Chromium events is unverified. The MCP App capture repeatedly returned an
empty feed during review, so swipe behavior inside the MCP View's sandboxed
iframe and fixed-height scroller could not be exercised directly. The
feature ships enabled in both hosts (`variant="site"` and `variant="mcp"`);
the agreed fallback, if the MCP host turns out to handle it poorly, is to
disable it for `variant="mcp"` only and keep tap-to-open there.

`npm run verify` is green (214 tests). `npm run build` and `npm run
build:site` both succeed.
