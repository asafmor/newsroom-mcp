import { describe, expect, it } from "vitest";

import {
  BOOKMARKS_MAX,
  actionLabel,
  addBookmark,
  bookmarkedEntries,
  parseStoredBookmarks,
  persistBookmarks,
  removeBookmark,
  toolsDigestEntry,
} from "../../views/_shared/tools/formatters.js";
import type { ToolEntry, ToolRadarSources } from "../../views/_shared/tools/types.js";

function entry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    id: "github:acme/widget",
    source: "github",
    kind: "repository",
    name: "widget",
    owner: "acme",
    url: "https://github.com/acme/widget",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const okSources: ToolRadarSources = {
  github: { status: "ok", count: 1 },
  huggingfaceModels: { status: "ok", count: 1 },
  huggingfaceSpaces: { status: "ok", count: 1 },
};

describe("parseStoredBookmarks (P1 UI-review finding: bookmarks must survive snapshot turnover)", () => {
  it("parses a well-formed array of stored ToolEntry snapshots", () => {
    const raw = JSON.stringify([entry(), entry({ id: "hf-model:acme/m", source: "huggingface", kind: "model" })]);
    expect(parseStoredBookmarks(raw)).toHaveLength(2);
  });

  it("degrades malformed JSON to empty, never throws", () => {
    expect(() => parseStoredBookmarks("{not json")).not.toThrow();
    expect(parseStoredBookmarks("{not json")).toEqual([]);
  });

  it("degrades the old bare-id-array shape to empty rather than partially trusting it", () => {
    expect(parseStoredBookmarks(JSON.stringify(["github:acme/widget", "hf-model:acme/m"]))).toEqual([]);
  });

  it("filters out individual malformed entries while keeping well-formed ones", () => {
    const raw = JSON.stringify([entry(), { id: "bad", name: "missing fields" }]);
    const parsed = parseStoredBookmarks(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("github:acme/widget");
  });

  it("degrades a non-array JSON value to empty", () => {
    expect(parseStoredBookmarks(JSON.stringify({ id: "not-an-array" }))).toEqual([]);
  });

  // P1 UI-review finding (round 2): a stored bookmark with a wrong-typed
  // *optional* field (an object where topics expects an array) used to flow
  // straight into render and crash the entire page via
  // `entry.topics?.map is not a function`. Every optional field must be
  // validated to its declared type; a bad one is dropped individually, the
  // entry (and its siblings) must survive.
  it("drops a wrong-typed topics field (object instead of array) but keeps the rest of the entry", () => {
    const raw = JSON.stringify([{ ...entry(), topics: { bad: true } }]);
    const parsed = parseStoredBookmarks(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.topics).toBeUndefined();
    expect(parsed[0]?.id).toBe("github:acme/widget");
  });

  it("caps a well-formed topics array at 5 entries, like the publish pipeline does", () => {
    const raw = JSON.stringify([{ ...entry(), topics: ["a", "b", "c", "d", "e", "f", "g"] }]);
    const parsed = parseStoredBookmarks(raw);
    expect(parsed[0]?.topics).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("drops the whole topics array when any element isn't a string", () => {
    const raw = JSON.stringify([{ ...entry(), topics: ["ok", 42] }]);
    const parsed = parseStoredBookmarks(raw);
    expect(parsed[0]?.topics).toBeUndefined();
  });

  it("drops wrong-typed numeric optional fields (string instead of number) individually", () => {
    const raw = JSON.stringify([{ ...entry(), starCount: "lots", likeCount: 12 }]);
    const parsed = parseStoredBookmarks(raw);
    expect(parsed[0]?.starCount).toBeUndefined();
    expect(parsed[0]?.likeCount).toBe(12);
  });

  it("drops wrong-typed string optional fields individually, keeping well-typed ones", () => {
    const raw = JSON.stringify([{ ...entry(), description: 123, language: "TypeScript" }]);
    const parsed = parseStoredBookmarks(raw);
    expect(parsed[0]?.description).toBeUndefined();
    expect(parsed[0]?.language).toBe("TypeScript");
  });

  it("drops an unparseable lastActivityAt while keeping the rest of the entry", () => {
    const raw = JSON.stringify([{ ...entry(), lastActivityAt: "not a date" }]);
    const parsed = parseStoredBookmarks(raw);
    expect(parsed[0]?.lastActivityAt).toBeUndefined();
    expect(parsed[0]?.id).toBe("github:acme/widget");
  });

  it("drops the whole entry when the required createdAt is unparseable", () => {
    const raw = JSON.stringify([{ ...entry(), createdAt: "not a date" }]);
    expect(parseStoredBookmarks(raw)).toEqual([]);
  });

  it("drops the whole entry when source/kind hold values outside their declared union", () => {
    const raw = JSON.stringify([{ ...entry(), kind: "not-a-real-kind" }]);
    expect(parseStoredBookmarks(raw)).toEqual([]);
  });
});

describe("persistBookmarks (P1 UI-review finding: denied writes must never present as a successful save)", () => {
  function fakeStorage(behavior: "ok" | "always-throw" | "throw-once"): Pick<Storage, "setItem"> {
    let calls = 0;
    return {
      setItem: () => {
        calls++;
        if (behavior === "ok") return;
        if (behavior === "always-throw") throw new DOMException("quota exceeded", "QuotaExceededError");
        if (calls === 1) throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    };
  }

  it("returns an equivalent map on a successful write", () => {
    const bookmarks = addBookmark(new Map(), entry());
    const result = persistBookmarks(bookmarks, fakeStorage("ok"));
    expect(result).toEqual(bookmarks);
  });

  it("evicts the oldest bookmark and retries once on a quota-style failure, returning the shrunk map on success", () => {
    let bookmarks = addBookmark(new Map(), entry({ id: "github:acme/oldest" }));
    bookmarks = addBookmark(bookmarks, entry({ id: "github:acme/newest" }));

    const result = persistBookmarks(bookmarks, fakeStorage("throw-once"));

    expect(result?.size).toBe(1);
    expect(result?.has("github:acme/oldest")).toBe(false);
    expect(result?.has("github:acme/newest")).toBe(true);
  });

  it("returns undefined when even the retry fails — the caller must not present the original map as saved", () => {
    const bookmarks = addBookmark(new Map(), entry());
    expect(persistBookmarks(bookmarks, fakeStorage("always-throw"))).toBeUndefined();
  });

  it("returns undefined for an already-empty map that still fails to write (nothing left to evict)", () => {
    expect(persistBookmarks(new Map(), fakeStorage("always-throw"))).toBeUndefined();
  });

  // Every test above injects `storage` explicitly, which skips the real
  // default path. A default *parameter* initializer evaluates before the
  // function body's try block, so `storage = localStorage` would let a throw
  // from merely reaching localStorage escape uncaught and take down the whole
  // page — there's no ErrorBoundary anywhere in site/ or views/.
  it("absorbs a throw from reaching localStorage itself when no storage is injected", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is not accessible");
      },
    });
    try {
      expect(() => persistBookmarks(addBookmark(new Map(), entry()))).not.toThrow();
      expect(persistBookmarks(addBookmark(new Map(), entry()))).toBeUndefined();
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});

describe("addBookmark / removeBookmark", () => {
  it("adds a full ToolEntry snapshot keyed by id", () => {
    const map = addBookmark(new Map(), entry());
    expect(map.get("github:acme/widget")).toEqual(entry());
  });

  it("re-adding an existing bookmark refreshes its stored snapshot and moves it to most-recent", () => {
    const first = addBookmark(new Map(), entry({ starCount: 10 }));
    const second = addBookmark(first, entry({ starCount: 20 }));
    expect(second.get("github:acme/widget")?.starCount).toBe(20);
    expect(second.size).toBe(1);
  });

  it("removeBookmark drops the id regardless of whether it's still in the current snapshot", () => {
    const map = addBookmark(new Map(), entry());
    expect(removeBookmark(map, "github:acme/widget").size).toBe(0);
  });

  it("evicts the single oldest bookmark once at BOOKMARKS_MAX, bounding storage growth", () => {
    let map = new Map<string, ToolEntry>();
    for (let i = 0; i < BOOKMARKS_MAX; i++) {
      map = addBookmark(map, entry({ id: `github:acme/repo-${String(i)}` }));
    }
    expect(map.size).toBe(BOOKMARKS_MAX);
    expect(map.has("github:acme/repo-0")).toBe(true);

    map = addBookmark(map, entry({ id: "github:acme/newest" }));

    expect(map.size).toBe(BOOKMARKS_MAX);
    expect(map.has("github:acme/repo-0")).toBe(false); // oldest evicted
    expect(map.has("github:acme/newest")).toBe(true);
  });
});

describe("bookmarkedEntries (P1 UI-review finding: weekly turnover must not delete bookmarks)", () => {
  it("prefers live data from the current snapshot when the bookmark is still present", () => {
    const bookmarks = addBookmark(new Map(), entry({ starCount: 10 }));
    const current = [entry({ starCount: 999 })];

    const [result] = bookmarkedEntries(bookmarks, current);

    expect(result.stale).toBe(false);
    expect(result.entry.starCount).toBe(999);
  });

  it("falls back to the stored snapshot — marked stale — once the bookmark leaves the current snapshot", () => {
    const bookmarks = addBookmark(new Map(), entry({ starCount: 10 }));
    // Next week's snapshot arrived and no longer includes it.
    const [result] = bookmarkedEntries(bookmarks, [entry({ id: "github:acme/other" })]);

    expect(result.stale).toBe(true);
    expect(result.entry.starCount).toBe(10);
  });

  // Blocking review finding (round 4): removing the top-level outage early
  // return made the bookmarks-only view reachable during a full outage, where
  // `entries` is []. An empty snapshot is zero evidence about what's trending,
  // so it must not brand every saved tool "No longer trending" at once.
  it("does not mark anything stale when the current snapshot is empty (outage or empty run)", () => {
    let bookmarks = addBookmark(new Map(), entry({ id: "github:acme/first" }));
    bookmarks = addBookmark(bookmarks, entry({ id: "hf-model:acme/second", kind: "model" }));

    const result = bookmarkedEntries(bookmarks, []);

    expect(result).toHaveLength(2);
    expect(result.every((item) => !item.stale)).toBe(true);
  });

  it("restoring a prior snapshot does not need to restore anything — the bookmark was never dropped", () => {
    const bookmarks = addBookmark(new Map(), entry());
    const gone = bookmarkedEntries(bookmarks, []);
    const restored = bookmarkedEntries(bookmarks, [entry()]);

    expect(gone).toHaveLength(1);
    expect(restored).toHaveLength(1);
  });

  it("orders newest-bookmarked-first", () => {
    let bookmarks = addBookmark(new Map(), entry({ id: "github:acme/first" }));
    bookmarks = addBookmark(bookmarks, entry({ id: "github:acme/second" }));

    const result = bookmarkedEntries(bookmarks, []);

    expect(result.map((r) => r.entry.id)).toEqual(["github:acme/second", "github:acme/first"]);
  });
});

describe("actionLabel (P2 UI-review finding: kind-appropriate action labels)", () => {
  it("gives each kind a distinct, appropriate label", () => {
    expect(actionLabel("repository")).toBe("View repository");
    expect(actionLabel("model")).toBe("View model");
    expect(actionLabel("space")).toBe("Open demo");
  });
});

describe("toolsDigestEntry", () => {
  it("returns a summary when there are entries and not every source failed, singularizing a lone tool (nit: was '1 tools')", () => {
    expect(toolsDigestEntry([entry()], okSources)).toEqual({ label: "Trending this week", statusLabel: "1 tool" });
  });

  it("pluralizes for more than one tool", () => {
    expect(toolsDigestEntry([entry(), entry({ id: "github:acme/other" })], okSources)).toEqual({
      label: "Trending this week",
      statusLabel: "2 tools",
    });
  });

  it("returns undefined when there are no entries", () => {
    expect(toolsDigestEntry([], okSources)).toBeUndefined();
  });

  it("returns undefined when every source errored, even if stale entries somehow remained", () => {
    const allErrored: ToolRadarSources = {
      github: { status: "error", count: 0, error: "g" },
      huggingfaceModels: { status: "error", count: 0, error: "m" },
      huggingfaceSpaces: { status: "error", count: 0, error: "s" },
    };
    expect(toolsDigestEntry([entry()], allErrored)).toBeUndefined();
  });
});
