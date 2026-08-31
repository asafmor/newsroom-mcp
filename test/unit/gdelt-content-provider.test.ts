import { afterEach, describe, expect, it, vi } from "vitest";
import { GdeltContentProvider } from "../../src/providers/gdelt/gdelt-content-provider.js";
import type { ProviderState } from "../../src/domain/provider.js";
import type { GdeltProviderState } from "../../src/providers/gdelt/gdelt-types.js";

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))));
}

function provider(): GdeltContentProvider {
  return new GdeltContentProvider({ id: "gdelt:ai", name: "GDELT AI", query: "OpenAI OR Anthropic" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GdeltContentProvider.fetchNew", () => {
  it("parses the compact seendate format to the correct UTC Date", async () => {
    stubFetch({
      articles: [{ url: "https://example.com/1", title: "A", seendate: "20260830T121500Z" }],
    });

    const result = await provider().fetchNew(null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.publishedAt).toEqual(new Date("2026-08-30T12:15:00Z"));
  });

  it("first fetch (state: null) maps articles correctly including metadata", async () => {
    stubFetch({
      articles: [
        {
          url: "https://example.com/1",
          title: "First",
          seendate: "20260830T120000Z",
          domain: "example.com",
          sourcecountry: "United States",
          language: "English",
        },
      ],
    });

    const result = await provider().fetchNew(null);

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item).toBeDefined();
    expect(item.providerId).toBe("gdelt:ai");
    expect(item.externalId).toBe("https://example.com/1");
    expect(item.url).toBe("https://example.com/1");
    expect(item.kind).toBe("article");
    expect(item.title).toBe("First");
    expect(item.metadata).toEqual({ domain: "example.com", sourceCountry: "United States", language: "English" });
  });

  it("filters out already-seen articles using state.latestSeenAt", async () => {
    stubFetch({
      articles: [
        { url: "https://example.com/old", title: "Old", seendate: "20260830T100000Z" },
        { url: "https://example.com/new", title: "New", seendate: "20260830T130000Z" },
      ],
    });

    const state: ProviderState = { latestSeenAt: "2026-08-30T12:00:00.000Z" };
    const result = await provider().fetchNew(state);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("New");
  });

  it("nextState.latestSeenAt is the max seen publishedAt", async () => {
    stubFetch({
      articles: [
        { url: "https://example.com/a", title: "A", seendate: "20260830T100000Z" },
        { url: "https://example.com/b", title: "B", seendate: "20260830T150000Z" },
      ],
    });

    const result = await provider().fetchNew(null);

    const nextState = result.nextState as GdeltProviderState;
    expect(nextState.latestSeenAt).toBe(new Date("2026-08-30T15:00:00Z").toISOString());
  });

  it("nextState.latestSeenAt does not regress on an empty response", async () => {
    stubFetch({ articles: [] });

    const state: ProviderState = { latestSeenAt: "2026-08-30T12:00:00.000Z" };
    const result = await provider().fetchNew(state);

    expect(result.items).toEqual([]);
    const nextState = result.nextState as GdeltProviderState;
    expect(nextState.latestSeenAt).toBe("2026-08-30T12:00:00.000Z");
  });

  it("skips an article missing url without throwing", async () => {
    stubFetch({
      articles: [
        { title: "No url", seendate: "20260830T100000Z" },
        { url: "https://example.com/good", title: "Good", seendate: "20260830T110000Z" },
      ],
    });

    const result = await provider().fetchNew(null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Good");
  });

  it("throws an Error including the GDELT error message on {error: ...} body", async () => {
    stubFetch({ error: "query is too short" });

    await expect(provider().fetchNew(null)).rejects.toThrow(/query is too short/);
  });

  it("throws a descriptive error on a non-ok HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 500, statusText: "Internal Server Error" }))),
    );

    await expect(provider().fetchNew(null)).rejects.toThrow(/gdelt:ai/i);
  });
});
