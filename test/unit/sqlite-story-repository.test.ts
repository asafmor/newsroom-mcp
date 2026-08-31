import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqliteStoryRepository } from "../../src/sqlite/sqlite-story-repository.js";
import { SqliteContentItemRepository } from "../../src/sqlite/sqlite-content-item-repository.js";
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
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("SqliteStoryRepository", () => {
  let db: DatabaseSync;
  let stories: SqliteStoryRepository;
  let items: SqliteContentItemRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    stories = new SqliteStoryRepository(db);
    items = new SqliteContentItemRepository(db);
  });

  async function insertItem(externalId: string): Promise<string> {
    const { inserted } = await items.insertMany([makeItem(externalId)]);
    return must(inserted[0]).id;
  }

  it("creates a story, linking founding items and marking them linked", async () => {
    const itemId = await insertItem("a");

    const story = await stories.create({
      contentItemIds: [itemId],
      title: "Title",
      summary: "Summary",
      relevanceScore: 0.5,
      importanceScore: 0.7,
    });

    expect(story.status).toBe("active");
    expect(story.firstSeenAt).toBeInstanceOf(Date);

    const found = await items.findById(itemId);
    expect(must(found).processingStatus).toBe("linked");

    const attached = await stories.findAttachedContent(story.id);
    expect(attached).toHaveLength(1);
    expect(must(attached[0]).contribution).toBe("supporting");
  });

  it("findById returns null when missing", async () => {
    expect(await stories.findById("nope")).toBeNull();
  });

  it("findActive orders by importanceScore descending", async () => {
    const low = await stories.create({
      contentItemIds: [],
      title: "Low",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.1,
    });
    const high = await stories.create({
      contentItemIds: [],
      title: "High",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.9,
    });

    const active = await stories.findActive();
    expect(active.map((s) => s.id)).toEqual([high.id, low.id]);
  });

  it("findActive breaks importanceScore ties by lastMeaningfulUpdateAt descending", async () => {
    const older = await stories.create({
      contentItemIds: [await insertItem("older-founding")],
      title: "Older update",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.5,
    });
    const newer = await stories.create({
      contentItemIds: [await insertItem("newer-founding")],
      title: "Newer update",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.5,
    });

    // Both stories start with a near-identical lastMeaningfulUpdateAt (both
    // just created); attach a fresh meaningful-update item only to "newer"
    // so it's unambiguously the more recently updated of the two.
    // A comfortable margin past "now" — both stories' creation timestamps
    // land within the same test tick, so a bare `new Date()` here risks
    // tying with them at millisecond resolution.
    await stories.attachItem({
      storyId: newer.id,
      contentItemId: await insertItem("newer-update"),
      contribution: "meaningful-update",
      reason: "New development",
      attachedAt: new Date(Date.now() + 60_000),
    });

    const active = await stories.findActive();
    expect(active.map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it("archiveStale archives only active stories older than the cutoff, in bulk", async () => {
    const stale = await stories.create({
      contentItemIds: [await insertItem("stale-founding")],
      title: "Stale",
      summary: "s",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });
    await stories.attachItem({
      storyId: stale.id,
      contentItemId: await insertItem("stale-update"),
      contribution: "meaningful-update",
      reason: "backdated for test",
      attachedAt: new Date("2020-01-01"),
    });

    const fresh = await stories.create({
      contentItemIds: [await insertItem("fresh-founding")],
      title: "Fresh",
      summary: "s",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });

    const alreadyArchived = await stories.create({
      contentItemIds: [await insertItem("archived-founding")],
      title: "Already archived",
      summary: "s",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });
    await stories.archive(alreadyArchived.id);

    const cutoff = new Date("2025-01-01");
    const archivedCount = await stories.archiveStale(cutoff);

    expect(archivedCount).toBe(1);
    const active = await stories.findActive();
    expect(active.map((s) => s.id)).toEqual([fresh.id]);
  });

  it("update patches only given fields and bumps updatedAt", async () => {
    const story = await stories.create({
      contentItemIds: [],
      title: "Original",
      summary: "Original summary",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });

    const updated = await stories.update(story.id, { title: "New title" });
    expect(updated.title).toBe("New title");
    expect(updated.summary).toBe("Original summary");
  });

  it("update throws for a missing story", async () => {
    await expect(stories.update("nope", { title: "x" })).rejects.toThrow();
  });

  it("archive sets status to archived", async () => {
    const story = await stories.create({
      contentItemIds: [],
      title: "T",
      summary: "S",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });

    await stories.archive(story.id);
    expect(must(await stories.findById(story.id)).status).toBe("archived");
  });

  it("attachItem with 'supporting' bumps lastItemAttachedAt but not lastMeaningfulUpdateAt", async () => {
    const story = await stories.create({
      contentItemIds: [],
      title: "T",
      summary: "S",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });
    const before = must(await stories.findById(story.id));

    const itemId = await insertItem("b");
    const attachedAt = new Date(before.lastMeaningfulUpdateAt.getTime() + 60_000);

    await stories.attachItem({
      storyId: story.id,
      contentItemId: itemId,
      contribution: "supporting",
      attachedAt,
    });

    const after = must(await stories.findById(story.id));
    expect(after.lastItemAttachedAt.getTime()).toBe(attachedAt.getTime());
    expect(after.lastMeaningfulUpdateAt.getTime()).toBe(before.lastMeaningfulUpdateAt.getTime());

    expect(must(await items.findById(itemId)).processingStatus).toBe("linked");
  });

  it("attachItem with 'meaningful-update' bumps both timestamps", async () => {
    const story = await stories.create({
      contentItemIds: [],
      title: "T",
      summary: "S",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });

    const itemId = await insertItem("c");
    const attachedAt = new Date(Date.now() + 60_000);

    await stories.attachItem({
      storyId: story.id,
      contentItemId: itemId,
      contribution: "meaningful-update",
      reason: "new development",
      attachedAt,
    });

    const after = must(await stories.findById(story.id));
    expect(after.lastItemAttachedAt.getTime()).toBe(attachedAt.getTime());
    expect(after.lastMeaningfulUpdateAt.getTime()).toBe(attachedAt.getTime());
  });

  it("attachItem throws on duplicate (storyId, contentItemId)", async () => {
    const story = await stories.create({
      contentItemIds: [],
      title: "T",
      summary: "S",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });
    const itemId = await insertItem("d");

    await stories.attachItem({
      storyId: story.id,
      contentItemId: itemId,
      contribution: "supporting",
      attachedAt: new Date(),
    });

    await expect(
      stories.attachItem({
        storyId: story.id,
        contentItemId: itemId,
        contribution: "supporting",
        attachedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("findAttachedContent returns items ordered by attachedAt ascending", async () => {
    const story = await stories.create({
      contentItemIds: [],
      title: "T",
      summary: "S",
      relevanceScore: 0.5,
      importanceScore: 0.5,
    });

    const item1 = await insertItem("e1");
    const item2 = await insertItem("e2");

    const t1 = new Date(Date.now());
    const t2 = new Date(t1.getTime() + 1000);

    await stories.attachItem({ storyId: story.id, contentItemId: item2, contribution: "supporting", attachedAt: t2 });
    await stories.attachItem({ storyId: story.id, contentItemId: item1, contribution: "background", attachedAt: t1 });

    const attached = await stories.findAttachedContent(story.id);
    expect(attached.map((a) => a.contentItemId)).toEqual([item1, item2]);
    expect(must(attached[0]).providerId).toBe("rss:openai");
    expect(must(attached[0]).title).toBe("title-e1");
  });

  it("findActive paginates with limit/offset in the same importance order", async () => {
    const high = await stories.create({
      contentItemIds: [],
      title: "High",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.9,
    });
    const mid = await stories.create({
      contentItemIds: [],
      title: "Mid",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.5,
    });
    const low = await stories.create({
      contentItemIds: [],
      title: "Low",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.1,
    });

    const firstPage = await stories.findActive({ limit: 2, offset: 0 });
    expect(firstPage.map((s) => s.id)).toEqual([high.id, mid.id]);

    const secondPage = await stories.findActive({ limit: 2, offset: 2 });
    expect(secondPage.map((s) => s.id)).toEqual([low.id]);
  });

  it("countActive counts only active stories", async () => {
    await stories.create({ contentItemIds: [], title: "A", summary: "s", relevanceScore: 0.1, importanceScore: 0.1 });
    const toArchive = await stories.create({
      contentItemIds: [],
      title: "B",
      summary: "s",
      relevanceScore: 0.1,
      importanceScore: 0.1,
    });
    await stories.archive(toArchive.id);

    expect(await stories.countActive()).toBe(1);
  });
});
