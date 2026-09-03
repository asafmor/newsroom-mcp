import type { FeedStory, StoryContribution, StoryTag } from "./types.js";

// World-time, not ingest-time: a story's sources may be reported at different
// moments, so "latest"/"earliest" reflects when the news actually happened
// rather than a server-side ingest timestamp.
export function latestPublishedAt(story: FeedStory): string {
  return story.sources.reduce((max, s) => (s.publishedAt > max ? s.publishedAt : max), story.sources[0].publishedAt);
}
export function earliestPublishedAt(story: FeedStory): string {
  return story.sources.reduce((min, s) => (s.publishedAt < min ? s.publishedAt : min), story.sources[0].publishedAt);
}

/**
 * How many attached sources reported a genuinely new development. A story
 * starts at 0 — create-story attaches its seed items as "supporting" — so any
 * non-zero count means the story has moved since it was first published.
 * Sources from an older feed.json carry no contribution and count as 0.
 */
export function developmentCount(story: FeedStory): number {
  return story.sources.filter((s) => s.contribution === "meaningful-update").length;
}

/** Short reader-facing label for a source's role, or undefined for the unremarkable cases. */
export function contributionLabel(contribution: StoryContribution | undefined): string | undefined {
  if (contribution === "meaningful-update") return "New development";
  if (contribution === "background") return "Background";
  return undefined;
}

/** A story's tags, defaulting to `[]` for a pre-tags feed.json snapshot. */
export function storyTags(story: FeedStory): readonly StoryTag[] {
  return story.tags ?? [];
}

/** Tag values actually present across the loaded stories, sorted — mirrors how the provider filter's options are derived. */
export function availableTags(stories: readonly FeedStory[]): StoryTag[] {
  return [...new Set(stories.flatMap((s) => storyTags(s)))].sort();
}

/**
 * Whether a story passes all three active header filters, ANDed together.
 * "all" applies no filtering for that dimension.
 */
export function storyMatchesFilters(
  story: FeedStory,
  filters: { readonly providerFilter: string; readonly tagFilter: string; readonly search: string },
): boolean {
  const matchesProvider =
    filters.providerFilter === "all" || story.sources.some((src) => src.providerName === filters.providerFilter);
  const matchesTag = filters.tagFilter === "all" || storyTags(story).some((tag) => tag === filters.tagFilter);
  const query = filters.search.trim().toLowerCase();
  const matchesSearch =
    query === "" || story.title.toLowerCase().includes(query) || story.summary.toLowerCase().includes(query);
  return matchesProvider && matchesTag && matchesSearch;
}

/**
 * Read-id set as it should be after pruning against the currently loaded
 * feed — drops any stored id no longer present (story archived, merged
 * away, or just aged out of the ~50-item feed.json), so storage never grows
 * past what's currently loaded. Order-independent, deduplicated.
 */
export function pruneReadIds(storedIds: readonly string[], currentFeedIds: readonly string[]): string[] {
  const current = new Set(currentFeedIds);
  return [...new Set(storedIds)].filter((id) => current.has(id));
}

/**
 * How many of the given stories are NOT in the read-id set — always over
 * the full loaded list, never a filtered/searched subset (see design
 * decision #1: filters are transient view state and must not move this
 * number around).
 */
export function unreadCount(stories: readonly FeedStory[], readIds: ReadonlySet<string>): number {
  return stories.filter((s) => !readIds.has(s.id)).length;
}

export function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  return `${String(Math.round(hr / 24))}d ago`;
}
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The feed republishes roughly every ~30 minutes during normal operation
 * (see docs/agent-system-prompt.md's "assume you'll run again in ~30
 * minutes"). Six hours is a generous buffer over a skipped run or two, while
 * still catching an overnight publishing stall before it goes fully stale.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface Freshness {
  /** "8:02 PM" for a snapshot generated today (local calendar day); "Sep 2, 8:02 PM" otherwise. */
  readonly label: string;
  /** True once the snapshot is old enough that it must no longer read as current. */
  readonly stale: boolean;
}

/**
 * Calendar-aware, relational freshness for the feed's `generatedAt`
 * timestamp. "Today" is a local-calendar-day comparison (`toDateString()`),
 * not a 24-hour subtraction — a snapshot from 11pm yesterday is under 24h
 * old but must never read as "today". `now` is injectable for tests.
 */
export function freshness(generatedAtIso: string, now: Date = new Date()): Freshness {
  const generated = new Date(generatedAtIso);
  const isToday = generated.toDateString() === now.toDateString();
  return {
    label: isToday ? shortTime(generatedAtIso) : `${shortDate(generatedAtIso)}, ${shortTime(generatedAtIso)}`,
    stale: now.getTime() - generated.getTime() >= STALE_AFTER_MS,
  };
}

/**
 * A `summary` unstructured into one paragraph, or split into an optional
 * lede sentence plus a bullet list — see docs/agent-system-prompt.md's
 * (optional, never enforced) lede+`- `-bullets convention. Pure/synchronous:
 * parses the raw string as-is, no validation, no side effects.
 *
 * Deliberately strict and all-or-nothing: a single non-bullet line among the
 * remaining lines falls the whole summary back to unstructured rather than
 * rendering a partial list.
 */
export interface ParsedSummary {
  readonly lede: string;
  /** Empty when the summary is unstructured (or has a lede but no bullets) — never partially populated. */
  readonly bullets: readonly string[];
}

const BULLET_LINE = /^-\s+(\S.*)$/;

export function parseSummary(raw: string): ParsedSummary {
  if (!/\r\n|\n/.test(raw)) return { lede: raw, bullets: [] };

  const lines = raw.split(/\r\n|\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return { lede: raw, bullets: [] };

  const [lede, ...rest] = lines;
  const bullets: string[] = [];
  for (const line of rest) {
    const match = BULLET_LINE.exec(line.trimStart());
    if (match === null) return { lede: raw, bullets: [] };
    bullets.push(match[1].trim());
  }
  return { lede: lede.trim(), bullets };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
