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
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
