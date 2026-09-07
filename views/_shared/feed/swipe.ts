/**
 * Pure gesture-classification logic for swipe-to-mark-read on a story card.
 * Dependency-free on purpose (no DOM/browser/animation API) so it's
 * unit-testable without simulating real touch/scroll physics — see
 * `test/unit/feed-swipe.test.ts`. `useSwipeToRead.ts` is the only caller;
 * it wires native touch events (see that file for why) to these functions
 * and is itself kept thin.
 */

/** A single touch sample: position + its own timestamp (ms) — never a DOM event, just the numbers a gesture needs. */
export interface GestureSample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/**
 * Movement, in px on either axis, below which a gesture's direction is still
 * "pending" (criterion 1/3 — determine intent from only the early portion of
 * the movement, and don't act until it's decided: no transform, no
 * preventDefault, feed scrolls normally). Small enough to feel instant,
 * large enough to reject the sub-pixel jitter every touchscreen emits at rest.
 */
export const AXIS_LOCK_PX = 8;

/**
 * Release movement at or under this, on both axes, still counts as a tap
 * rather than a cancelled drag (criterion 16's "small jitter tolerance").
 * Deliberately <= AXIS_LOCK_PX: a gesture that stays under the axis-lock
 * threshold the whole time never leaves the "pending" axis, and release
 * jitter tolerance is checked against that same "pending" state below.
 */
export const TAP_JITTER_PX = 6;

/**
 * Horizontal displacement needed to commit a swipe, as a fraction of the
 * card's own width (criterion 6: "target: roughly 30% of card width").
 */
export const COMMIT_DISTANCE_RATIO = 0.3;

/**
 * Clamp on the derived px threshold so it stays a usable, deliberate drag at
 * both a very narrow and a very wide card (edge case list) — 30% of a
 * 320px card is ~96px (fine), but 30% of a 960px desktop card would be
 * ~288px (too far to ever reach comfortably), and 30% of a 240px card would
 * be too easy to cross by accident.
 */
export const COMMIT_DISTANCE_MIN_PX = 72;
export const COMMIT_DISTANCE_MAX_PX = 160;

/**
 * Release horizontal velocity (px/ms) that commits a swipe even short of the
 * distance threshold — a fast flick (criterion 6's fling threshold).
 * ~0.5px/ms is roughly "crossed 60px in 120ms", a brisk but unforced flick.
 */
export const COMMIT_VELOCITY_PX_MS = 0.5;

/**
 * How far back from the release moment `releaseVelocityX` looks when measuring
 * a flick. Must stay a *recent* window rather than the whole gesture: a
 * stationary finger emits no `touchmove` at all, so the newest movement sample
 * can be arbitrarily old by the time the finger lifts. Measuring start->last-move
 * would then report the speed of a flick that already ended — see
 * `releaseVelocityX` for the bug that caused.
 */
export const VELOCITY_WINDOW_MS = 120;

/**
 * Hard cap on how far the card visually follows the finger, as a fraction of
 * its own width — the drag-follow must never look like the card is flying
 * off screen (criterion 14: no full off-screen slide, since the card is
 * never actually removed from the list).
 */
export const MAX_DRAG_RATIO = 0.6;

export type GestureAxis = "pending" | "horizontal" | "vertical";

/**
 * Decide whether an in-progress drag is a horizontal-swipe candidate or a
 * vertical scroll, from only the samples taken since the gesture started
 * (criterion 2: pure function over sample data, no DOM/browser dependency).
 *
 * Returns "pending" while movement on both axes is still under
 * `AXIS_LOCK_PX` — the caller must keep calling this on each move while
 * pending, and must not act on a "pending" result (criterion 3). Once this
 * returns "horizontal" or "vertical" the caller commits to that
 * interpretation for the rest of the gesture and must stop calling this
 * again (criterion 1 — the decision never flips mid-gesture).
 */
export function classifyAxis(start: GestureSample, current: GestureSample): GestureAxis {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  if (dx < AXIS_LOCK_PX && dy < AXIS_LOCK_PX) return "pending";
  return dx > dy ? "horizontal" : "vertical";
}

/** The proportional commit threshold for a card of the given width, clamped to a usable px range. */
export function commitThresholdPx(cardWidth: number): number {
  return Math.min(COMMIT_DISTANCE_MAX_PX, Math.max(COMMIT_DISTANCE_MIN_PX, cardWidth * COMMIT_DISTANCE_RATIO));
}

/** How far along the commit threshold the current drag distance is — 0 at the start, 1 right at the threshold, uncapped past it (callers clamp for CSS as needed). */
export function swipeProgress(dx: number, cardWidth: number): number {
  const threshold = commitThresholdPx(cardWidth);
  return threshold === 0 ? 0 : Math.abs(dx) / threshold;
}

/** Whether the live drag distance alone (not velocity — that's only known at release) has already crossed the commit threshold, for the "perceptible before release" cue (criterion 12). */
export function isArmed(dx: number, cardWidth: number): boolean {
  return Math.abs(dx) >= commitThresholdPx(cardWidth);
}

/** Clamps the live drag-follow offset so the card never visually travels far enough to look like it's leaving the list (criterion 14). */
export function clampDragX(dx: number, cardWidth: number): number {
  const max = cardWidth * MAX_DRAG_RATIO;
  return Math.max(-max, Math.min(max, dx));
}

export type GestureOutcome = "tap" | "commit" | "cancel";

/**
 * Single source of truth for what a finished (or abandoned) gesture means
 * (criterion 19) — the tap path and the swipe path both resolve through this
 * one function so their thresholds can never drift apart independently.
 *
 * - "tap": axis never left "pending" (no meaningful movement on either
 *   axis) and release position is within `TAP_JITTER_PX` of the start —
 *   open the sheet exactly as the mouse/click path does (criterion 16).
 * - "commit": axis locked "horizontal" AND (distance past
 *   `commitThresholdPx` OR release speed past `COMMIT_VELOCITY_PX_MS`) —
 *   mark the story read (criterion 6/8).
 * - "cancel": anything else — a vertical scroll, a horizontal drag released
 *   short of the threshold, or a gesture cancelled outright (multi-touch,
 *   `touchcancel`). No read-state change, no sheet open (criterion 7/17).
 */
export function classifyGestureEnd(params: {
  readonly axis: GestureAxis;
  readonly dx: number;
  readonly dy: number;
  readonly velocityX: number;
  readonly cardWidth: number;
}): GestureOutcome {
  const { axis, dx, dy, velocityX, cardWidth } = params;
  if (axis === "vertical") return "cancel";
  if (axis === "pending") {
    return Math.abs(dx) <= TAP_JITTER_PX && Math.abs(dy) <= TAP_JITTER_PX ? "tap" : "cancel";
  }
  const committed = Math.abs(dx) >= commitThresholdPx(cardWidth) || Math.abs(velocityX) >= COMMIT_VELOCITY_PX_MS;
  return committed ? "commit" : "cancel";
}

/** Horizontal velocity in px/ms between two samples — `dt` is floored to 1ms so a duplicate/zero-interval sample (Android WebViews, fast flicks) never divides by zero or inflates to Infinity. */
export function velocityX(start: GestureSample, end: GestureSample): number {
  const dt = Math.max(1, end.t - start.t);
  return (end.x - start.x) / dt;
}

/**
 * Horizontal velocity at the moment the finger lifts, measured only over the
 * last `VELOCITY_WINDOW_MS` before `release` — the value `classifyGestureEnd`
 * should be given for its fling check.
 *
 * Why this is not simply `velocityX(firstSample, lastSample)`: a finger that
 * stops moving emits NO further `touchmove` events, so the newest sample stays
 * frozen at wherever the movement stopped. Measuring across the whole gesture
 * therefore reports the speed of a flick that has already ended — "drag 60px
 * in 100ms, rest for a full second, then lift" computed 0.6px/ms and committed,
 * marking a story read from a deliberately-abandoned drag (found in review;
 * see `test/unit/feed-swipe.test.ts`). Anchoring the window to the RELEASE
 * timestamp instead makes a hold decay the velocity to zero, exactly as a
 * reader pausing to reconsider would expect.
 *
 * Measures from the sample that SPANS the start of the window (the newest one
 * at or before it) rather than the oldest one inside it. Touch event delivery
 * rate varies wildly by device and load, and anchoring inside the window made
 * recognition depend on it: an identical 80px flick from 200-300ms released at
 * 325ms committed when intermediate samples existed, but cancelled when only
 * the 200ms and 300ms endpoints did, because the 200ms sample fell outside the
 * window and the remaining 300ms one sat at the release position — measuring
 * zero movement across a real flick (found in review). Spanning the boundary
 * makes both sampling rates agree.
 *
 * Returns 0 when the finger was stationary for the whole run-up to the release
 * (the hold case above), and when no time elapsed at all — a degenerate
 * zero-duration gesture is unknowable, not infinitely fast, so it must never
 * commit on velocity alone.
 */
export function releaseVelocityX(samples: readonly GestureSample[], release: GestureSample): number {
  const windowStart = release.t - VELOCITY_WINDOW_MS;
  let reference: GestureSample | undefined;
  for (const sample of samples) {
    if (sample.t <= windowStart) reference = sample;
    else {
      reference ??= sample;
      break;
    }
  }
  if (reference === undefined || release.t <= reference.t) return 0;
  return velocityX(reference, release);
}
