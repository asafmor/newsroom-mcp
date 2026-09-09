/**
 * A weekly, AI-narrated audio digest — one immutable script per ISO
 * calendar week (see `src/shared/iso-week.ts`), authored by the curating
 * AI agent (Phase 1, `PodcastService`) and turned into real speech by a
 * fully mechanical, out-of-process pipeline (Phase 2, `src/podcast/`). See
 * docs/mcp-tools.md and docs/sqlite-schema.md.
 */
export type PodcastAudioState = "pending" | "ready" | "failed";

/**
 * Small closed set of OpenAI TTS voices this feature may request — see
 * docs/mcp-tools.md. Deliberately not the full upstream list: a curated
 * subset keeps the submission tool's input simple.
 */
export const PODCAST_VOICES = ["alloy", "echo", "nova", "shimmer"] as const;
export type PodcastVoice = (typeof PODCAST_VOICES)[number];
export const DEFAULT_PODCAST_VOICE: PodcastVoice = "alloy";

export const DEFAULT_PODCAST_INSTRUCTIONS = "warm, clear, moderate pace, professional newsroom narrator";

export const PODCAST_TITLE_MAX_LENGTH = 140;
export const PODCAST_INSTRUCTIONS_MAX_LENGTH = 500;

/**
 * Per-segment character cap. Fixed well below the TTS API's hard 4096-char
 * per-request limit (see `src/podcast/chunking.ts`) so a chunk built by
 * greedily packing whole segments can never itself exceed that limit —
 * by construction, not by truncation.
 */
export const PODCAST_SEGMENT_MAX_CHARS = 1500;
export const PODCAST_MAX_SEGMENTS = 60;

/** ~150 wpm x 5-10 minutes x ~6 chars/word. */
export const PODCAST_TOTAL_MIN_CHARS = 4500;
export const PODCAST_TOTAL_MAX_CHARS = 9000;

export const PODCAST_STATUS_DEFAULT_LIMIT = 5;
export const PODCAST_STATUS_MAX_LIMIT = 20;

/** Published episode history window — see docs/mcp-tools.md and `src/podcast/podcast-json.ts`. */
export const PODCAST_HISTORY_WINDOW = 26;

export interface PodcastAudioMetadata {
  readonly url: string;
  readonly durationSeconds: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

export interface PodcastEpisode {
  readonly id: string;
  readonly isoWeek: string;
  readonly title: string;
  readonly segments: readonly string[];
  readonly totalCharacterCount: number;
  readonly voice: PodcastVoice;
  readonly instructions: string;
  readonly submittedAt: Date;
  /**
   * Always "pending" for a row read back from the database in this PR:
   * Phase 2 (mechanical TTS synthesis) never writes back to the database,
   * only to the published `podcast.json` snapshot — the database is the
   * source of truth for script content, the published file is the source
   * of truth for audio state once Phase 2 has run. See docs/mcp-tools.md.
   */
  readonly audioState: PodcastAudioState;
  readonly audio?: PodcastAudioMetadata;
  readonly failureReason?: string;
}

export interface SubmitPodcastEpisodeInput {
  readonly isoWeek: string;
  readonly title: string;
  readonly segments: readonly string[];
  readonly voice: PodcastVoice;
  readonly instructions: string;
}

/** Shared identifier format for the database row, `podcast.json` entry, and GitHub Release tag. */
export function podcastEpisodeId(isoWeek: string): string {
  return `podcast-${isoWeek}`;
}
