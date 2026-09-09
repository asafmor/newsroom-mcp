// Reuses the feed's own staleness window instead of duplicating the number
// here — see the comment on MAX_STORY_AGE_DAYS.
import { MAX_STORY_AGE_DAYS } from "../../../src/shared/story-age.js";
import type { PodcastAudioStatus, PodcastEpisode } from "./types.js";

const DATE_OPTS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
const DATE_WITH_YEAR_OPTS: Intl.DateTimeFormatOptions = { ...DATE_OPTS, year: "numeric" };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Human calendar range an episode actually covers, e.g. "Sep 2 – Sep 9,
 * 2026" — derived from the episode's OWN `publishedAt`, NOT the calendar
 * ISO week. The ISO week can start before the covered content and even end
 * in the future (an episode submitted mid-week, which is normal — "due" is
 * advisory only, see src/shared/iso-week.ts). What an episode actually
 * summarizes is whatever the curating agent's get-feed/get-active-stories
 * call considered fresh right before it wrote the script: stories
 * meaningfully updated within `MAX_STORY_AGE_DAYS` of `publishedAt`. Falls
 * back to the raw string if it's unparseable (defensive only; the server
 * always produces a well-formed ISO timestamp).
 */
export function formatCoveredDateRange(publishedAt: string): string {
  const end = new Date(publishedAt);
  if (Number.isNaN(end.getTime())) return publishedAt;

  const start = new Date(end.getTime() - MAX_STORY_AGE_DAYS * MS_PER_DAY);
  const startLabel = start.toLocaleDateString("en-US", DATE_OPTS);

  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    // Rare (a window straddling New Year's) — spell out both years so neither side is ambiguous.
    return `${startLabel}, ${String(start.getUTCFullYear())} – ${end.toLocaleDateString("en-US", DATE_WITH_YEAR_OPTS)}`;
  }
  return `${startLabel} – ${end.toLocaleDateString("en-US", DATE_WITH_YEAR_OPTS)}`;
}

/**
 * Estimates which transcript segment is currently being narrated, assuming
 * narration speed is constant across the episode (segment i's start time =
 * durationSeconds * (chars before i / total chars)). Returns -1 for "none
 * active" (also the safe result whenever there's nothing sensible to
 * compute). Pure and driven entirely by the caller's own inputs — no wall
 * clock, no internal state — so it's correct for free under pause/seek/scrub
 * when wired to the `<audio>` element's `currentTime` via `onTimeUpdate`.
 *
 * ponytail: this is a character-proportional estimate, not a real
 * timestamp — it drifts on TTS sentence pauses and spelled-out
 * numbers/acronyms. Upgrade path: record real per-chunk ffprobe offsets in
 * podcast.json and look those up instead.
 */
export function activeSegmentIndex(
  currentTimeSeconds: number,
  durationSeconds: number,
  segments: readonly string[],
): number {
  if (durationSeconds <= 0 || segments.length === 0) return -1;

  const totalChars = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalChars === 0) return -1;

  const clampedTime = Math.min(Math.max(currentTimeSeconds, 0), durationSeconds);

  let cumulativeChars = 0;
  let active = 0;
  for (const [index, segment] of segments.entries()) {
    const startTime = durationSeconds * (cumulativeChars / totalChars);
    if (clampedTime < startTime) break;
    active = index;
    cumulativeChars += segment.length;
  }
  return active;
}

/**
 * Compact status label for the header entry point. `status` is typed as the
 * closed union, but this still degrades safely (falls through to the
 * default) for an unrecognized/future-shaped value at runtime — the same
 * edge case PodcastApp.tsx's AudioSection already handles, since
 * `podcast.json` is fetched, unvalidated JSON, not something the type
 * system actually enforces at runtime.
 */
export function podcastStatusLabel(status: PodcastAudioStatus): string {
  switch (status) {
    case "ready":
      return "Ready to play";
    case "pending":
      return "Audio in progress";
    case "failed":
      return "Transcript available";
    default:
      return "Transcript available";
  }
}

export interface DigestEntrySummary {
  readonly label: string;
  readonly statusLabel: string;
}

/**
 * Compact summary of the most recent episode for the site header's "Weekly
 * digest" entry point (see FeedHeader.tsx's `digestEntry` prop) — episodes
 * are already newest-first per podcast.json's contract, so the first entry
 * is the latest. `undefined` when there's no episode yet, so the caller
 * renders nothing rather than a misleading link.
 */
export function latestDigestEntry(episodes: readonly PodcastEpisode[]): DigestEntrySummary | undefined {
  if (episodes.length === 0) return undefined;
  const latest = episodes[0];
  return { label: formatCoveredDateRange(latest.publishedAt), statusLabel: podcastStatusLabel(latest.audioStatus) };
}
