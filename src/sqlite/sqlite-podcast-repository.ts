import type { DatabaseSync } from "node:sqlite";
import type { PodcastAudioState, PodcastEpisode, PodcastVoice, SubmitPodcastEpisodeInput } from "../domain/podcast.js";
import { podcastEpisodeId } from "../domain/podcast.js";
import { PodcastWeekConflictError, type PodcastRepository } from "../repositories/podcast-repository.js";

interface PodcastEpisodeRow {
  id: string;
  iso_week: string;
  title: string;
  segments_json: string;
  total_character_count: number;
  voice: string;
  instructions: string;
  submitted_at: string;
  audio_state: string;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export class SqlitePodcastRepository implements PodcastRepository {
  constructor(private readonly db: DatabaseSync) {}

  // async so a synchronous throw (the UNIQUE(iso_week) constraint) surfaces
  // as a rejected promise, matching every other repository in this codebase.
  async create(input: SubmitPodcastEpisodeInput): Promise<PodcastEpisode> {
    const id = podcastEpisodeId(input.isoWeek);
    const now = new Date().toISOString();
    const totalCharacterCount = input.segments.reduce((sum, segment) => sum + segment.length, 0);

    try {
      this.db
        .prepare(
          `INSERT INTO podcast_episodes
            (id, iso_week, title, segments_json, total_character_count, voice, instructions, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.isoWeek,
          input.title,
          JSON.stringify(input.segments),
          totalCharacterCount,
          input.voice,
          input.instructions,
          now,
        );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Two concurrent submissions for the same ISO week: the loser
        // surfaces the winner's already-persisted episode as a clear,
        // catchable conflict rather than a raw storage-layer error.
        const existing = await this.findByIsoWeek(input.isoWeek);
        if (existing) {
          throw new PodcastWeekConflictError(existing);
        }
      }
      throw error;
    }

    return {
      id,
      isoWeek: input.isoWeek,
      title: input.title,
      segments: input.segments,
      totalCharacterCount,
      voice: input.voice,
      instructions: input.instructions,
      submittedAt: new Date(now),
      audioState: "pending",
    };
  }

  findByIsoWeek(isoWeek: string): Promise<PodcastEpisode | null> {
    const row = this.db.prepare("SELECT * FROM podcast_episodes WHERE iso_week = ?").get(isoWeek) as
      | PodcastEpisodeRow
      | undefined;
    return Promise.resolve(row ? this.toDomain(row) : null);
  }

  findRecent(limit: number): Promise<PodcastEpisode[]> {
    const rows = this.db
      .prepare("SELECT * FROM podcast_episodes ORDER BY iso_week DESC LIMIT ?")
      .all(limit) as unknown as PodcastEpisodeRow[];
    return Promise.resolve(rows.map((row) => this.toDomain(row)));
  }

  findAll(): Promise<PodcastEpisode[]> {
    const rows = this.db
      .prepare("SELECT * FROM podcast_episodes ORDER BY iso_week DESC")
      .all() as unknown as PodcastEpisodeRow[];
    return Promise.resolve(rows.map((row) => this.toDomain(row)));
  }

  private toDomain(row: PodcastEpisodeRow): PodcastEpisode {
    return {
      id: row.id,
      isoWeek: row.iso_week,
      title: row.title,
      segments: JSON.parse(row.segments_json) as string[],
      totalCharacterCount: row.total_character_count,
      voice: row.voice as PodcastVoice,
      instructions: row.instructions,
      submittedAt: new Date(row.submitted_at),
      audioState: row.audio_state as PodcastAudioState,
    };
  }
}
