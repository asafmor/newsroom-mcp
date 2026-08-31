import type { StoryId } from "./story.js";

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
