import type { PodcastEpisode, SubmitPodcastEpisodeInput } from "../domain/podcast.js";

/** Thrown by `create` when an episode for that ISO week already exists — see the `UNIQUE (iso_week)` constraint. */
export class PodcastWeekConflictError extends Error {
  constructor(public readonly existing: PodcastEpisode) {
    super(`An episode already exists for ISO week ${existing.isoWeek} (id: ${existing.id}).`);
    this.name = "PodcastWeekConflictError";
  }
}

/**
 * Persistence for weekly podcast episodes. `create` is the only write this
 * PR needs — an episode's script is immutable once submitted (no
 * update/delete), and Phase 2's audio-state transitions live entirely in
 * the published `podcast.json`, never back in this table (see
 * docs/mcp-tools.md).
 */
export interface PodcastRepository {
  /** Throws `PodcastWeekConflictError` if an episode for `input.isoWeek` already exists. */
  create(input: SubmitPodcastEpisodeInput): Promise<PodcastEpisode>;

  findByIsoWeek(isoWeek: string): Promise<PodcastEpisode | null>;

  /** Most recent episodes, newest ISO week first, bounded by `limit`. */
  findRecent(limit: number): Promise<PodcastEpisode[]>;

  /** Full episode history, newest first — used by `scripts/publish-podcast.ts` to merge into `podcast.json`. */
  findAll(): Promise<PodcastEpisode[]>;
}
