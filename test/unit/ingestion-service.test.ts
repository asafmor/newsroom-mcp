import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

import type { ContentItem } from "../../src/domain/content-item.js";
import type { ContentProvider } from "../../src/domain/provider.js";
import { ContentProviderRegistry } from "../../src/providers/content-provider-registry.js";
import { openDatabase } from "../../src/sqlite/sqlite-database.js";
import { SqliteContentItemRepository } from "../../src/sqlite/sqlite-content-item-repository.js";
import { SqliteProviderStateRepository } from "../../src/sqlite/sqlite-provider-state-repository.js";
import { IngestionService } from "../../src/services/ingestion-service.js";

function fakeItem(providerId: string): ContentItem {
  return {
    providerId,
    externalId: "1",
    kind: "article",
    title: `item from ${providerId}`,
    url: `https://example.com/${providerId}`,
    publishedAt: new Date(),
    metadata: {},
  };
}

/** A provider that resolves after a delay, so ordering/concurrency is observable. */
function stubProvider(id: string, delayMs: number, fail = false): ContentProvider {
  return {
    id,
    name: id,
    fetchNew: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (fail) throw new Error(`${id} boom`);
      return { items: [fakeItem(id)], nextState: {} };
    },
  };
}

describe("IngestionService.fetchNewItems", () => {
  let db: DatabaseSync;
  let items: SqliteContentItemRepository;
  let providerStates: SqliteProviderStateRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    items = new SqliteContentItemRepository(db);
    providerStates = new SqliteProviderStateRepository(db);
  });

  it("runs providers concurrently, not sequentially", async () => {
    const registry = new ContentProviderRegistry([
      stubProvider("slow", 30),
      stubProvider("fast", 5),
    ]);
    const service = new IngestionService(registry, items, providerStates);

    const start = Date.now();
    await service.fetchNewItems();
    const elapsedMs = Date.now() - start;

    // Sequential would take >= 35ms; concurrent should finish close to the
    // slowest single provider (30ms), well under the sum.
    expect(elapsedMs).toBeLessThan(30 + 5 + 15);
  });

  it("isolates a failing provider without affecting the others' results", async () => {
    const registry = new ContentProviderRegistry([
      stubProvider("ok-a", 0),
      stubProvider("broken", 0, true),
      stubProvider("ok-b", 0),
    ]);
    const service = new IngestionService(registry, items, providerStates);

    const result = await service.fetchNewItems();

    expect(result.providersProcessed).toBe(2);
    expect(result.itemsFetched).toBe(2);
    expect(result.itemsInserted).toBe(2);
    expect(result.providers).toHaveLength(3);

    const broken = result.providers.find((p) => p.providerId === "broken");
    expect(broken?.status).toBe("failed");
    expect(broken?.error).toContain("boom");

    const okA = result.providers.find((p) => p.providerId === "ok-a");
    expect(okA?.status).toBe("ok");
    expect(okA?.itemsInserted).toBe(1);

    // The failed provider must not persist a cursor for a fetch it never
    // completed.
    expect(await providerStates.get("ok-a")).not.toBeNull();
    expect(await providerStates.get("ok-b")).not.toBeNull();
    expect(await providerStates.get("broken")).toBeNull();
  });
});
