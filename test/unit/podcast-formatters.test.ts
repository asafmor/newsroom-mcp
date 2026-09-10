import { describe, expect, it } from "vitest";

import {
  activeSegmentIndex,
  formatCoveredDateRange,
  latestDigestEntry,
} from "../../views/_shared/podcast/formatters.js";
import type { PodcastEpisode } from "../../views/_shared/podcast/types.js";

function makeEpisode(overrides: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: "podcast-2026-W36",
    isoWeek: "2026-W36",
    title: "AI news, week of Aug 31",
    publishedAt: "2026-09-04T12:00:00.000Z",
    segments: ["Segment one.", "Segment two."],
    totalCharacterCount: 26,
    voice: "alloy",
    audioStatus: "pending",
    audio: null,
    failureReason: null,
    ...overrides,
  };
}

describe("formatCoveredDateRange", () => {
  it("spans the 7 days before publishedAt (MAX_STORY_AGE_DAYS), ending ON publishedAt's own date", () => {
    // The episode's own submission day, not a calendar ISO week — see the
    // P2 UI-review finding this replaces (the old range could start after
    // the covered content and end days in the future).
    expect(formatCoveredDateRange("2026-09-09T00:00:00.000Z")).toBe("Sep 2 – Sep 9, 2026");
  });

  it("spells out both months when the window straddles a month boundary", () => {
    expect(formatCoveredDateRange("2026-09-03T00:00:00.000Z")).toBe("Aug 27 – Sep 3, 2026");
  });

  it("spells out both years when the window straddles a year boundary", () => {
    expect(formatCoveredDateRange("2019-01-02T00:00:00.000Z")).toBe("Dec 26, 2018 – Jan 2, 2019");
  });

  it("falls back to the raw string for an unparseable publishedAt instead of throwing", () => {
    expect(formatCoveredDateRange("not-a-date")).toBe("not-a-date");
  });
});

describe("activeSegmentIndex", () => {
  const segments = ["a".repeat(10), "b".repeat(30), "c".repeat(10)]; // starts (of 50 total chars): 0, 20, 80 (of 100s duration)

  it("picks the segment whose char-proportional start time has passed", () => {
    expect(activeSegmentIndex(0, 100, segments)).toBe(0);
    expect(activeSegmentIndex(19, 100, segments)).toBe(0);
    expect(activeSegmentIndex(20, 100, segments)).toBe(1);
    expect(activeSegmentIndex(79, 100, segments)).toBe(1);
    expect(activeSegmentIndex(80, 100, segments)).toBe(2);
  });

  it("clamps to the last segment when currentTime is beyond duration", () => {
    expect(activeSegmentIndex(500, 100, segments)).toBe(2);
  });

  it("clamps a negative currentTime to the first segment", () => {
    expect(activeSegmentIndex(-5, 100, segments)).toBe(0);
  });

  it("returns -1 for a zero/negative duration rather than dividing by zero", () => {
    expect(activeSegmentIndex(10, 0, segments)).toBe(-1);
    expect(activeSegmentIndex(10, -1, segments)).toBe(-1);
  });

  it("returns -1 for an empty segment list", () => {
    expect(activeSegmentIndex(10, 100, [])).toBe(-1);
  });

  it("returns -1 when every segment is empty (zero total characters)", () => {
    expect(activeSegmentIndex(10, 100, ["", ""])).toBe(-1);
  });
});

describe("latestDigestEntry (P1-b UI-review finding: compact/full/accent/aria shape)", () => {
  it("summarizes a 'ready' episode with a short compact date, the full covered range, and an accent cue", () => {
    const episodes = [
      makeEpisode({ isoWeek: "2026-W37", publishedAt: "2026-09-09T00:00:00.000Z", audioStatus: "ready" }),
      makeEpisode({ isoWeek: "2026-W36", publishedAt: "2026-09-02T00:00:00.000Z", audioStatus: "pending" }),
    ];
    expect(latestDigestEntry(episodes)).toEqual({
      compactSupporting: "Sep 9 · Ready",
      fullSupporting: "Sep 2 – Sep 9, 2026 · Ready",
      accentSupporting: true,
      ariaLabel: "Weekly podcast, Sep 2 – Sep 9, 2026, ready to play",
    });
  });

  it("summarizes a 'pending' episode as preparing, with no accent", () => {
    const episodes = [makeEpisode({ audioStatus: "pending" })];
    expect(latestDigestEntry(episodes)).toEqual({
      compactSupporting: "Preparing audio",
      fullSupporting: "Preparing audio",
      accentSupporting: false,
      ariaLabel: "Weekly podcast, preparing audio",
    });
  });

  it("summarizes a 'failed' episode by pointing at the transcript, with no accent", () => {
    const episodes = [makeEpisode({ audioStatus: "failed" })];
    expect(latestDigestEntry(episodes)).toEqual({
      compactSupporting: "Read transcript",
      fullSupporting: "Read transcript",
      accentSupporting: false,
      ariaLabel: "Weekly podcast, read the transcript",
    });
  });

  it("degrades an unrecognized/future-shaped status the same way as 'failed', rather than throwing", () => {
    // Same "unrecognized audioStatus" edge case PodcastApp.tsx's AudioSection degrades.
    const episodes = [makeEpisode({ audioStatus: "future-status" as never })];
    expect(latestDigestEntry(episodes)).toEqual({
      compactSupporting: "Read transcript",
      fullSupporting: "Read transcript",
      accentSupporting: false,
      ariaLabel: "Weekly podcast, read the transcript",
    });
  });

  it("summarizes the first (newest) episode when several exist", () => {
    const episodes = [
      makeEpisode({ isoWeek: "2026-W37", publishedAt: "2026-09-09T00:00:00.000Z", audioStatus: "pending" }),
      makeEpisode({ isoWeek: "2026-W36", publishedAt: "2026-09-02T00:00:00.000Z", audioStatus: "ready" }),
    ];
    expect(latestDigestEntry(episodes)?.compactSupporting).toBe("Preparing audio");
  });

  it("is undefined when there are no episodes, so the header renders no misleading link", () => {
    expect(latestDigestEntry([])).toBeUndefined();
  });
});
