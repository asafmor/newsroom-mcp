import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ONE_ITEM_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item>
  <title>Test RSS article</title>
  <link>https://example.com/rss-article</link>
  <guid>https://example.com/rss-article</guid>
  <pubDate>${new Date().toUTCString()}</pubDate>
</item>
</channel></rss>`;

const ONE_HN_HIT = {
  hits: [
    {
      objectID: "1",
      title: "Test HN story",
      author: "tester",
      url: "https://example.com/hn-story",
      created_at_i: Math.floor(Date.now() / 1000),
      points: 10,
      num_comments: 2,
    },
  ],
};

/**
 * Every provider's fetchNew() hits global fetch; stub it by URL shape so
 * fetch-new-items exercises real provider/repository code (19 RSS feeds + HN
 * + GDELT) without any real network traffic. Each RSS feed has a distinct
 * providerId, so the identical fixture body yields one item per feed, not a
 * dedup collision.
 */
function stubProviderFetch() {
  const realFetch = globalThis.fetch.bind(globalThis);

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url.includes("hn.algolia.com")) {
        return Promise.resolve(new Response(JSON.stringify(ONE_HN_HIT), { status: 200 }));
      }

      if (url.includes("gdeltproject.org")) {
        return Promise.resolve(new Response(JSON.stringify({ articles: [] }), { status: 200 }));
      }

      // The RSS providers all resolve real feed URLs (openai.com, etc.) —
      // only they should get the fixture. Everything else (notably the MCP
      // client's own HTTP calls to the local test server) passes through.
      const isRssProviderUrl = [
        "openai.com",
        "deepmind.google",
        "huggingface.co",
        "techcrunch.com",
        "venturebeat.com",
        "technologyreview.com",
        "rsshub.bestblogs.dev",
        "raw.githubusercontent.com",
        "wired.com",
        "arstechnica.com",
        "cnet.com",
        "gizmodo.com",
        "mashable.com",
        "engadget.com",
      ].some((host) => url.includes(host));

      if (isRssProviderUrl) {
        return Promise.resolve(new Response(ONE_ITEM_RSS, { status: 200 }));
      }

      return realFetch(input, init);
    }),
  );
}

interface ToolTextResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
}

describe("newsroom-mcp server", () => {
  let client: Client | undefined;
  let server: Awaited<typeof import("../index.js")>["default"] | undefined;

  beforeAll(async () => {
    process.env.NEWSROOM_DB_PATH = ":memory:";
    stubProviderFetch();

    server = (await import("../index.js")).default;
    // The CLI primes real Vite-built Views in development and production. This
    // protocol test imports the server directly, so a minimal inline manifest
    // exercises the same MCP resource binding without starting a browser build.
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
      { name: "newsroom-mcp-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    vi.unstubAllGlobals();
  });

  it("discovers the newsroom tools", async () => {
    const toolsResult = await client?.listTools();
    const toolNames = toolsResult?.tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      "fetch-new-items",
      "get-unprocessed-items",
      "get-active-stories",
      "create-story",
      "attach-item-to-story",
      "update-story",
      "mark-item-processed",
      "get-feed",
    ]);
  });

  it("runs the full ingestion → clustering → feed lifecycle", async () => {
    // 19 RSS feeds + Hacker News each yield one item; GDELT yields none.
    const fetched = (await client?.callTool({
      name: "fetch-new-items",
      arguments: {},
    })) as ToolTextResult;

    expect(fetched.isError).toBeFalsy();
    expect(fetched.structuredContent).toMatchObject({
      providersProcessed: 21,
      itemsFetched: 20,
      itemsInserted: 20,
      duplicates: 0,
    });

    const pending = (await client?.callTool({
      name: "get-unprocessed-items",
      arguments: { limit: 20 },
    })) as ToolTextResult & { structuredContent: { items: { id: string }[] } };

    expect(pending.structuredContent.items).toHaveLength(20);
    const [firstItem, secondItem, ...restItems] = pending.structuredContent.items;

    const created = (await client?.callTool({
      name: "create-story",
      arguments: {
        contentItemIds: [firstItem.id],
        title: "Test story",
        summary: "A test story summary.",
        relevanceScore: 0.9,
        importanceScore: 0.5,
      },
    })) as ToolTextResult & { structuredContent: { id: string; lastMeaningfulUpdateAt: string } };

    expect(created.isError).toBeFalsy();
    const storyId = created.structuredContent.id;
    const originalUpdateTime = created.structuredContent.lastMeaningfulUpdateAt;

    const attached = (await client?.callTool({
      name: "attach-item-to-story",
      arguments: {
        storyId,
        contentItemId: secondItem.id,
        contribution: "meaningful-update",
        reason: "Second source confirms a new development.",
      },
    })) as ToolTextResult & { structuredContent: { lastMeaningfulUpdateAt: string } };

    expect(attached.isError).toBeFalsy();
    expect(attached.structuredContent.lastMeaningfulUpdateAt >= originalUpdateTime).toBe(true);

    const updated = (await client?.callTool({
      name: "update-story",
      arguments: { storyId, summary: "Updated summary after the second source." },
    })) as ToolTextResult & { structuredContent: { summary: string } };

    expect(updated.structuredContent.summary).toBe("Updated summary after the second source.");

    const active = (await client?.callTool({
      name: "get-active-stories",
      arguments: {},
    })) as ToolTextResult & {
      structuredContent: { stories: { id: string; sourceNames: string[] }[] };
    };

    expect(active.structuredContent.stories).toHaveLength(1);
    expect(active.structuredContent.stories[0]?.sourceNames.length).toBeGreaterThanOrEqual(2);

    const feed = (await client?.callTool({
      name: "get-feed",
      arguments: {},
    })) as ToolTextResult & { structuredContent: { stories: { id: string }[] } };

    expect(feed.structuredContent.stories.map((story) => story.id)).toContain(storyId);

    const ignored = (await client?.callTool({
      name: "mark-item-processed",
      arguments: { contentItemId: restItems[0]?.id, status: "ignored", reason: "Not relevant." },
    })) as ToolTextResult;

    expect(ignored.isError).toBeFalsy();

    const missing = (await client?.callTool({
      name: "mark-item-processed",
      arguments: { contentItemId: "does-not-exist", status: "ignored" },
    })) as ToolTextResult;

    expect(missing.isError).toBe(true);
  });
});
