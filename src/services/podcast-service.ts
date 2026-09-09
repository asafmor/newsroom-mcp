import type { PodcastAudioState, PodcastEpisode, PodcastVoice } from "../domain/podcast.js";
import { DEFAULT_PODCAST_INSTRUCTIONS, DEFAULT_PODCAST_VOICE } from "../domain/podcast.js";
import type { PodcastRepository } from "../repositories/podcast-repository.js";
import { isDueForCurrentWeek, isoWeekId } from "../shared/iso-week.js";

export interface PodcastEpisodeSummary {
  readonly id: string;
  readonly isoWeek: string;
  readonly title: string;
  readonly audioState: PodcastAudioState;
  readonly submittedAt: Date;
}

export interface PodcastStatus {
  readonly currentIsoWeek: string;
  readonly episodeExists: boolean;
  readonly due: boolean;
  readonly recentEpisodes: PodcastEpisodeSummary[];
}

export interface SubmitPodcastEpisodeServiceInput {
  readonly title: string;
  /** Already trimmed/validated by `submitPodcastEpisodeInputSchema` — this service does not re-validate segment shape. */
  readonly segments: string[];
  readonly voice?: PodcastVoice;
  readonly instructions?: string;
}

/**
 * Owns the weekly podcast episode's Phase-1 lifecycle: reporting whether
 * this ISO week is due for a script, and persisting one once submitted.
 * Segment/length validation lives in `submitPodcastEpisodeInputSchema`
 * (Zod, at the tool boundary) — this service only computes the ISO week
 * and applies voice/instructions defaults before delegating to the
 * repository, which is the sole enforcer of one-episode-per-week.
 */
export class PodcastService {
  constructor(private readonly podcasts: PodcastRepository) {}

  async getStatus(now: Date, limit: number): Promise<PodcastStatus> {
    const currentIsoWeek = isoWeekId(now);
    const [existing, recent] = await Promise.all([
      this.podcasts.findByIsoWeek(currentIsoWeek),
      this.podcasts.findRecent(limit),
    ]);

    return {
      currentIsoWeek,
      episodeExists: existing !== null,
      due: isDueForCurrentWeek(now, existing !== null),
      recentEpisodes: recent.map((episode) => summarize(episode)),
    };
  }

  /**
   * `PodcastWeekConflictError` (a duplicate-week conflict) propagates
   * as-is — its message already identifies the existing episode's id/ISO
   * week, so it's already the "clear, non-crashing error" the submission
   * tool needs, not a raw storage-layer error.
   */
  async submitEpisode(now: Date, input: SubmitPodcastEpisodeServiceInput): Promise<PodcastEpisode> {
    const isoWeek = isoWeekId(now);

    return this.podcasts.create({
      isoWeek,
      title: input.title,
      segments: input.segments,
      voice: input.voice ?? DEFAULT_PODCAST_VOICE,
      instructions: input.instructions ?? DEFAULT_PODCAST_INSTRUCTIONS,
    });
  }
}

function summarize(episode: PodcastEpisode): PodcastEpisodeSummary {
  return {
    id: episode.id,
    isoWeek: episode.isoWeek,
    title: episode.title,
    audioState: episode.audioState,
    submittedAt: episode.submittedAt,
  };
}
