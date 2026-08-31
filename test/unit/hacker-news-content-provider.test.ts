import { afterEach, describe, expect, it, vi } from "vitest";
import { HackerNewsContentProvider } from "../../src/providers/hacker-news/hacker-news-content-provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeProvider(): HackerNewsContentProvider {
  return new HackerNewsContentProvider({ id: "hacker-news", name: "Hacker News", query: "AI OR LLM" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HackerNewsContentProvider", () => {
  it("maps hits on first fetch, falling back url to the HN discussion link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hits: [
          {
            objectID: "111",
            author: "alice",
            title: "Some title",
            url: "https://example.com/article",
            created_at_i: 1000,
            points: 42,
            num_comments: 7,
          },
          {
            objectID: "222",
            author: "bob",
            title: "Ask HN: something",
            url: null,
            created_at_i: 2000,
            points: 3,
            num_comments: 0,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeProvider().fetchNew(null);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      providerId: "hacker-news",
      externalId: "111",
      kind: "discussion",
      title: "Some title",
      url: "https://example.com/article",
      authors: ["alice"],
      metadata: { points: 42, numComments: 7, hnDiscussionUrl: "https://news.ycombinator.com/item?id=111" },
    });
    expect(result.items[0].publishedAt).toEqual(new Date(1000 * 1000));
    expect(result.items[1].url).toBe("https://news.ycombinator.com/item?id=222");
    expect(result.nextState).toEqual({ latestCreatedAt: 2000 });
  });

  it("appends numericFilters when state.latestCreatedAt is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hits: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await makeProvider().fetchNew({ latestCreatedAt: 12345 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("numericFilters")).toBe("created_at_i>12345");
  });

  it("takes the max created_at_i across hits and doesn't regress on zero hits", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ hits: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeProvider().fetchNew({ latestCreatedAt: 5000 });

    expect(result.nextState).toEqual({ latestCreatedAt: 5000 });
  });

  it("skips a hit missing objectID without throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hits: [
          { title: "no id here", created_at_i: 100 },
          { objectID: "333", title: "valid", created_at_i: 200 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeProvider().fetchNew(null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].externalId).toBe("333");
    // high-water mark still accounts for the skipped hit's timestamp
    expect(result.nextState).toEqual({ latestCreatedAt: 200 });
  });

  it("throws a descriptive error on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    await expect(makeProvider().fetchNew(null)).rejects.toThrow(/hacker-news/);
  });
});
