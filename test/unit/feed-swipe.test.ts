import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AXIS_LOCK_PX,
  COMMIT_DISTANCE_MAX_PX,
  COMMIT_DISTANCE_MIN_PX,
  COMMIT_DISTANCE_RATIO,
  COMMIT_VELOCITY_PX_MS,
  MAX_DRAG_RATIO,
  TAP_JITTER_PX,
  classifyAxis,
  classifyGestureEnd,
  clampDragX,
  commitThresholdPx,
  isArmed,
  releaseVelocityX,
  swipeProgress,
  velocityX,
} from "../../views/_shared/feed/swipe.js";
import type { GestureSample } from "../../views/_shared/feed/swipe.js";

function sample(x: number, y: number, t = 0): GestureSample {
  return { x, y, t };
}

describe("classifyAxis", () => {
  it("stays 'pending' while movement on both axes is under the lock threshold — criterion 1/3", () => {
    const start = sample(100, 100);
    expect(classifyAxis(start, sample(100 + AXIS_LOCK_PX - 1, 100 + AXIS_LOCK_PX - 1))).toBe("pending");
  });

  it("locks 'horizontal' once horizontal movement outpaces vertical past the lock threshold", () => {
    const start = sample(100, 100);
    expect(classifyAxis(start, sample(100 + AXIS_LOCK_PX + 4, 101))).toBe("horizontal");
  });

  it("locks 'vertical' once vertical movement outpaces horizontal past the lock threshold", () => {
    const start = sample(100, 100);
    expect(classifyAxis(start, sample(101, 100 + AXIS_LOCK_PX + 4))).toBe("vertical");
  });

  it("prefers whichever axis has moved further once the lock threshold is crossed, even diagonally", () => {
    const start = sample(0, 0);
    expect(classifyAxis(start, sample(20, 12))).toBe("horizontal");
    expect(classifyAxis(start, sample(12, 20))).toBe("vertical");
  });
});

describe("commitThresholdPx", () => {
  it("targets ~30% of the card's width in the normal (unclamped) range", () => {
    expect(commitThresholdPx(300)).toBeCloseTo(300 * COMMIT_DISTANCE_RATIO);
  });

  it("clamps up to a minimum px threshold for a very narrow card — edge case list", () => {
    expect(commitThresholdPx(50)).toBe(COMMIT_DISTANCE_MIN_PX);
  });

  it("clamps down to a maximum px threshold for a very wide (desktop-grid) card — edge case list", () => {
    expect(commitThresholdPx(2000)).toBe(COMMIT_DISTANCE_MAX_PX);
  });
});

describe("swipeProgress / isArmed", () => {
  it("is 0 at the start of a drag and reaches 1 exactly at the commit threshold", () => {
    const width = 300;
    expect(swipeProgress(0, width)).toBe(0);
    expect(swipeProgress(commitThresholdPx(width), width)).toBeCloseTo(1);
  });

  it("is direction-agnostic (same progress for a left drag as the equivalent right drag) — criterion 9", () => {
    const width = 300;
    expect(swipeProgress(-90, width)).toBeCloseTo(swipeProgress(90, width));
  });

  it("only arms once the live distance reaches the threshold, independent of velocity — criterion 12", () => {
    const width = 300;
    const threshold = commitThresholdPx(width);
    expect(isArmed(threshold - 1, width)).toBe(false);
    expect(isArmed(threshold, width)).toBe(true);
    expect(isArmed(-threshold, width)).toBe(true); // either direction — criterion 9
  });
});

describe("clampDragX", () => {
  it("passes small drags through unchanged", () => {
    expect(clampDragX(40, 300)).toBe(40);
  });

  it("caps the visual drag-follow so the card can never look like it's leaving the list — criterion 14", () => {
    const width = 300;
    expect(clampDragX(10000, width)).toBe(width * MAX_DRAG_RATIO);
    expect(clampDragX(-10000, width)).toBe(-width * MAX_DRAG_RATIO);
  });
});

describe("velocityX", () => {
  it("computes px/ms between two samples", () => {
    expect(velocityX(sample(0, 0, 0), sample(100, 0, 200))).toBeCloseTo(0.5);
  });

  it("floors the elapsed time at 1ms so a duplicate/zero-interval sample never divides by zero — edge case list (Android WebViews, fast flicks)", () => {
    expect(Number.isFinite(velocityX(sample(0, 0, 5), sample(50, 0, 5)))).toBe(true);
    expect(velocityX(sample(0, 0, 5), sample(50, 0, 5))).toBe(50);
  });
});

describe("classifyGestureEnd — single source of truth for tap/commit/cancel (criterion 19)", () => {
  const width = 300;

  it("resolves a stationary release (axis never left 'pending') as a tap — criterion 16", () => {
    expect(
      classifyGestureEnd({ axis: "pending", dx: 2, dy: -3, velocityX: 0, cardWidth: width }),
    ).toBe("tap");
  });

  it("does not treat a 'pending' release beyond the jitter tolerance as a tap", () => {
    expect(
      classifyGestureEnd({ axis: "pending", dx: TAP_JITTER_PX + 1, dy: 0, velocityX: 0, cardWidth: width }),
    ).toBe("cancel");
  });

  it("never opens the sheet for a vertical-axis gesture, however it ends", () => {
    expect(
      classifyGestureEnd({ axis: "vertical", dx: 0, dy: 200, velocityX: 0, cardWidth: width }),
    ).toBe("cancel");
  });

  it("commits a horizontal drag once it clears the distance threshold — criterion 6/8", () => {
    const threshold = commitThresholdPx(width);
    expect(
      classifyGestureEnd({ axis: "horizontal", dx: threshold, dy: 0, velocityX: 0, cardWidth: width }),
    ).toBe("commit");
  });

  it("commits a short-but-fast flick via the velocity threshold even under the distance threshold — criterion 6", () => {
    const threshold = commitThresholdPx(width);
    expect(
      classifyGestureEnd({
        axis: "horizontal",
        dx: threshold / 2,
        dy: 0,
        velocityX: COMMIT_VELOCITY_PX_MS + 0.1,
        cardWidth: width,
      }),
    ).toBe("commit");
  });

  it("cancels a horizontal drag released short of both the distance and velocity thresholds — criterion 7/17", () => {
    const threshold = commitThresholdPx(width);
    expect(
      classifyGestureEnd({ axis: "horizontal", dx: threshold - 1, dy: 0, velocityX: 0, cardWidth: width }),
    ).toBe("cancel");
  });

  it("treats left and right drags identically at every outcome — criterion 9 (no direction marks unread)", () => {
    const threshold = commitThresholdPx(width);
    const right = classifyGestureEnd({ axis: "horizontal", dx: threshold, dy: 0, velocityX: 0, cardWidth: width });
    const left = classifyGestureEnd({ axis: "horizontal", dx: -threshold, dy: 0, velocityX: 0, cardWidth: width });
    expect(right).toBe("commit");
    expect(left).toBe("commit");
  });
});

describe("named, reusable threshold constants — criterion 6", () => {
  it("exposes exactly one distance constant and one velocity constant, not per-call magic numbers", () => {
    expect(typeof COMMIT_DISTANCE_RATIO).toBe("number");
    expect(typeof COMMIT_VELOCITY_PX_MS).toBe("number");
    expect(COMMIT_DISTANCE_RATIO).toBeGreaterThan(0);
    expect(COMMIT_DISTANCE_RATIO).toBeLessThan(1);
  });
});

describe("release velocity decays while the finger is held still — UI review finding", () => {
  // Regression for a real defect found by the read-only UI/UX review: a
  // stationary finger emits NO touchmove, so the newest movement sample stays
  // frozen where the movement stopped. Measuring velocity across the whole
  // gesture therefore reported a flick that had already ended, and
  // "drag 60px in 100ms, rest a full second, then lift" committed at
  // 0.6px/ms — silently marking a story read from a drag the reader had
  // visibly abandoned.
  const dragThenHold = [
    { x: 0, y: 0, t: 0 },
    { x: 60, y: 0, t: 100 },
  ];

  it("reports no flick when the finger stopped moving long before it lifted", () => {
    const velocity = releaseVelocityX(dragThenHold, { x: 60, y: 0, t: 1100 });

    expect(velocity).toBe(0);
    expect(Math.abs(velocity)).toBeLessThan(COMMIT_VELOCITY_PX_MS);
  });

  it("cancels that paused short drag instead of marking the story read", () => {
    const outcome = classifyGestureEnd({
      axis: "horizontal",
      dx: 60,
      dy: 0,
      velocityX: releaseVelocityX(dragThenHold, { x: 60, y: 0, t: 1100 }),
      // 60px is short of this card's ~117px threshold, so only a genuine
      // flick could have committed it.
      cardWidth: 390,
    });

    expect(outcome).toBe("cancel");
  });

  it("still commits a genuine short flick released while the finger is moving", () => {
    const flick = [
      { x: 0, y: 0, t: 0 },
      { x: 60, y: 0, t: 100 },
    ];
    const outcome = classifyGestureEnd({
      axis: "horizontal",
      dx: 60,
      dy: 0,
      velocityX: releaseVelocityX(flick, { x: 60, y: 0, t: 105 }),
      cardWidth: 390,
    });

    expect(outcome).toBe("commit");
  });

  it("commits a fast flick in either direction, so the fix stays direction-symmetric — criterion 9", () => {
    const leftward = [
      { x: 0, y: 0, t: 0 },
      { x: -60, y: 0, t: 100 },
    ];
    const outcome = classifyGestureEnd({
      axis: "horizontal",
      dx: -60,
      dy: 0,
      velocityX: releaseVelocityX(leftward, { x: -60, y: 0, t: 105 }),
      cardWidth: 390,
    });

    expect(outcome).toBe("commit");
  });

  it("treats an empty sample list as stationary rather than dividing by nothing", () => {
    expect(releaseVelocityX([], { x: 40, y: 0, t: 50 })).toBe(0);
  });

  // Second UI review finding: the same physical flick must be recognized
  // regardless of how many touchmove events the device happened to deliver.
  // Anchoring inside the window made an 80px flick commit with intermediate
  // samples but cancel with only its endpoints, because the opening sample
  // fell outside the window and the surviving one sat at the release
  // position — measuring zero movement across a real flick.
  describe("flick recognition does not depend on touch event delivery rate", () => {
    const release = { x: 80, y: 0, t: 325 };
    const sparse = [
      { x: 0, y: 0, t: 200 },
      { x: 80, y: 0, t: 300 },
    ];
    const dense = [
      { x: 0, y: 0, t: 200 },
      { x: 20, y: 0, t: 225 },
      { x: 40, y: 0, t: 250 },
      { x: 60, y: 0, t: 275 },
      { x: 80, y: 0, t: 300 },
    ];

    it("reports the same flick from sparse and dense samples", () => {
      expect(releaseVelocityX(sparse, release)).toBeCloseTo(releaseVelocityX(dense, release), 5);
    });

    it("commits both, rather than only the densely-sampled one", () => {
      for (const samples of [sparse, dense]) {
        expect(
          classifyGestureEnd({
            axis: "horizontal",
            dx: 80,
            dy: 0,
            velocityX: releaseVelocityX(samples, release),
            cardWidth: 390,
          }),
        ).toBe("commit");
      }
    });
  });

  it("never treats a zero-duration gesture as infinitely fast", () => {
    // Duplicate timestamps (seen in some WebViews) previously rode the 1ms
    // denominator floor up to an enormous velocity, committing a 10px nudge.
    const samples = [{ x: 0, y: 0, t: 500 }];
    const velocity = releaseVelocityX(samples, { x: 10, y: 0, t: 500 });

    expect(velocity).toBe(0);
    expect(
      classifyGestureEnd({ axis: "horizontal", dx: 10, dy: 0, velocityX: velocity, cardWidth: 390 }),
    ).toBe("cancel");
  });
});

describe("touch wiring source guards", () => {
  // No DOM/React test harness exists in this repo (see docs/testing.md) —
  // assert on the source text for the two behaviors a real device can't be
  // simulated for here: non-passive touchmove (required for preventDefault
  // to actually stop native scroll) and the touchend preventDefault that
  // sidesteps Chromium's post-drag click suppression (see the manager's
  // note on useSwipeToRead.ts and SourceSheet's own precedent for this).
  const ts = readFileSync(new URL("../../views/_shared/feed/useSwipeToRead.ts", import.meta.url), "utf8");

  it("registers touchmove non-passive, so it can preventDefault() once axis-lock commits to horizontal", () => {
    expect(ts).toMatch(/addEventListener\("touchmove", onTouchMove, \{ passive: false \}\)/);
  });

  it("registers touchstart passive, letting the browser start a vertical pan with no JS round-trip", () => {
    expect(ts).toMatch(/addEventListener\("touchstart", onTouchStart, \{ passive: true \}\)/);
  });

  it("only fires the mark-read callback for a known-unread card — criteria 10 and 26", () => {
    // Swiping an ALREADY-READ card must be a state no-op (no unmark, since
    // this product has no mark-as-unread anywhere), and a card whose read
    // state is unknown because localStorage is unavailable must not reach
    // the callback either. Both collapse to the same guard: strictly `false`,
    // never a truthy/nullish shortcut that would let `undefined` through.
    const endBody = /function onTouchEnd\(e: TouchEvent\) \{[\s\S]*?\n {4}\}/.exec(ts)?.[0] ?? "";

    expect(endBody).toContain("if (isReadRef.current === false) onSwipeCommitRef.current();");
  });

  it("measures release velocity from the touchend timestamp, not the last movement sample", () => {
    // Guards the UI-review regression above at the wiring level: reverting to
    // velocityX(start, last) here would reintroduce the paused-drag commit
    // even though the pure-function tests above still passed.
    const endBody = /function onTouchEnd\(e: TouchEvent\) \{[\s\S]*?\n {4}\}/.exec(ts)?.[0] ?? "";

    expect(endBody).toContain("t: e.timeStamp");
    expect(endBody).toContain("releaseVelocityX(samplesRef.current, release)");
  });

  it("never calls preventDefault while a gesture axis is still 'pending' or resolved 'vertical'", () => {
    const moveBody = /function onTouchMove\(e: TouchEvent\) \{[\s\S]*?\n {4}\}/.exec(ts)?.[0] ?? "";
    // The only preventDefault() in onTouchMove must appear after the
    // early-return guarding "pending"/"vertical" — i.e. later in the string.
    const guardIndex = moveBody.indexOf('if (axisRef.current !== "horizontal") return;');
    const preventIndex = moveBody.indexOf("e.preventDefault()");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(preventIndex).toBeGreaterThan(guardIndex);
  });
});
