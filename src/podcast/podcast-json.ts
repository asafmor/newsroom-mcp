// The `podcast.json` state machine: merge-only reads/writes shared by
// `scripts/publish-podcast.ts` (D.18 — adds new episodes as `pending`) and
// `scripts/synthesize-podcast.ts` (D.19 — moves one episode to
// `ready`/`failed`). Neither writer ever overwrites the whole file; both
// only ever add-or-patch, so the three independent writers to the `feed`
// branch (feed publish, site deploy, podcast publish/synthesis) can never
// clobber each other's work even under push contention (see
// docs/mcp-tools.md).
import { z } from "zod";

import type { PodcastEpisode } from "../domain/podcast.js";
import { PODCAST_HISTORY_WINDOW } from "../domain/podcast.js";

const podcastJsonAudioSchema = z.object({
  url: z.string(),
  durationSeconds: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string(),
});

/**
 * The published episode shape. Carries `instructions` in addition to the
 * fields shown in the requirements' schema example: Phase 2 runs entirely
 * outside the MCP server process (E.24/F.37) with no access to the
 * database, so the STORED tone/instructions text (F.31 — resent unchanged
 * on every chunk of an episode) has to travel through `podcast.json`
 * itself, the only thing Phase 2 reads. See the developer notes in the PR
 * description for this deliberate, necessary addition to the schema.
 */
export const podcastJsonEpisodeSchema = z.object({
  id: z.string(),
  isoWeek: z.string(),
  title: z.string(),
  publishedAt: z.string(),
  segments: z.array(z.string()),
  totalCharacterCount: z.number().int().nonnegative(),
  voice: z.string(),
  instructions: z.string(),
  audioStatus: z.enum(["pending", "ready", "failed"]),
  audio: podcastJsonAudioSchema.nullable(),
  failureReason: z.string().nullable(),
});
export type PodcastJsonEpisode = z.infer<typeof podcastJsonEpisodeSchema>;

export const podcastJsonFileSchema = z.object({
  generatedAt: z.string(),
  episodes: z.array(podcastJsonEpisodeSchema),
});
export type PodcastJsonFile = z.infer<typeof podcastJsonFileSchema>;

/** Parses `podcast.json`'s text content. Throws on malformed JSON/shape — a missing file is a distinct, separate case callers must handle themselves (it is not "empty content"). */
export function parsePodcastJson(text: string): PodcastJsonFile {
  return podcastJsonFileSchema.parse(JSON.parse(text));
}

function sortNewestIsoWeekFirst(episodes: PodcastJsonEpisode[]): PodcastJsonEpisode[] {
  return [...episodes].sort((a, b) => (a.isoWeek < b.isoWeek ? 1 : a.isoWeek > b.isoWeek ? -1 : 0));
}

/**
 * D.18: adds any database episode not already present (by id) as `pending`,
 * leaves every already-published episode's audio state/metadata UNTOUCHED
 * (even if the database still only knows it as `pending` — the published
 * file is the source of truth for audio state once Phase 2 has run), sorts
 * newest ISO week first, and trims to `PODCAST_HISTORY_WINDOW`. Trimming
 * only ever affects what's published here — never the database, `feed`
 * branch git history, or the underlying Release.
 */
export function mergeNewEpisodes(
  current: PodcastJsonFile | undefined,
  dbEpisodes: readonly PodcastEpisode[],
  now: Date,
): PodcastJsonFile {
  const byId = new Map((current?.episodes ?? []).map((episode) => [episode.id, episode]));

  for (const episode of dbEpisodes) {
    if (!byId.has(episode.id)) {
      byId.set(episode.id, {
        id: episode.id,
        isoWeek: episode.isoWeek,
        title: episode.title,
        publishedAt: episode.submittedAt.toISOString(),
        segments: [...episode.segments],
        totalCharacterCount: episode.totalCharacterCount,
        voice: episode.voice,
        instructions: episode.instructions,
        audioStatus: "pending",
        audio: null,
        failureReason: null,
      });
    }
  }

  const sorted = sortNewestIsoWeekFirst([...byId.values()]).slice(0, PODCAST_HISTORY_WINDOW);

  // Nothing actually new: return `current` verbatim (same `generatedAt`) so
  // the publish script's textual diff sees no change and skips the commit —
  // otherwise a fresh `now` on every run would make an unrelated,
  // content-free "update" look like a real change every time this runs.
  if (current !== undefined && JSON.stringify(current.episodes) === JSON.stringify(sorted)) {
    return current;
  }

  return { generatedAt: now.toISOString(), episodes: sorted };
}

export type AudioResult =
  | { readonly audioStatus: "ready"; readonly audio: PodcastJsonEpisode["audio"] }
  | { readonly audioStatus: "failed"; readonly failureReason: string };

/**
 * D.19: rewrites only `episodeId`'s audioStatus/audio/failureReason,
 * leaving every other episode's fields untouched. `episodeId` is expected
 * to already be present (Phase 2 only ever processes episodes it found in
 * `podcast.json` in the first place, see E.26) — if it's genuinely absent
 * (already trimmed out, or the file is missing), this is a no-op on that
 * episode, not an error, since there's nothing meaningful to patch.
 */
export function applyAudioResult(
  current: PodcastJsonFile | undefined,
  episodeId: string,
  result: AudioResult,
  now: Date,
): PodcastJsonFile {
  const episodes = (current?.episodes ?? []).map((episode) => {
    if (episode.id !== episodeId) return episode;

    return {
      ...episode,
      audioStatus: result.audioStatus,
      audio: result.audioStatus === "ready" ? result.audio : null,
      failureReason: result.audioStatus === "failed" ? result.failureReason : null,
    };
  });

  // Same no-real-change guard as mergeNewEpisodes — an idempotent retry
  // that lands on an already-applied result must not churn `generatedAt`
  // (and therefore the commit history) for no actual content change.
  if (current !== undefined && JSON.stringify(current.episodes) === JSON.stringify(episodes)) {
    return current;
  }

  return { generatedAt: now.toISOString(), episodes };
}
