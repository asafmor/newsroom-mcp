import { describe, expect, it } from "vitest";

import {
  activeSegmentIndex,
  formatCoveredDateRange,
  latestDigestEntry,
  podcastStatusLabel,
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

describe("podcastStatusLabel", () => {
  it("labels each known audio status distinctly", () => {
    expect(podcastStatusLabel("ready")).toBe("Ready to play");
    expect(podcastStatusLabel("pending")).toBe("Audio in progress");
    expect(podcastStatusLabel("failed")).toBe("Transcript available");
  });

  it("degrades safely for an unrecognized/future-shaped status rather than throwing", () => {
    // Same "unrecognized audioStatus" edge case PodcastApp.tsx's AudioSection degrades.
    expect(podcastStatusLabel("future-status" as never)).toBe("Transcript available");
  });
});

describe("latestDigestEntry", () => {
  it("summarizes the first (newest) episode, deriving its range from publishedAt", () => {
    const episodes = [
      makeEpisode({ isoWeek: "2026-W37", publishedAt: "2026-09-09T00:00:00.000Z", audioStatus: "ready" }),
      makeEpisode({ isoWeek: "2026-W36", publishedAt: "2026-09-02T00:00:00.000Z", audioStatus: "pending" }),
    ];
    expect(latestDigestEntry(episodes)).toEqual({ label: "Sep 2 – Sep 9, 2026", statusLabel: "Ready to play" });
  });

  it("is undefined when there are no episodes, so the header renders no misleading link", () => {
    expect(latestDigestEntry([])).toBeUndefined();
  });
});
