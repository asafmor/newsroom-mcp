import type { StoryContribution, StoryId } from "./story.js";

export interface FeedQuery {
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

export interface FeedSource {
  providerName: string;

  title: string;
  url: string;

  publishedAt: Date;

  /**
   * How this source moved the story along, as judged by the curating agent.
   * Exposed so readers can tell which reports introduced a new development
   * (`meaningful-update`) from those that only corroborate (`supporting`)
   * or add context (`background`).
   */
  contribution: StoryContribution;
}

export interface FeedStory {
  id: StoryId;

  title: string;
  summary: string;

  importanceScore: number;
  relevanceScore: number;

  firstSeenAt: Date;
  lastMeaningfulUpdateAt: Date;

  sources: FeedSource[];
}

/** A read-model view of curated stories. Never exposes raw database rows. */
export interface Feed {
  generatedAt: Date;
  stories: FeedStory[];
  totalCount: number;
  hasMore: boolean;
}
