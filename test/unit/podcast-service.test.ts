import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqlitePodcastRepository } from "../../src/sqlite/sqlite-podcast-repository.js";
import { PodcastService } from "../../src/services/podcast-service.js";
import { PodcastWeekConflictError } from "../../src/repositories/podcast-repository.js";
import { DEFAULT_PODCAST_INSTRUCTIONS, DEFAULT_PODCAST_VOICE } from "../../src/domain/podcast.js";

describe("PodcastService", () => {
  let db: DatabaseSync;
  let service: PodcastService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    service = new PodcastService(new SqlitePodcastRepository(db));
  });

  it("reports no episode and not due when far before the Friday boundary", async () => {
    const status = await service.getStatus(new Date("2026-09-07T00:00:00.000Z"), 5);

    expect(status.currentIsoWeek).toBe("2026-W37");
    expect(status.episodeExists).toBe(false);
    expect(status.due).toBe(false);
    expect(status.recentEpisodes).toEqual([]);
  });

  it("reports due once at/after the Friday 08:00 UTC boundary with no episode yet", async () => {
    const status = await service.getStatus(new Date("2026-09-11T08:00:00.000Z"), 5);
    expect(status.due).toBe(true);
  });

  it("applies default voice/instructions when omitted, and computes the ISO week from the reference time", async () => {
    const episode = await service.submitEpisode(new Date("2026-09-09T00:00:00.000Z"), {
      title: "This week in AI",
      segments: ["Segment one.", "Segment two."],
    });

    expect(episode.isoWeek).toBe("2026-W37");
    expect(episode.voice).toBe(DEFAULT_PODCAST_VOICE);
    expect(episode.instructions).toBe(DEFAULT_PODCAST_INSTRUCTIONS);
    expect(episode.audioState).toBe("pending");
  });

  it("respects an explicit voice/instructions override", async () => {
    const episode = await service.submitEpisode(new Date("2026-09-09T00:00:00.000Z"), {
      title: "This week in AI",
      segments: ["Segment one."],
      voice: "nova",
      instructions: "brisk and energetic",
    });

    expect(episode.voice).toBe("nova");
    expect(episode.instructions).toBe("brisk and energetic");
  });

  it("getStatus reflects episodeExists: true and due: false once an episode is submitted for the current week", async () => {
    const now = new Date("2026-09-11T08:00:00.000Z");
    await service.submitEpisode(now, { title: "This week in AI", segments: ["Segment one."] });

    const status = await service.getStatus(now, 5);
    expect(status.episodeExists).toBe(true);
    expect(status.due).toBe(false);
  });

  it("a second submission for the same ISO week conflicts, and the first is unaffected", async () => {
    const now = new Date("2026-09-09T00:00:00.000Z");
    const first = await service.submitEpisode(now, { title: "First", segments: ["Segment one."] });

    await expect(service.submitEpisode(now, { title: "Second", segments: ["Segment one."] })).rejects.toBeInstanceOf(
      PodcastWeekConflictError,
    );

    const status = await service.getStatus(now, 5);
    expect(status.recentEpisodes).toHaveLength(1);
    expect(status.recentEpisodes[0]?.id).toBe(first.id);
    expect(status.recentEpisodes[0]?.title).toBe("First");
  });

  it("recentEpisodes never includes the transcript (segments)", async () => {
    await service.submitEpisode(new Date("2026-09-09T00:00:00.000Z"), {
      title: "This week in AI",
      segments: ["Should not leak into the status summary."],
    });

    const status = await service.getStatus(new Date("2026-09-09T00:00:00.000Z"), 5);
    expect(status.recentEpisodes[0]).not.toHaveProperty("segments");
  });
});
