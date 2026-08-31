import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqliteProviderStateRepository } from "../../src/sqlite/sqlite-provider-state-repository.js";

describe("SqliteProviderStateRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteProviderStateRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new SqliteProviderStateRepository(db);
  });

  it("returns null when no state stored", async () => {
    expect(await repo.get("rss:openai")).toBeNull();
  });

  it("sets and retrieves state", async () => {
    await repo.set("rss:openai", { cursor: "abc" });
    expect(await repo.get("rss:openai")).toEqual({ cursor: "abc" });
  });

  it("upserts on subsequent set calls", async () => {
    await repo.set("rss:openai", { cursor: "abc" });
    await repo.set("rss:openai", { cursor: "def" });

    expect(await repo.get("rss:openai")).toEqual({ cursor: "def" });
  });
});
