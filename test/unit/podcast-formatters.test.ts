import { describe, expect, it } from "vitest";

import {
  formatIsoWeekRange,
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

describe("formatIsoWeekRange", () => {
  it("renders a human calendar range for a plain mid-year week, spelling out the month on both sides", () => {
    // 2026-W37 == Mon 2026-09-07 .. Sun 2026-09-13.
    expect(formatIsoWeekRange("2026-W37")).toBe("Sep 7 – Sep 13, 2026");
  });

  it("spells out both months when the week straddles a month boundary", () => {
    // 2026-W36 == Mon 2026-08-31 .. Sun 2026-09-06 — the report's own worked example.
    expect(formatIsoWeekRange("2026-W36")).toBe("Aug 31 – Sep 6, 2026");
  });

  it("spells out both years when the week straddles a year boundary", () => {
    // 2019-W01 == Mon 2018-12-31 .. Sun 2019-01-06.
    expect(formatIsoWeekRange("2019-W01")).toBe("Dec 31, 2018 – Jan 6, 2019");
  });

  it("falls back to the raw id for malformed input instead of throwing", () => {
    expect(formatIsoWeekRange("not-a-week")).toBe("not-a-week");
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
  it("summarizes the first (newest) episode", () => {
    const episodes = [
      makeEpisode({ isoWeek: "2026-W37", audioStatus: "ready" }),
      makeEpisode({ isoWeek: "2026-W36", audioStatus: "pending" }),
    ];
    expect(latestDigestEntry(episodes)).toEqual({ label: "Sep 7 – Sep 13, 2026", statusLabel: "Ready to play" });
  });

  it("is undefined when there are no episodes, so the header renders no misleading link", () => {
    expect(latestDigestEntry([])).toBeUndefined();
  });
});
