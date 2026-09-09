import { describe, expect, it } from "vitest";

import type { PodcastEpisode } from "../../src/domain/podcast.js";
import { PODCAST_HISTORY_WINDOW } from "../../src/domain/podcast.js";
import { applyAudioResult, mergeNewEpisodes, type PodcastJsonFile } from "../../src/podcast/podcast-json.js";

function dbEpisode(isoWeek: string, overrides: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: `podcast-${isoWeek}`,
    isoWeek,
    title: `Episode ${isoWeek}`,
    segments: ["one", "two"],
    totalCharacterCount: 6,
    voice: "alloy",
    instructions: "warm, clear, moderate pace, professional newsroom narrator",
    submittedAt: new Date("2026-01-01T00:00:00.000Z"),
    audioState: "pending",
    ...overrides,
  };
}

describe("mergeNewEpisodes", () => {
  it("treats a missing file as an empty episode list, not an error", () => {
    const result = mergeNewEpisodes(undefined, [dbEpisode("2026-W10")], new Date("2026-01-02T00:00:00.000Z"));
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]?.id).toBe("podcast-2026-W10");
    expect(result.episodes[0]?.audioStatus).toBe("pending");
    expect(result.episodes[0]?.audio).toBeNull();
  });

  it("adds a new database episode not already present, as pending", () => {
    const current: PodcastJsonFile = { generatedAt: "2026-01-01T00:00:00.000Z", episodes: [] };
    const result = mergeNewEpisodes(current, [dbEpisode("2026-W11")], new Date("2026-01-02T00:00:00.000Z"));

    expect(result.episodes.map((e) => e.id)).toEqual(["podcast-2026-W11"]);
  });

  it("NEVER regresses an already-published episode's audio state/metadata, even though the database still shows pending", () => {
    const current: PodcastJsonFile = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      episodes: [
        {
          id: "podcast-2026-W10",
          isoWeek: "2026-W10",
          title: "Original title",
          publishedAt: "2026-01-01T00:00:00.000Z",
          segments: ["one"],
          totalCharacterCount: 3,
          voice: "alloy",
          instructions: "x",
          audioStatus: "ready",
          audio: { url: "https://example.com/ep.mp3", durationSeconds: 300, sizeBytes: 12345, mimeType: "audio/mpeg" },
          failureReason: null,
        },
      ],
    };

    const result = mergeNewEpisodes(current, [dbEpisode("2026-W10")], new Date("2026-01-05T00:00:00.000Z"));

    expect(result.episodes[0]?.audioStatus).toBe("ready");
    expect(result.episodes[0]?.audio).toEqual({
      url: "https://example.com/ep.mp3",
      durationSeconds: 300,
      sizeBytes: 12345,
      mimeType: "audio/mpeg",
    });
  });

  it("sorts episodes newest ISO week first", () => {
    const result = mergeNewEpisodes(
      undefined,
      [dbEpisode("2026-W10"), dbEpisode("2026-W30"), dbEpisode("2026-W20")],
      new Date("2026-01-02T00:00:00.000Z"),
    );
    expect(result.episodes.map((e) => e.isoWeek)).toEqual(["2026-W30", "2026-W20", "2026-W10"]);
  });

  it(`trims the published list to the most recent ${String(PODCAST_HISTORY_WINDOW)}, never affecting the input db episodes array`, () => {
    const many = Array.from({ length: PODCAST_HISTORY_WINDOW + 5 }, (_, i) =>
      dbEpisode(`2026-W${String(i + 1).padStart(2, "0")}`),
    );
    const result = mergeNewEpisodes(undefined, many, new Date("2026-12-31T00:00:00.000Z"));

    expect(result.episodes).toHaveLength(PODCAST_HISTORY_WINDOW);
    expect(many).toHaveLength(PODCAST_HISTORY_WINDOW + 5);
    // Newest (highest week number) survive the trim.
    expect(result.episodes[0]?.isoWeek).toBe(`2026-W${String(PODCAST_HISTORY_WINDOW + 5).padStart(2, "0")}`);
  });

  it("returns the input unchanged (same generatedAt) when nothing actually changed", () => {
    const current = mergeNewEpisodes(undefined, [dbEpisode("2026-W10")], new Date("2026-01-01T00:00:00.000Z"));
    const again = mergeNewEpisodes(current, [dbEpisode("2026-W10")], new Date("2026-06-01T00:00:00.000Z"));

    expect(again.generatedAt).toBe(current.generatedAt);
  });
});

describe("applyAudioResult", () => {
  const base: PodcastJsonFile = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    episodes: [
      {
        id: "podcast-2026-W10",
        isoWeek: "2026-W10",
        title: "Episode A",
        publishedAt: "2026-01-01T00:00:00.000Z",
        segments: ["one"],
        totalCharacterCount: 3,
        voice: "alloy",
        instructions: "x",
        audioStatus: "pending",
        audio: null,
        failureReason: null,
      },
      {
        id: "podcast-2026-W11",
        isoWeek: "2026-W11",
        title: "Episode B",
        publishedAt: "2026-01-08T00:00:00.000Z",
        segments: ["two"],
        totalCharacterCount: 3,
        voice: "alloy",
        instructions: "x",
        audioStatus: "pending",
        audio: null,
        failureReason: null,
      },
    ],
  };

  it("rewrites only the target episode's audioStatus/audio, leaving every other episode's fields untouched", () => {
    const result = applyAudioResult(
      base,
      "podcast-2026-W10",
      { audioStatus: "ready", audio: { url: "https://x/y.mp3", durationSeconds: 100, sizeBytes: 999, mimeType: "audio/mpeg" } },
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result.episodes[0]?.audioStatus).toBe("ready");
    expect(result.episodes[0]?.audio?.url).toBe("https://x/y.mp3");
    expect(result.episodes[1]).toEqual(base.episodes[1]);
  });

  it("sets failureReason on failure and clears audio", () => {
    const result = applyAudioResult(
      base,
      "podcast-2026-W11",
      { audioStatus: "failed", failureReason: "ffmpeg concatenation failed" },
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result.episodes[1]?.audioStatus).toBe("failed");
    expect(result.episodes[1]?.failureReason).toBe("ffmpeg concatenation failed");
    expect(result.episodes[1]?.audio).toBeNull();
    expect(result.episodes[0]).toEqual(base.episodes[0]);
  });

  it("is a no-op on episodes when the target id is absent", () => {
    const result = applyAudioResult(
      base,
      "podcast-does-not-exist",
      { audioStatus: "ready", audio: { url: "u", durationSeconds: 1, sizeBytes: 1, mimeType: "audio/mpeg" } },
      new Date("2026-01-10T00:00:00.000Z"),
    );
    expect(result.episodes).toEqual(base.episodes);
  });
});
