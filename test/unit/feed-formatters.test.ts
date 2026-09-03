import { describe, expect, it } from "vitest";

import {
  availableTags,
  contributionLabel,
  developmentCount,
  freshness,
  pruneReadIds,
  shortDate,
  shortTime,
  storyMatchesFilters,
  unreadCount,
} from "../../views/_shared/feed/formatters.js";
import type { FeedSource, FeedStory } from "../../views/_shared/feed/types.js";

function makeStory(sources: FeedSource[], overrides: Partial<FeedStory> = {}): FeedStory {
  return {
    id: "story-1",
    title: "A story",
    summary: "s",
    lastMeaningfulUpdateAt: "2026-01-02T00:00:00.000Z",
    sources,
    ...overrides,
  };
}

function makeSource(overrides: Partial<FeedSource> = {}): FeedSource {
  return {
    providerName: "OpenAI",
    title: "A report",
    url: "https://example.com/a",
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("developmentCount", () => {
  it("counts only the sources that reported a new development", () => {
    const story = makeStory([
      makeSource({ contribution: "supporting" }),
      makeSource({ contribution: "meaningful-update" }),
      makeSource({ contribution: "background" }),
      makeSource({ contribution: "meaningful-update" }),
    ]);

    expect(developmentCount(story)).toBe(2);
  });

  it("is zero for a story whose sources only corroborate each other", () => {
    const story = makeStory([makeSource({ contribution: "supporting" }), makeSource({ contribution: "background" })]);

    expect(developmentCount(story)).toBe(0);
  });

  it("treats sources from a pre-contribution feed.json snapshot as no developments", () => {
    const story = makeStory([makeSource(), makeSource()]);

    expect(developmentCount(story)).toBe(0);
  });
});

describe("contributionLabel", () => {
  it("labels the noteworthy roles and leaves supporting/unknown unlabeled", () => {
    expect(contributionLabel("meaningful-update")).toBe("New development");
    expect(contributionLabel("background")).toBe("Background");
    expect(contributionLabel("supporting")).toBeUndefined();
    expect(contributionLabel(undefined)).toBeUndefined();
  });
});

describe("availableTags", () => {
  it("returns the sorted set of tags actually present across the loaded stories", () => {
    const stories = [
      makeStory([makeSource()], { id: "a", tags: ["safety", "regulation"] }),
      makeStory([makeSource()], { id: "b", tags: ["funding"] }),
      makeStory([makeSource()], { id: "c", tags: ["safety"] }),
    ];

    expect(availableTags(stories)).toEqual(["funding", "regulation", "safety"]);
  });

  it("is empty for a feed where no story carries a tags field", () => {
    const stories = [makeStory([makeSource()], { id: "a" }), makeStory([makeSource()], { id: "b" })];

    expect(availableTags(stories)).toEqual([]);
  });
});

describe("storyMatchesFilters", () => {
  const story = makeStory([makeSource({ providerName: "OpenAI" })], { title: "GPT news", summary: "a launch", tags: ["product-launch"] });

  it("AND's provider, tag, and search together", () => {
    expect(storyMatchesFilters(story, { providerFilter: "all", tagFilter: "all", search: "" })).toBe(true);
    expect(storyMatchesFilters(story, { providerFilter: "OpenAI", tagFilter: "product-launch", search: "gpt" })).toBe(
      true,
    );
    expect(
      storyMatchesFilters(story, { providerFilter: "Anthropic", tagFilter: "product-launch", search: "" }),
    ).toBe(false);
    expect(storyMatchesFilters(story, { providerFilter: "all", tagFilter: "safety", search: "" })).toBe(false);
    expect(storyMatchesFilters(story, { providerFilter: "all", tagFilter: "all", search: "nomatch" })).toBe(false);
  });

  it("treats a story with no tags field as untagged — 'all' still matches, any specific tag doesn't", () => {
    const untagged = makeStory([makeSource()], { id: "untagged" });

    expect(storyMatchesFilters(untagged, { providerFilter: "all", tagFilter: "all", search: "" })).toBe(true);
    expect(storyMatchesFilters(untagged, { providerFilter: "all", tagFilter: "safety", search: "" })).toBe(false);
  });
});

describe("pruneReadIds", () => {
  it("drops stored ids with no overlap in the current feed", () => {
    expect(pruneReadIds(["a", "b"], ["c", "d"])).toEqual([]);
  });

  it("keeps a fully-contained stored set, deduplicated and order-independent", () => {
    expect(pruneReadIds(["b", "a", "a"], ["a", "b", "c"]).sort()).toEqual(["a", "b"]);
  });

  it("keeps exactly the overlap on a partial match", () => {
    expect(pruneReadIds(["a", "b", "x"], ["b", "c"])).toEqual(["b"]);
  });

  it("is empty when nothing was stored", () => {
    expect(pruneReadIds([], ["a", "b"])).toEqual([]);
  });

  it("is empty when the current feed is empty", () => {
    expect(pruneReadIds(["a", "b"], [])).toEqual([]);
  });
});

describe("freshness", () => {
  // Built from local Date components (not fixed UTC strings) and asserted
  // against shortTime/shortDate's own output, so these hold regardless of
  // the machine's timezone — only the calendar-day/threshold logic is new.

  it("shows time-only for a snapshot generated earlier today", () => {
    const now = new Date(2026, 8, 3, 13, 0);
    const generated = new Date(2026, 8, 3, 8, 2);

    const result = freshness(generated.toISOString(), now);

    expect(result.label).toBe(shortTime(generated.toISOString()));
    expect(result.stale).toBe(false);
  });

  it("shows date+time, never mistaken for today, for a snapshot from yesterday even if under 24h old", () => {
    // 11pm yesterday is only 2 hours before "now" — a naive 24h subtraction
    // would call this "today"; a local-calendar-day comparison must not.
    const now = new Date(2026, 8, 3, 1, 0);
    const generated = new Date(2026, 8, 2, 23, 0);

    const result = freshness(generated.toISOString(), now);

    expect(result.label).toBe(`${shortDate(generated.toISOString())}, ${shortTime(generated.toISOString())}`);
    expect(result.label).not.toBe(shortTime(generated.toISOString()));
  });

  it("shows date+time for a snapshot several days old, and marks it stale", () => {
    const now = new Date(2026, 8, 3, 12, 0);
    const generated = new Date(2026, 7, 30, 9, 0);

    const result = freshness(generated.toISOString(), now);

    expect(result.label).toBe(`${shortDate(generated.toISOString())}, ${shortTime(generated.toISOString())}`);
    expect(result.stale).toBe(true);
  });

  it("is not stale just under the 6-hour threshold", () => {
    const now = new Date(2026, 8, 3, 12, 0, 0, 0);
    const generated = new Date(now.getTime() - (6 * 60 * 60 * 1000 - 1));

    expect(freshness(generated.toISOString(), now).stale).toBe(false);
  });

  it("is stale at and past the 6-hour threshold", () => {
    const now = new Date(2026, 8, 3, 12, 0, 0, 0);
    const atThreshold = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const pastThreshold = new Date(now.getTime() - 7 * 60 * 60 * 1000);

    expect(freshness(atThreshold.toISOString(), now).stale).toBe(true);
    expect(freshness(pastThreshold.toISOString(), now).stale).toBe(true);
  });
});

describe("unreadCount", () => {
  const stories = [
    makeStory([makeSource()], { id: "a" }),
    makeStory([makeSource()], { id: "b" }),
    makeStory([makeSource()], { id: "c" }),
  ];

  it("equals the total when nothing is read", () => {
    expect(unreadCount(stories, new Set())).toBe(3);
  });

  it("is zero when everything is read", () => {
    expect(unreadCount(stories, new Set(["a", "b", "c"]))).toBe(0);
  });

  it("counts only the unread ones on a mixed set", () => {
    expect(unreadCount(stories, new Set(["b"]))).toBe(2);
  });

  it("is zero for an empty story list", () => {
    expect(unreadCount([], new Set(["a"]))).toBe(0);
  });
});
