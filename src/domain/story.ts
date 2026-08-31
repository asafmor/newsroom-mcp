import type { ContentItemId } from "./content-item.js";

export type StoryId = string;

export type StoryStatus = "active" | "archived";

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
}

/** Partial update to the AI-maintained interpretation of a story. */
export interface UpdateStoryInput {
  title?: string;
  summary?: string;

  relevanceScore?: number;
  importanceScore?: number;
}

export interface AttachItemInput {
  storyId: StoryId;
  contentItemId: ContentItemId;

  contribution: StoryContribution;

  reason?: string;
}
