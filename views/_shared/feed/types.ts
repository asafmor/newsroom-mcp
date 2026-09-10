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

/**
 * Compact entry-point summary the site links to (see the two-cell
 * `.entry-bar-row` in FeedApp.tsx). Deliberately generic — feed/ never
 * imports podcast/'s or tools/'s types; the site computes this via
 * views/_shared/podcast/formatters.ts's `latestDigestEntry` and
 * views/_shared/tools/formatters.ts's `toolsDigestEntry`, and passes it down
 * as plain strings.
 */
export interface DigestEntry {
  /** Supporting line shown when this cell shares the row with a sibling entry, e.g. "Sep 9 · Ready". */
  readonly compactSupporting: string;
  /** Supporting line shown when this is the row's only entry, e.g. "Sep 2 – Sep 9, 2026 · Ready". */
  readonly fullSupporting: string;
  /** A restrained accent cue (e.g. "ready to listen") — never a per-reader "unseen" claim. */
  readonly accentSupporting: boolean;
  /**
   * Full-sentence accessible name (e.g. "Weekly podcast, Sep 2 – Sep 9,
   * 2026, ready to play") — the visible compact/full strings above
   * abbreviate dates and relative times, so neither is an acceptable
   * accessible name on its own (P1-b UI-review finding).
   */
  readonly ariaLabel: string;
  /** Anchor to scroll/link to, e.g. "#podcast-digest". */
  readonly href: string;
}
