import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqliteStoryRepository } from "../../src/sqlite/sqlite-story-repository.js";
import { SqliteContentItemRepository } from "../../src/sqlite/sqlite-content-item-repository.js";
import { ContentProviderRegistry } from "../../src/providers/content-provider-registry.js";
import { FeedService } from "../../src/services/feed-service.js";
import type { ContentItem } from "../../src/domain/content-item.js";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("expected value, got undefined/null");
  }
  return value;
}

function makeItem(externalId: string): ContentItem {
  return {
    providerId: "rss:openai",
    externalId,
    kind: "article",
    title: `title-${externalId}`,
    url: `https://example.com/${externalId}`,
    publishedAt: new Date(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("FeedService.getFeed", () => {
  let db: DatabaseSync;
  let stories: SqliteStoryRepository;
  let items: SqliteContentItemRepository;
  let feedService: FeedService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    stories = new SqliteStoryRepository(db);
    items = new SqliteContentItemRepository(db);
    feedService = new FeedService(stories, new ContentProviderRegistry([]));
  });

  async function insertItem(externalId: string): Promise<string> {
    const { inserted } = await items.insertMany([makeItem(externalId)]);
    return must(inserted[0]).id;
  }

  async function touch(storyId: string, ageDays: number): Promise<void> {
    await stories.attachItem({
      storyId,
      contentItemId: await insertItem(`touch-${storyId}-${ageDays}`),
      contribution: "meaningful-update",
      reason: "backdated for test",
      attachedAt: new Date(Date.now() - ageDays * DAY_MS),
    });
  }

  it("excludes stories with no meaningful update in over a week", async () => {
    const stale = await stories.create({
      contentItemIds: [await insertItem("stale-founding")],
      title: "Stale but important",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.9,
    });
    await touch(stale.id, 8);

    const fresh = await stories.create({
      contentItemIds: [await insertItem("fresh-founding")],
      title: "Fresh",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.5,
    });

    const feed = await feedService.getFeed({});
    expect(feed.stories.map((s) => s.id)).toEqual([fresh.id]);
  });

  it("decays importance by age so a fresh story can outrank an older, more important one", async () => {
    const oldImportant = await stories.create({
      contentItemIds: [await insertItem("old-founding")],
      title: "Old but important",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.9,
    });
    await touch(oldImportant.id, 6); // within the 7-day cutoff, but heavily decayed

    const freshLessImportant = await stories.create({
      contentItemIds: [await insertItem("fresh-founding-2")],
      title: "Fresh, less important",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.5,
    });

    const feed = await feedService.getFeed({});
    expect(feed.stories.map((s) => s.id)).toEqual([freshLessImportant.id, oldImportant.id]);
  });

  it("paginates the ranked list via limit/offset, reporting totalCount and hasMore", async () => {
    const high = await stories.create({
      contentItemIds: [await insertItem("high-founding")],
      title: "High",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.9,
    });
    const mid = await stories.create({
      contentItemIds: [await insertItem("mid-founding")],
      title: "Mid",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.5,
    });
    const low = await stories.create({
      contentItemIds: [await insertItem("low-founding")],
      title: "Low",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.1,
    });

    const firstPage = await feedService.getFeed({ limit: 2, offset: 0 });
    expect(firstPage.stories.map((s) => s.id)).toEqual([high.id, mid.id]);
    expect(firstPage.totalCount).toBe(3);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await feedService.getFeed({ limit: 2, offset: 2 });
    expect(secondPage.stories.map((s) => s.id)).toEqual([low.id]);
    expect(secondPage.totalCount).toBe(3);
    expect(secondPage.hasMore).toBe(false);
  });

  it("defaults offset to 0", async () => {
    await stories.create({
      contentItemIds: [await insertItem("default-offset-founding")],
      title: "Story",
      summary: "s",
      relevanceScore: 0.8,
      importanceScore: 0.9,
    });

    const feed = await feedService.getFeed({});
    expect(feed.stories).toHaveLength(1);
    expect(feed.totalCount).toBe(1);
    expect(feed.hasMore).toBe(false);
  });
});
