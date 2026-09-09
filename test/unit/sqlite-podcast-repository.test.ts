import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqlitePodcastRepository } from "../../src/sqlite/sqlite-podcast-repository.js";
import { PodcastWeekConflictError } from "../../src/repositories/podcast-repository.js";
import type { SubmitPodcastEpisodeInput } from "../../src/domain/podcast.js";

function makeInput(isoWeek: string, overrides: Partial<SubmitPodcastEpisodeInput> = {}): SubmitPodcastEpisodeInput {
  return {
    isoWeek,
    title: `Episode for ${isoWeek}`,
    segments: ["First segment.", "Second segment."],
    voice: "alloy",
    instructions: "warm, clear, moderate pace, professional newsroom narrator",
    ...overrides,
  };
}

describe("SqlitePodcastRepository", () => {
  let db: DatabaseSync;
  let podcasts: SqlitePodcastRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    podcasts = new SqlitePodcastRepository(db);
  });

  it("creates an episode with id podcast-<isoWeek>, pending audio state, and a computed character count", async () => {
    const episode = await podcasts.create(makeInput("2026-W37"));

    expect(episode.id).toBe("podcast-2026-W37");
    expect(episode.audioState).toBe("pending");
    expect(episode.totalCharacterCount).toBe("First segment.".length + "Second segment.".length);
    expect(episode.submittedAt).toBeInstanceOf(Date);
  });

  it("enforces one episode per ISO week via a real SQL UNIQUE constraint", async () => {
    await podcasts.create(makeInput("2026-W37", { title: "First submission" }));

    await expect(podcasts.create(makeInput("2026-W37", { title: "Second submission" }))).rejects.toBeInstanceOf(
      PodcastWeekConflictError,
    );
  });

  it("surfaces the EXISTING episode on a duplicate-week conflict, not the rejected one", async () => {
    const first = await podcasts.create(makeInput("2026-W37", { title: "First submission" }));

    try {
      await podcasts.create(makeInput("2026-W37", { title: "Second submission" }));
      expect.unreachable("expected a PodcastWeekConflictError");
    } catch (error) {
      expect(error).toBeInstanceOf(PodcastWeekConflictError);
      const conflict = error as PodcastWeekConflictError;
      expect(conflict.existing.id).toBe(first.id);
      expect(conflict.existing.title).toBe("First submission");
      expect(conflict.message).toContain("2026-W37");
      expect(conflict.message).toContain(first.id);
    }
  });

  it("two concurrent submissions for the same week: exactly one persists, the other conflicts", async () => {
    const results = await Promise.allSettled([
      podcasts.create(makeInput("2026-W40", { title: "A" })),
      podcasts.create(makeInput("2026-W40", { title: "B" })),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(PodcastWeekConflictError);

    const all = await podcasts.findAll();
    expect(all.filter((e) => e.isoWeek === "2026-W40")).toHaveLength(1);
  });

  it("findByIsoWeek returns null when no episode exists for that week", async () => {
    expect(await podcasts.findByIsoWeek("2099-W01")).toBeNull();
  });

  it("findRecent returns newest ISO week first, bounded by limit", async () => {
    await podcasts.create(makeInput("2026-W10"));
    await podcasts.create(makeInput("2026-W20"));
    await podcasts.create(makeInput("2026-W15"));

    const recent = await podcasts.findRecent(2);
    expect(recent.map((e) => e.isoWeek)).toEqual(["2026-W20", "2026-W15"]);
  });

  it("findAll returns the full history", async () => {
    await podcasts.create(makeInput("2026-W10"));
    await podcasts.create(makeInput("2026-W20"));

    const all = await podcasts.findAll();
    expect(all).toHaveLength(2);
  });

  it("round-trips segments in order", async () => {
    const segments = ["Story one intro.", "Story one continues.", "Story two."];
    const created = await podcasts.create(makeInput("2026-W22", { segments }));
    const found = await podcasts.findByIsoWeek("2026-W22");

    expect(created.segments).toEqual(segments);
    expect(found?.segments).toEqual(segments);
  });
});
