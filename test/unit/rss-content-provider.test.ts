import { afterEach, describe, expect, it, vi } from "vitest";
import { RssContentProvider } from "../../src/providers/rss/rss-content-provider.js";
import type { ProviderState } from "../../src/domain/provider.js";
import type { RssProviderState } from "../../src/providers/rss/rss-types.js";

const FEED_URL = "https://example.com/feed.xml";

function rss(itemsXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>${itemsXml}</channel></rss>`;
}

function item(opts: {
  guid?: string;
  link?: string;
  title?: string;
  pubDate?: string;
}): string {
  const { guid, link, title = "Item", pubDate } = opts;
  return `<item>
    ${guid !== undefined ? `<guid>${guid}</guid>` : ""}
    ${link !== undefined ? `<link>${link}</link>` : ""}
    <title>${title}</title>
    ${pubDate !== undefined ? `<pubDate>${pubDate}</pubDate>` : ""}
  </item>`;
}

function provider(): RssContentProvider {
  return new RssContentProvider({ id: "rss:test", name: "Test Feed", url: FEED_URL });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RssContentProvider.fetchNew", () => {
  it("first fetch (state: null) returns all items and a sensible nextState", async () => {
    const body = rss(
      item({ guid: "1", link: "https://example.com/1", title: "First", pubDate: "Mon, 01 Jan 2024 00:00:00 GMT" }) +
        item({ guid: "2", link: "https://example.com/2", title: "Second", pubDate: "Tue, 02 Jan 2024 00:00:00 GMT" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { ETag: '"abc"', "Last-Modified": "Tue, 02 Jan 2024 00:00:00 GMT" },
          }),
        ),
      ),
    );

    const result = await provider().fetchNew(null);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.title)).toEqual(["First", "Second"]);
    const nextState = result.nextState as RssProviderState;
    expect(nextState.etag).toBe('"abc"');
    expect(nextState.lastModified).toBe("Tue, 02 Jan 2024 00:00:00 GMT");
    expect(nextState.latestPublishedAt).toBe(new Date("Tue, 02 Jan 2024 00:00:00 GMT").toISOString());
  });

  it("second fetch with state.latestPublishedAt filters out already-seen items", async () => {
    const body = rss(
      item({ guid: "1", link: "https://example.com/1", title: "Old", pubDate: "Mon, 01 Jan 2024 00:00:00 GMT" }) +
        item({ guid: "2", link: "https://example.com/2", title: "New", pubDate: "Wed, 03 Jan 2024 00:00:00 GMT" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const state: ProviderState = { latestPublishedAt: new Date("Tue, 02 Jan 2024 00:00:00 GMT").toISOString() };
    const result = await provider().fetchNew(state);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("New");
    // high-water mark advances to the newest item seen this poll
    const nextState = result.nextState as RssProviderState;
    expect(nextState.latestPublishedAt).toBe(new Date("Wed, 03 Jan 2024 00:00:00 GMT").toISOString());
  });

  it("a 304 response returns { items: [], nextState: <unchanged> }", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 304 }))));

    const state: ProviderState = { etag: '"abc"', latestPublishedAt: "2024-01-02T00:00:00.000Z" };
    const result = await provider().fetchNew(state);

    expect(result.items).toEqual([]);
    expect(result.nextState).toEqual(state);
  });

  it("drops an item missing both guid and link, keeping the rest of the fetch", async () => {
    const body = rss(
      item({ title: "No id", pubDate: "Mon, 01 Jan 2024 00:00:00 GMT" }) +
        item({ guid: "2", link: "https://example.com/2", title: "Good", pubDate: "Tue, 02 Jan 2024 00:00:00 GMT" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await provider().fetchNew(null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Good");
  });

  it("skips an item with an unparseable pubDate rather than throwing", async () => {
    const body = rss(
      item({ guid: "1", link: "https://example.com/1", title: "Bad date", pubDate: "not-a-date" }) +
        item({ guid: "2", link: "https://example.com/2", title: "Good", pubDate: "Tue, 02 Jan 2024 00:00:00 GMT" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await provider().fetchNew(null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Good");
  });

  it("sends If-None-Match / If-Modified-Since from state and threads etag/lastModified into nextState", async () => {
    const body = rss(item({ guid: "1", link: "https://example.com/1", title: "Item", pubDate: "Mon, 01 Jan 2024 00:00:00 GMT" }));
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(body, { status: 200, headers: { ETag: '"def"' } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const state: ProviderState = { etag: '"abc"', lastModified: "Sun, 31 Dec 2023 00:00:00 GMT" };
    const result = await provider().fetchNew(state);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('"abc"');
    expect(headers["If-Modified-Since"]).toBe("Sun, 31 Dec 2023 00:00:00 GMT");

    const nextState = result.nextState as RssProviderState;
    expect(nextState.etag).toBe('"def"'); // new etag from response overrides previous
    expect(nextState.lastModified).toBe("Sun, 31 Dec 2023 00:00:00 GMT"); // no new header, carried forward
  });
});
