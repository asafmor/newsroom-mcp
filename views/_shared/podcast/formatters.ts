// Reuses the server-side ISO-week date math (src/shared/iso-week.ts) for
// display purposes instead of hand-rolling date arithmetic here — this file
// only adds locale/text formatting on top of it.
import { isoWeekDateRange, parseIsoWeekId } from "../../../src/shared/iso-week.js";
import type { PodcastAudioStatus, PodcastEpisode } from "./types.js";

const DATE_OPTS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
const DATE_WITH_YEAR_OPTS: Intl.DateTimeFormatOptions = { ...DATE_OPTS, year: "numeric" };

/**
 * Human calendar range for an ISO week id, e.g. "Aug 31 – Sep 6, 2026" — see
 * criterion 47's requirement that covered dates be understandable without
 * opening a transcript or consulting a calendar. Falls back to the raw id
 * if it's malformed (defensive only; the server always produces a
 * well-formed id).
 */
export function formatIsoWeekRange(isoWeekId: string): string {
  const parsed = parseIsoWeekId(isoWeekId);
  if (parsed === undefined) return isoWeekId;

  const { start, end } = isoWeekDateRange(parsed.isoYear, parsed.isoWeek);
  const startLabel = start.toLocaleDateString("en-US", DATE_OPTS);

  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    // Rare (a week straddling New Year's) — spell out both years so neither side is ambiguous.
    return `${startLabel}, ${String(start.getUTCFullYear())} – ${end.toLocaleDateString("en-US", DATE_WITH_YEAR_OPTS)}`;
  }
  return `${startLabel} – ${end.toLocaleDateString("en-US", DATE_WITH_YEAR_OPTS)}`;
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
  return { label: formatIsoWeekRange(latest.isoWeek), statusLabel: podcastStatusLabel(latest.audioStatus) };
}
