import type { FeedStory } from "./types.js";

// World-time, not ingest-time: a story's sources may be reported at different
// moments, so "latest"/"earliest" reflects when the news actually happened
// rather than a server-side ingest timestamp.
export function latestPublishedAt(story: FeedStory): string {
  return story.sources.reduce((max, s) => (s.publishedAt > max ? s.publishedAt : max), story.sources[0].publishedAt);
}
export function earliestPublishedAt(story: FeedStory): string {
  return story.sources.reduce((min, s) => (s.publishedAt < min ? s.publishedAt : min), story.sources[0].publishedAt);
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
