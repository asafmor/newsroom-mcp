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
 * fetch-new-items exercises real provider/repository code (21 RSS feeds + HN;
 * the GitHub release provider list is currently empty — see
 * GITHUB_RELEASE_REPOS) without any real network traffic. Each feed has
 * a distinct providerId, so the identical fixture body yields one item per
 * feed, not a dedup collision.
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
        "geeky-gadgets.com",
        "modelcontextprotocol.io",
        "github.com",
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
      "merge-stories",
      "mark-item-processed",
      "get-feed",
    ]);
  });

  it("runs the full ingestion → clustering → feed lifecycle", async () => {
    // 21 RSS feeds + Hacker News each yield one item (no GitHub release repos tracked yet).
    const fetched = (await client?.callTool({
      name: "fetch-new-items",
      arguments: {},
    })) as ToolTextResult;

    expect(fetched.isError).toBeFalsy();
    expect(fetched.structuredContent).toMatchObject({
      providersProcessed: 22,
      itemsFetched: 22,
      itemsInserted: 22,
      duplicates: 0,
    });

    const pending = (await client?.callTool({
      name: "get-unprocessed-items",
      arguments: { limit: 29 },
    })) as ToolTextResult & { structuredContent: { items: { id: string }[] } };

    expect(pending.structuredContent.items).toHaveLength(22);
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
    })) as ToolTextResult & {
      structuredContent: { stories: { id: string; sources: { contribution: string }[] }[] };
    };

    expect(feed.structuredContent.stories.map((story) => story.id)).toContain(storyId);

    // Each feed source reports how it moved the story: the seed item came in
    // via create-story ("supporting"), the second via attach-item-to-story
    // ("meaningful-update"), oldest-attached-first.
    const feedStory = feed.structuredContent.stories.find((story) => story.id === storyId);
    expect(feedStory?.sources.map((source) => source.contribution)).toEqual(["supporting", "meaningful-update"]);

    const secondStory = (await client?.callTool({
      name: "create-story",
      arguments: {
        contentItemIds: [restItems[0]?.id],
        title: "Duplicate story",
        summary: "Turns out this is the same event as the first story.",
        relevanceScore: 0.6,
        importanceScore: 0.4,
      },
    })) as ToolTextResult & { structuredContent: { id: string } };

    expect(secondStory.isError).toBeFalsy();
    const losingStoryId = secondStory.structuredContent.id;

    const merged = (await client?.callTool({
      name: "merge-stories",
      arguments: { survivingStoryId: storyId, losingStoryId },
    })) as ToolTextResult & {
      structuredContent: { id: string; status: string; lastItemAttachedAt: string; lastMeaningfulUpdateAt: string };
    };

    expect(merged.isError).toBeFalsy();
    expect(merged.structuredContent.id).toBe(storyId);
    expect(merged.structuredContent.status).toBe("active");
    // lastItemAttachedAt reconciles to the later of the two pre-merge values,
    // which is the losing story's own creation (it was created after
    // storyId's last attach above).
    expect(merged.structuredContent.lastItemAttachedAt >= attached.structuredContent.lastMeaningfulUpdateAt).toBe(
      true,
    );

    const activeAfterMerge = (await client?.callTool({
      name: "get-active-stories",
      arguments: {},
    })) as ToolTextResult & {
      structuredContent: { stories: { id: string; sourceNames: string[] }[] };
    };

    expect(activeAfterMerge.structuredContent.stories.map((story) => story.id)).toEqual([storyId]);
    expect(activeAfterMerge.structuredContent.stories[0]?.sourceNames.length).toBeGreaterThanOrEqual(3);

    const feedAfterMerge = (await client?.callTool({
      name: "get-feed",
      arguments: {},
    })) as ToolTextResult & { structuredContent: { stories: { id: string }[] } };

    const feedIds = feedAfterMerge.structuredContent.stories.map((story) => story.id);
    expect(feedIds).toContain(storyId);
    expect(feedIds).not.toContain(losingStoryId);

    const ignored = (await client?.callTool({
      name: "mark-item-processed",
      arguments: { contentItemId: restItems[1]?.id, status: "ignored", reason: "Not relevant." },
    })) as ToolTextResult;

    expect(ignored.isError).toBeFalsy();

    const missing = (await client?.callTool({
      name: "mark-item-processed",
      arguments: { contentItemId: "does-not-exist", status: "ignored" },
    })) as ToolTextResult;

    expect(missing.isError).toBe(true);
  });
});
