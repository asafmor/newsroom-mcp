import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqliteContentItemRepository } from "../../src/sqlite/sqlite-content-item-repository.js";
import type { ContentItem } from "../../src/domain/content-item.js";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("expected value, got undefined/null");
  }
  return value;
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    providerId: "rss:openai",
    externalId: "ext-1",
    kind: "article",
    title: "Some title",
    url: "https://example.com/a",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    authors: ["Jane Doe"],
    description: "desc",
    metadata: { foo: "bar" },
    ...overrides,
  };
}

describe("SqliteContentItemRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteContentItemRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new SqliteContentItemRepository(db);
  });

  it("inserts and round-trips an item", async () => {
    const result = await repo.insertMany([makeItem()]);

    expect(result.duplicates).toBe(0);
    expect(result.inserted).toHaveLength(1);

    const stored = must(result.inserted[0]);
    expect(stored.id).toBeTruthy();
    expect(stored.providerId).toBe("rss:openai");
    expect(stored.externalId).toBe("ext-1");
    expect(stored.authors).toEqual(["Jane Doe"]);
    expect(stored.metadata).toEqual({ foo: "bar" });
    expect(stored.processingStatus).toBe("pending");
    expect(stored.discoveredAt).toBeInstanceOf(Date);
    expect(stored.publishedAt).toBeInstanceOf(Date);

    const found = await repo.findById(stored.id);
    expect(found).toEqual(stored);
  });

  it("skips exact duplicates by (providerId, externalId)", async () => {
    await repo.insertMany([makeItem()]);
    const second = await repo.insertMany([makeItem()]);

    expect(second.duplicates).toBe(1);
    expect(second.inserted).toHaveLength(0);
  });

  it("returns pending items oldest-first, respecting limit", async () => {
    const recent = new Date();
    await repo.insertMany([makeItem({ externalId: "a", publishedAt: recent })]);
    await repo.insertMany([makeItem({ externalId: "b", publishedAt: recent })]);
    await repo.insertMany([makeItem({ externalId: "c", publishedAt: recent })]);

    const pending = await repo.findPending(2);
    expect(pending).toHaveLength(2);
    expect(must(pending[0]).externalId).toBe("a");
    expect(must(pending[1]).externalId).toBe("b");
  });

  it("excludes items published more than a week ago", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await repo.insertMany([makeItem({ externalId: "stale", publishedAt: eightDaysAgo })]);
    await repo.insertMany([makeItem({ externalId: "fresh", publishedAt: yesterday })]);

    const pending = await repo.findPending(10);
    expect(pending.map((item) => item.externalId)).toEqual(["fresh"]);
  });

  it("findById returns null when missing", async () => {
    expect(await repo.findById("nope")).toBeNull();
  });

  it("markLinked and markIgnored update processing status", async () => {
    const { inserted } = await repo.insertMany([makeItem()]);
    const id = must(inserted[0]).id;

    await repo.markLinked(id);
    expect(must(await repo.findById(id)).processingStatus).toBe("linked");

    await repo.markIgnored(id);
    expect(must(await repo.findById(id)).processingStatus).toBe("ignored");
  });
});
