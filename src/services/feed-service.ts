import type { Feed, FeedQuery, FeedSource, FeedStory } from "../domain/feed.js";
import type { Story } from "../domain/story.js";
import type { ContentProviderRegistry } from "../providers/content-provider-registry.js";
import type { StoryRepository } from "../repositories/story-repository.js";

const DEFAULT_LIMIT = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Feed-only staleness rules — get-active-stories (the AI's triage view) sees
// every active story regardless of age, so it can still archive/update a
// story that's fallen off the feed. Only the reader-facing feed hides and
// decays stale stories.
const MAX_STORY_AGE_DAYS = 7;
const RANK_HALF_LIFE_DAYS = 3;

/** Builds the read-only curated feed view from active stories. */
export class FeedService {
  constructor(
    private readonly stories: StoryRepository,
    private readonly providers: ContentProviderRegistry,
  ) {}

  async getFeed(query: FeedQuery): Promise<Feed> {
    const active = await this.stories.findActive();
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const ranked = this.rank(active);
    const page = ranked.slice(offset, offset + limit);
    const stories = await Promise.all(page.map((story) => this.toFeedStory(story)));

    return {
      generatedAt: new Date(),
      stories,
      totalCount: ranked.length,
      hasMore: offset + stories.length < ranked.length,
    };
  }

  /**
   * Drops stories with no meaningful update in `MAX_STORY_AGE_DAYS`, then
   * orders survivors by importance decayed toward zero as they age — an old
   * high-importance story fades below a fresher, lower-importance one
   * instead of camping at #1 forever.
   */
  private rank(stories: Story[]): Story[] {
    const now = Date.now();

    return stories
      .map((story) => ({
        story,
        ageDays: (now - story.lastMeaningfulUpdateAt.getTime()) / MS_PER_DAY,
      }))
      .filter(({ ageDays }) => ageDays <= MAX_STORY_AGE_DAYS)
      .map(({ story, ageDays }) => ({
        story,
        rankScore: story.importanceScore * Math.pow(0.5, ageDays / RANK_HALF_LIFE_DAYS),
      }))
      .sort((a, b) => b.rankScore - a.rankScore)
      .map(({ story }) => story);
  }

  private async toFeedStory(story: Story): Promise<FeedStory> {
    const attached = await this.stories.findAttachedContent(story.id);
    const sources: FeedSource[] = attached.map((item) => ({
      // Fall back to the raw provider id if it was removed from config after
      // the item was ingested — better than silently dropping the source.
      providerName: this.providers.get(item.providerId)?.name ?? item.providerId,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      contribution: item.contribution,
    }));

    return {
      id: story.id,
      title: story.title,
      summary: story.summary,
      importanceScore: story.importanceScore,
      relevanceScore: story.relevanceScore,
      firstSeenAt: story.firstSeenAt,
      lastMeaningfulUpdateAt: story.lastMeaningfulUpdateAt,
      sources,
      tags: story.tags,
    };
  }
}
