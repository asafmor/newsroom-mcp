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

// GitHub's public release Atom feed (https://github.com/<owner>/<repo>/releases.atom):
// bare-version titles, an <updated> element but no <published>, and a
// permalink <link rel="alternate">. Mirrors the real feed shape.
function githubReleaseFeed(entriesXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from openai-python</title>
  ${entriesXml}
</feed>`;
}

function githubReleaseEntry(opts: { id: string; version: string; updated: string; notes?: string }): string {
  const { id, version, updated, notes = "" } = opts;
  return `<entry>
    <id>tag:github.com,2008:Repository/1/${id}</id>
    <link rel="alternate" type="text/html" href="https://github.com/openai/openai-python/releases/tag/${version}"/>
    <title>${version}</title>
    <updated>${updated}</updated>
    <content type="html">${notes}</content>
    <author><name>someone</name></author>
  </entry>`;
}

describe("RssContentProvider.fetchNew with kind: 'release' (GitHub release feeds)", () => {
  function releaseProvider(): RssContentProvider {
    return new RssContentProvider({
      id: "github-release:openai/openai-python",
      name: "openai-python",
      url: "https://github.com/openai/openai-python/releases.atom",
      kind: "release",
    });
  }

  it("tags every item with kind: 'release' (AC1)", async () => {
    const body = githubReleaseFeed(
      githubReleaseEntry({ id: "v3.7.0", version: "v3.7.0", updated: "2026-01-01T00:00:00Z" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await releaseProvider().fetchNew(null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe("release");
  });

  it("composes the title as '<repo name> <bare version>', never the bare version alone (AC2)", async () => {
    const body = githubReleaseFeed(
      githubReleaseEntry({ id: "v3.7.0", version: "v3.7.0", updated: "2026-01-01T00:00:00Z" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await releaseProvider().fetchNew(null);

    expect(result.items[0]?.title).toBe("openai-python v3.7.0");
  });

  it("uses the entry's alternate link as the item URL — the release permalink, not the feed URL (AC3)", async () => {
    const body = githubReleaseFeed(
      githubReleaseEntry({ id: "v3.7.0", version: "v3.7.0", updated: "2026-01-01T00:00:00Z" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await releaseProvider().fetchNew(null);

    expect(result.items[0]?.url).toBe("https://github.com/openai/openai-python/releases/tag/v3.7.0");
  });

  it("falls back to <updated> as publishedAt when the entry has no <published> element (AC4)", async () => {
    const body = githubReleaseFeed(
      githubReleaseEntry({ id: "v3.7.0", version: "v3.7.0", updated: "2026-01-01T12:34:56Z" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await releaseProvider().fetchNew(null);

    expect(result.items[0]?.publishedAt.toISOString()).toBe(new Date("2026-01-01T12:34:56Z").toISOString());
  });

  it("carries the full release notes through unmodified, with no fabrication (AC5)", async () => {
    const body = githubReleaseFeed(
      githubReleaseEntry({
        id: "v3.7.0",
        version: "v3.7.0",
        updated: "2026-01-01T00:00:00Z",
        notes: "<p>Fixes a bug.</p>",
      }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await releaseProvider().fetchNew(null);

    expect(result.items[0]?.content).toContain("Fixes a bug.");
  });

  it("passes through a pre-release/patch entry exactly like any other — no filtering by title or content (AC6)", async () => {
    const body = githubReleaseFeed(
      githubReleaseEntry({ id: "v3.7.0-rc1", version: "v3.7.0-rc1", updated: "2026-01-01T00:00:00Z" }) +
        githubReleaseEntry({ id: "v3.7.1", version: "v3.7.1", updated: "2026-01-02T00:00:00Z" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await releaseProvider().fetchNew(null);

    expect(result.items.map((i) => i.title)).toEqual(["openai-python v3.7.0-rc1", "openai-python v3.7.1"]);
  });

  it("does not re-surface an already-ingested release on the next poll (AC7)", async () => {
    const firstBody = githubReleaseFeed(
      githubReleaseEntry({ id: "v3.7.0", version: "v3.7.0", updated: "2026-01-01T00:00:00Z" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(firstBody, { status: 200 }))));
    const first = await releaseProvider().fetchNew(null);

    const secondBody = githubReleaseFeed(
      githubReleaseEntry({ id: "v3.7.0", version: "v3.7.0", updated: "2026-01-01T00:00:00Z" }) +
        githubReleaseEntry({ id: "v3.8.0", version: "v3.8.0", updated: "2026-01-05T00:00:00Z" }),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(secondBody, { status: 200 }))));
    const second = await releaseProvider().fetchNew(first.nextState);

    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.title).toBe("openai-python v3.8.0");
  });

  it("a repository with no releases yet returns zero items and no error", async () => {
    const body = githubReleaseFeed("");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const result = await releaseProvider().fetchNew(null);

    expect(result.items).toEqual([]);
  });
});
