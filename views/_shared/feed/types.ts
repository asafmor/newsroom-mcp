// Shared between the MCP `get-feed` View (views/get-feed/view.tsx) and the
// standalone site (site/src/main.tsx) — only the fields the UI actually
// reads, structurally compatible with get-feed-tool.ts's serialized output
// and the published feed.json.
export interface FeedSource {
  readonly providerName: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
}

export interface FeedStory {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly lastMeaningfulUpdateAt: string;
  readonly sources: readonly FeedSource[];
}

export type SortMode = "top" | "latest";

export type Theme = "light" | "dark" | "auto";
