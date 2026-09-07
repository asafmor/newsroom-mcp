import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import { classifyAxis, classifyGestureEnd, clampDragX, isArmed, releaseVelocityX, swipeProgress, VELOCITY_WINDOW_MS } from "./swipe.js";
import type { GestureAxis, GestureSample } from "./swipe.js";
import { spawnRippleAt } from "./ripple.js";

export interface SwipeAffordance {
  /**
   * Only true while a drag is actively marking-read-eligible: an unread
   * story with read-state storage available. An already-read card
   * (criterion 10) or one where `readIds` is `undefined` this session
   * (criterion 26) never shows this, even though the card itself may still
   * be dragging under the reader's finger.
   */
  readonly visible: boolean;
  /** True once the live drag distance alone has crossed the commit threshold — the "perceptible before release" cue (criterion 12). Velocity-based commit only resolves at release, so it has no live equivalent here. */
  readonly armed: boolean;
  readonly style: CSSProperties;
}

export interface SwipeToRead {
  readonly cardRef: RefObject<HTMLElement | null>;
  /** Inline transform/transition for `.story-card` — `undefined` at rest so the element falls back to its plain CSS rules untouched. */
  readonly cardStyle: CSSProperties | undefined;
  readonly affordance: SwipeAffordance;
}

/**
 * Wires native Touch Events to the pure classification logic in `swipe.ts`
 * and exposes just enough derived state for `StoryCard` to render the
 * drag-follow transform and the mark-as-read affordance.
 *
 * Touch uses native Touch Events, not Pointer Events, the same choice
 * `SourceSheet`'s drag-to-dismiss already made and documents: Chrome cancels
 * a Pointer Events drag once it recognizes native panning when touch-action
 * permits it (which `.story-card`'s `touch-action: pan-y` deliberately
 * does, on purpose — see feed.css). `StoryCard`'s own `onPointerDown`/
 * `onClick` continue to handle mouse/pen exactly as before; this hook never
 * touches those (criterion 20 — no swipe affordance/chrome for non-touch
 * input).
 */
export function useSwipeToRead({
  isRead,
  onTap,
  onSwipeCommit,
}: {
  /** `undefined` = read-state storage unavailable this session (criterion 26); `false` = unread; `true` = already read (criterion 10). */
  readonly isRead: boolean | undefined;
  /** Fires when a touch gesture resolves as a tap — mirrors what `onClick` does for mouse (criterion 16). */
  readonly onTap: () => void;
  /** Fires once, only for a genuinely-unread card whose swipe commits (criterion 8) — never for an already-read one (criterion 10). */
  readonly onSwipeCommit: () => void;
}): SwipeToRead {
  const cardRef = useRef<HTMLElement | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Read fresh values from refs inside the touch handlers below instead of
  // depending on props/state directly — the handlers are registered once
  // (see the mount-only effect) and several touchmove events can batch
  // before a state update actually renders, same reasoning as SourceSheet's
  // dragYRef/onCloseRef.
  const isReadRef = useRef(isRead);
  isReadRef.current = isRead;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onSwipeCommitRef = useRef(onSwipeCommit);
  onSwipeCommitRef.current = onSwipeCommit;

  const startRef = useRef<GestureSample | null>(null);
  const lastRef = useRef<GestureSample | null>(null);
  const axisRef = useRef<GestureAxis>("pending");
  const cardWidthRef = useRef(0);
  // Recent movement samples, trimmed to the flick-measuring window on every
  // push so this can never grow with gesture length. Needed because a
  // stationary finger emits no touchmove — see releaseVelocityX for why the
  // release velocity has to be measured against a window rather than the
  // newest sample, which can be seconds stale by the time the finger lifts.
  const samplesRef = useRef<GestureSample[]>([]);

  useEffect(() => {
    function recordSample(sample: GestureSample) {
      const samples = samplesRef.current;
      samples.push(sample);
      // Keep one sample older than the window so a release still has a span to
      // measure against when moves are sparse; everything before that is dead
      // weight.
      while (samples.length > 2 && samples[1].t < sample.t - VELOCITY_WINDOW_MS) samples.shift();
    }

    function endGesture() {
      startRef.current = null;
      lastRef.current = null;
      axisRef.current = "pending";
      samplesRef.current = [];
      // Re-enable the CSS transition (see cardStyle/affordance.style below)
      // so dragX's return to 0 animates — the same element covers spring-
      // back (cancel), commit-settle, and the multi-touch/unmount-safe
      // cancel path, since all three end the same way: dragX -> 0.
      setDragging(false);
      setDragX(0);
    }

    function onTouchStart(e: TouchEvent) {
      // A second finger touching down while a gesture is already live
      // cancels it outright (criterion 5) — never start tracking a new
      // gesture from touch #2, and drop whatever was live.
      if (e.touches.length !== 1) {
        if (startRef.current !== null) endGesture();
        return;
      }
      // Storage unavailable this session: attach nothing — no drag-follow,
      // no affordance, ever. A swipe here must feel like a plain, ignored
      // drag (criterion 26), not a feature that silently does nothing.
      if (isReadRef.current === undefined) return;
      const touch = e.touches.item(0);
      if (touch === null) return;
      const sample: GestureSample = { x: touch.clientX, y: touch.clientY, t: e.timeStamp };
      startRef.current = sample;
      lastRef.current = sample;
      axisRef.current = "pending";
      samplesRef.current = [];
      recordSample(sample);
      // `el` (below, where listeners are registered) is out of narrowed-null
      // reach from here — this closure is defined before that null check —
      // so re-derive the element from the event itself instead.
      cardWidthRef.current = (e.currentTarget as HTMLElement).getBoundingClientRect().width;
    }

    function onTouchMove(e: TouchEvent) {
      if (startRef.current === null) return;
      if (e.touches.length !== 1) {
        endGesture();
        return;
      }
      const touch = e.touches.item(0);
      if (touch === null) return;
      const sample: GestureSample = { x: touch.clientX, y: touch.clientY, t: e.timeStamp };
      lastRef.current = sample;
      recordSample(sample);

      if (axisRef.current === "pending") {
        axisRef.current = classifyAxis(startRef.current, sample);
      }
      // Still ambiguous, or resolved vertical: never transform the card and
      // never preventDefault — the feed keeps scrolling normally, and
      // vertical stays that way for the rest of this gesture once decided
      // (criterion 1/3).
      if (axisRef.current !== "horizontal") return;

      // Horizontal is locked in for the rest of this gesture: own it, so
      // the page can't also scroll vertically underneath the drag
      // (criterion 4).
      e.preventDefault();
      const dx = sample.x - startRef.current.x;
      setDragging(true);
      setDragX(clampDragX(dx, cardWidthRef.current));
    }

    function onTouchEnd(e: TouchEvent) {
      const start = startRef.current;
      const last = lastRef.current;
      // Nothing live (already resolved by a prior event, or never started) —
      // idempotent against duplicate/rapid touchend events some WebViews
      // fire for one physical gesture.
      if (start === null || last === null) return;

      // The finger's last known POSITION, stamped with the moment it actually
      // lifted. A hold emits no touchmove, so `last.t` alone would date the
      // release to whenever movement stopped and report a long-finished flick
      // as if it were still in progress (criterion 6 — this must be release
      // velocity, not peak velocity).
      const release: GestureSample = { x: last.x, y: last.y, t: e.timeStamp };
      const outcome = classifyGestureEnd({
        axis: axisRef.current,
        dx: last.x - start.x,
        dy: last.y - start.y,
        velocityX: releaseVelocityX(samplesRef.current, release),
        cardWidth: cardWidthRef.current,
      });

      // Suppresses the emulated mouse/click events the browser would
      // otherwise dispatch after this touchend for every outcome — the tap
      // path opens the sheet itself below rather than relying on that
      // synthetic click, since Chromium can suppress it once it's decided a
      // gesture was a drag (the exact trap this sidesteps).
      e.preventDefault();

      if (outcome === "tap") {
        const el = cardRef.current;
        if (el !== null) spawnRippleAt(el, last.x, last.y);
        endGesture();
        onTapRef.current();
        return;
      }
      if (outcome === "commit") {
        // Already-read: the drag-follow was allowed to play (criterion 10
        // — "may still occur"), but nothing past this point may signal a
        // state change — same plain spring-back as a cancel, no callback.
        if (isReadRef.current === false) onSwipeCommitRef.current();
        endGesture();
        return;
      }
      endGesture();
    }

    function onTouchCancel() {
      if (startRef.current === null) return;
      endGesture();
    }

    const el = cardRef.current;
    if (el === null) return;
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
    // Mount-only: handlers read every live value through the refs above, so
    // they never go stale despite never being re-registered.
  }, []);

  const cardWidth = cardWidthRef.current;
  const cardStyle: CSSProperties | undefined =
    dragX === 0 ? undefined : { transform: `translateX(${String(dragX)}px)`, transition: dragging ? "none" : undefined };

  const affordance: SwipeAffordance = {
    visible: isRead === false && dragX !== 0,
    armed: dragX !== 0 && isArmed(dragX, cardWidth),
    style: {
      opacity: Math.min(1, swipeProgress(dragX, cardWidth)),
      justifyContent: dragX > 0 ? "flex-start" : "flex-end",
    },
  };

  return { cardRef, cardStyle, affordance };
}
