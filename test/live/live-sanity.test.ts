/**
 * Opt-in happy-path sanity tests against real public APIs and the real MCP
 * tool surface. Skipped unless NEWSROOM_LIVE_TESTS=1 (see `npm run test:live`).
 * No mocks: this exercises the actual RSS/HN integrations and the
 * real, in-memory-backed newsroom-mcp server end to end.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { buildProviderRegistry } from "../../src/config/providers.js";

const config = loadConfig();
const LIVE_TIMEOUT_MS = 30_000;

describe.skipIf(!config.liveTests)("newsroom-mcp live sanity", () => {
  // Each provider *type* against its real upstream API,
  // bypassing the MCP server entirely — this isolates a broken provider
  // from a broken tool/service, and is the only place that proves each
  // integration actually parses real upstream data, not just a fixture.
  describe("content providers", () => {
    const registry = buildProviderRegistry(config);

    it(
      "RSS provider fetches and parses a real feed",
      async () => {
        const rss = registry.get("rss:openai");
        if (!rss) throw new Error("rss:openai not configured");

        const result = await rss.fetchNew(null);

        expect(result.items.length).toBeGreaterThan(0);
        const [item] = result.items;
        expect(item.title.length).toBeGreaterThan(0);
        expect(item.url).toMatch(/^https?:\/\//);
        expect(item.publishedAt).toBeInstanceOf(Date);
        expect(Number.isNaN(item.publishedAt.getTime())).toBe(false);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      "Hacker News provider fetches real stories",
      async () => {
        const hn = registry.get("hacker-news");
        if (!hn) throw new Error("hacker-news not configured");

        const result = await hn.fetchNew(null);

        expect(result.items.length).toBeGreaterThan(0);
        const [item] = result.items;
        expect(item.kind).toBe("discussion");
        expect(item.title.length).toBeGreaterThan(0);
        expect(item.metadata).toHaveProperty("hnDiscussionUrl");
      },
      LIVE_TIMEOUT_MS,
    );
  });

  // The full MCP tool surface, driven through the real protocol client
  // against the real server — proves the tools, services, and repositories
  // work together end to end, culminating in real curated feed data out of
  // get-feed.
  describe("MCP tool surface", () => {
    let client: Client | undefined;
    let server: Awaited<typeof import("../../index.js")>["default"] | undefined;

    beforeAll(async () => {
      process.env.NEWSROOM_DB_PATH = ":memory:";

      server = (await import("../../index.js")).default;
      // Same minimal inline manifest as the protocol test — this test drives
      // the real server over HTTP, and get-feed is bound to a view, so
      // mounting fails without a primed manifest even though we don't
      // inspect the view's own output here.
      server.__primeViews({
        "get-feed": {
          kind: "inline",
          js: "export {};",
          css: "",
        },
      });
      const { url } = await server.listen(0, { host: "127.0.0.1" });
      const transport = new StreamableHTTPClientTransport(new URL(url));

      client = new Client(
        { name: "newsroom-mcp-live-test", version: "1.0.0" },
        { versionNegotiation: { mode: "auto" } },
      );

      await client.connect(transport);
    }, LIVE_TIMEOUT_MS);

    afterAll(async () => {
      await client?.close();
      await server?.close();
    });

    it(
      "exercises every tool end to end and returns real curated feed data from get-feed",
      async () => {
        // 1. fetch-new-items: real RSS + HN content, stored for real.
        const fetched = await client?.callTool({ name: "fetch-new-items", arguments: {} });

        expect(fetched?.isError).toBeFalsy();
        const ingestion = fetched?.structuredContent as
          | {
              providersProcessed: number;
              itemsFetched: number;
              itemsInserted: number;
              providers: { providerId: string; status: "ok" | "failed" }[];
            }
          | undefined;

        // A single flaky RSS feed must not sink the whole poll;
        // IngestionService is built to tolerate that, so this end-to-end
        // assertion mirrors real operation rather than requiring every
        // provider to succeed.
        expect(ingestion?.providers.length).toBe(21);
        expect(ingestion?.providersProcessed).toBeGreaterThanOrEqual(19);
        expect(ingestion?.itemsFetched).toBeGreaterThan(0);
        expect(ingestion?.itemsInserted).toBeGreaterThan(0);

        // 2. get-unprocessed-items: real ingested content, not fixtures.
        const pending = await client?.callTool({
          name: "get-unprocessed-items",
          arguments: { limit: 10 },
        });
        const items = (pending?.structuredContent as { items: { id: string; title: string }[] })
          .items;

        expect(pending?.isError).toBeFalsy();
        expect(items.length).toBeGreaterThan(0);
        const [firstItem] = items;
        // `.at()` (not destructuring) so a short real result set — items may
        // legitimately number fewer than 3 — types as possibly `undefined`.
        const secondItem = items.at(1);

        // 3. create-story: cluster the first real item into a new story.
        const created = await client?.callTool({
          name: "create-story",
          arguments: {
            contentItemIds: [firstItem.id],
            title: `Live test story: ${firstItem.title.slice(0, 60)}`,
            summary: "Created by the live sanity test from real ingested content.",
            relevanceScore: 0.9,
            importanceScore: 0.5,
          },
        });
        const story = created?.structuredContent as { id: string } | undefined;

        expect(created?.isError).toBeFalsy();
        expect(story?.id.length).toBeGreaterThan(0);

        // 4. attach-item-to-story: cluster a second real item as an update.
        if (secondItem) {
          const attached = await client?.callTool({
            name: "attach-item-to-story",
            arguments: {
              storyId: story?.id,
              contentItemId: secondItem.id,
              contribution: "meaningful-update",
              reason: "Live sanity test: second real source.",
            },
          });

          expect(attached?.isError).toBeFalsy();
        }

        // 5. update-story: revise the AI-maintained summary.
        const updated = await client?.callTool({
          name: "update-story",
          arguments: { storyId: story?.id, summary: "Revised by the live sanity test." },
        });

        expect(updated?.isError).toBeFalsy();

        // 6. get-active-stories: the story should be a clustering candidate.
        const active = await client?.callTool({ name: "get-active-stories", arguments: {} });
        const activeStories = (active?.structuredContent as { stories: { id: string }[] })
          .stories;

        expect(active?.isError).toBeFalsy();
        expect(activeStories.some((activeStory) => activeStory.id === story?.id)).toBe(true);

        // 7. mark-item-processed: dismiss a leftover real item, if any.
        const remaining = items.at(2);
        if (remaining) {
          const ignored = await client?.callTool({
            name: "mark-item-processed",
            arguments: {
              contentItemId: remaining.id,
              status: "ignored",
              reason: "Live sanity test cleanup.",
            },
          });

          expect(ignored?.isError).toBeFalsy();
        }

        // 8. get-feed: real curated feed data, sourced from real content.
        const feed = await client?.callTool({ name: "get-feed", arguments: { limit: 10 } });
        const feedResult = feed?.structuredContent as
          | { stories: { id: string; title: string; sources: { title: string; url: string }[] }[] }
          | undefined;

        expect(feed?.isError).toBeFalsy();
        expect(feedResult?.stories.length).toBeGreaterThan(0);

        const feedStory = feedResult?.stories.find((candidate) => candidate.id === story?.id);
        expect(feedStory).toBeDefined();
        expect(feedStory?.sources.length).toBeGreaterThan(0);
        expect(feedStory?.sources[0]?.url).toMatch(/^https?:\/\//);
      },
      LIVE_TIMEOUT_MS,
    );
  });
});
