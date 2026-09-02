import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqliteStoryRepository } from "../../src/sqlite/sqlite-story-repository.js";
import { SqliteContentItemRepository } from "../../src/sqlite/sqlite-content-item-repository.js";
import { StoryService } from "../../src/services/story-service.js";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("expected value, got undefined/null");
  }
  return value;
}

describe("StoryService.mergeStories", () => {
  let db: DatabaseSync;
  let stories: SqliteStoryRepository;
  let items: SqliteContentItemRepository;
  let service: StoryService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    stories = new SqliteStoryRepository(db);
    items = new SqliteContentItemRepository(db);
    service = new StoryService(stories, items);
  });

  async function makeStory(title: string) {
    return stories.create({ contentItemIds: [], title, summary: "s", relevanceScore: 0.5, importanceScore: 0.5 });
  }

  it("merges two active stories and returns the surviving story", async () => {
    const survivor = await makeStory("Survivor");
    const loser = await makeStory("Loser");

    const merged = await service.mergeStories(survivor.id, loser.id);

    expect(merged.id).toBe(survivor.id);
    expect(merged.status).toBe("active");
    expect(must(await stories.findById(loser.id)).status).toBe("archived");
  });

  it("rejects merging a story into itself before checking existence, without changing state", async () => {
    const story = await makeStory("Solo");

    await expect(service.mergeStories(story.id, story.id)).rejects.toThrow(/itself/i);
    // A self-merge with a nonexistent id still gets the clearer self-merge
    // error, not a confusing "not found".
    await expect(service.mergeStories("does-not-exist", "does-not-exist")).rejects.toThrow(/itself/i);

    expect(must(await stories.findById(story.id)).status).toBe("active");
  });

  it("rejects when the surviving story does not exist, naming that id", async () => {
    const loser = await makeStory("Loser");

    await expect(service.mergeStories("missing-survivor", loser.id)).rejects.toThrow(/missing-survivor/);
    expect(must(await stories.findById(loser.id)).status).toBe("active");
  });

  it("rejects when the losing story does not exist, naming that id", async () => {
    const survivor = await makeStory("Survivor");

    await expect(service.mergeStories(survivor.id, "missing-loser")).rejects.toThrow(/missing-loser/);
    expect(must(await stories.findById(survivor.id)).status).toBe("active");
  });

  it("rejects when the surviving story is archived, and changes nothing", async () => {
    const survivor = await makeStory("Survivor");
    await stories.archive(survivor.id);
    const loser = await makeStory("Loser");

    await expect(service.mergeStories(survivor.id, loser.id)).rejects.toThrow(/not active/i);
    expect(must(await stories.findById(loser.id)).status).toBe("active");
  });

  it("rejects when the losing story is archived (including one already consumed by a prior merge)", async () => {
    const survivor = await makeStory("Survivor");
    const alreadyMergedLoser = await makeStory("Already merged away");
    await stories.archive(alreadyMergedLoser.id);

    await expect(service.mergeStories(survivor.id, alreadyMergedLoser.id)).rejects.toThrow(/not active/i);
    expect(must(await stories.findById(survivor.id)).status).toBe("active");
  });

  it("rejects a literal double-submit of the same merge rather than silently no-opping", async () => {
    const survivor = await makeStory("Survivor");
    const loser = await makeStory("Loser");

    await service.mergeStories(survivor.id, loser.id);
    await expect(service.mergeStories(survivor.id, loser.id)).rejects.toThrow(/not active/i);
  });

  it("lets a story that previously survived a merge be used as a loser later", async () => {
    const first = await makeStory("A");
    const second = await makeStory("B");
    const third = await makeStory("C");

    const afterFirstMerge = await service.mergeStories(first.id, second.id);
    expect(afterFirstMerge.status).toBe("active");

    const afterSecondMerge = await service.mergeStories(third.id, first.id);
    expect(afterSecondMerge.id).toBe(third.id);
    expect(must(await stories.findById(first.id)).status).toBe("archived");
  });
});
