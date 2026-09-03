import type { ContentItemId } from "./content-item.js";

export type StoryId = string;

export type StoryStatus = "active" | "archived";

/**
 * Closed vocabulary for agent-assigned story topic tags. Fixed set — no
 * free text, no catch-all "other". A story fitting none of these gets zero
 * tags rather than a miscellaneous bucket.
 */
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

/**
 * A `Story` represents a distinct real-world event or development — not a
 * single published article. Multiple `ContentItem`s from different providers
 * can all belong to the same story.
 */
export interface Story {
  id: StoryId;

  title: string;
  summary: string;

  relevanceScore: number;
  importanceScore: number;

  /** When the system first discovered the story. */
  firstSeenAt: Date;
  /** The latest time any content item was associated with the story. */
  lastItemAttachedAt: Date;
  /**
   * The most recent time the story itself materially changed. Drives story
   * freshness; a late supporting article must not reset this.
   */
  lastMeaningfulUpdateAt: Date;

  status: StoryStatus;

  /** Agent-assigned topic tags, from the closed `StoryTag` vocabulary. Never null/undefined — an untagged story is `[]`. */
  tags: StoryTag[];
}

/**
 * How one content item relates to the story it's attached to.
 *
 * - `supporting`: another source reporting substantially the same event.
 * - `meaningful-update`: the item introduces a new development.
 * - `background`: the item mainly contributes context.
 */
export type StoryContribution = "supporting" | "meaningful-update" | "background";

export interface StoryItem {
  storyId: StoryId;
  contentItemId: ContentItemId;

  contribution: StoryContribution;

  reason?: string;

  attachedAt: Date;
}

/**
 * Input for creating a new story. The server sets `id` and every timestamp;
 * the caller (an AI agent, via an MCP tool) never supplies them directly.
 */
export interface CreateStoryInput {
  contentItemIds: ContentItemId[];

  title: string;
  summary: string;

  relevanceScore: number;
  importanceScore: number;

  /** Omitted or empty → the story starts with no tags. */
  tags?: StoryTag[];
}

/** Partial update to the AI-maintained interpretation of a story. */
export interface UpdateStoryInput {
  title?: string;
  summary?: string;

  relevanceScore?: number;
  importanceScore?: number;

  /** Omitted → existing tags are preserved. Present → fully replaces them (`[]` clears them). */
  tags?: StoryTag[];
}

export interface AttachItemInput {
  storyId: StoryId;
  contentItemId: ContentItemId;

  contribution: StoryContribution;

  reason?: string;
}
