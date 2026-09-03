// Shared between the MCP `get-feed` View (views/get-feed/view.tsx) and the
// standalone site (site/src/main.tsx) — only the fields the UI actually
// reads, structurally compatible with get-feed-tool.ts's serialized output
// and the published feed.json.
export type StoryContribution = "supporting" | "meaningful-update" | "background";

/** The closed story-tag vocabulary the server enforces — see src/domain/story.ts's `StoryTag`. */
export type StoryTag =
  | "model-release"
  | "research"
  | "regulation"
  | "funding"
  | "product-launch"
  | "safety"
  | "infrastructure"
  | "enterprise-adoption"
  | "open-source"
  | "opinion";

export interface FeedSource {
  readonly providerName: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  /**
   * Optional on purpose: the feed.json snapshot committed before this field
   * existed is still served until the next `npm run publish-feed`, so the UI
   * has to render a source that never carried a contribution.
   */
  readonly contribution?: StoryContribution;
}

export interface FeedStory {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly lastMeaningfulUpdateAt: string;
  readonly sources: readonly FeedSource[];
  /**
   * Optional on purpose: the feed.json snapshot committed before this field
   * existed is still served until the next `npm run publish-feed`, so the UI
   * has to render a story that never carried tags — treated as `[]`.
   */
  readonly tags?: readonly StoryTag[];
}

export type SortMode = "top" | "latest";

export type Theme = "light" | "dark" | "auto";
