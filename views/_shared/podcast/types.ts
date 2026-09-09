// Shared between the standalone site (site/src/main.tsx) and any future MCP
// View — structurally compatible with the published podcast.json snapshot
// (src/podcast/podcast-json.ts's PodcastJsonEpisode). Only the fields the
// UI actually reads.
export type PodcastAudioStatus = "pending" | "ready" | "failed";

export interface PodcastAudio {
  readonly url: string;
  readonly durationSeconds: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

export interface PodcastEpisode {
  readonly id: string;
  readonly isoWeek: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly segments: readonly string[];
  readonly totalCharacterCount: number;
  readonly voice: string;
  readonly audioStatus: PodcastAudioStatus;
  readonly audio: PodcastAudio | null;
  readonly failureReason: string | null;
}
