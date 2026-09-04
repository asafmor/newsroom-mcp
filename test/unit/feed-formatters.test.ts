import { describe, expect, it } from "vitest";

import {
  availableTags,
  computeStoryDelta,
  contributionLabel,
  developmentCount,
  freshness,
  msUntilNextThemeBoundary,
  parseSummary,
  pruneReadIds,
  resolveTheme,
  shortDate,
  shortTime,
  storyMatchesFilters,
  toStorySnapshot,
  unreadCount,
} from "../../views/_shared/feed/formatters.js";
import type { StorySnapshot } from "../../views/_shared/feed/formatters.js";
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

describe("resolveTheme", () => {
  // Local-time only, built from local Date components — holds regardless
  // of the machine's timezone, same discipline as the freshness tests above.

  it("is light at 07:00, the start of the day window", () => {
    expect(resolveTheme(new Date(2026, 8, 3, 7, 0, 0))).toBe("light");
  });

  it("is dark at 06:59, just before the day window opens", () => {
    expect(resolveTheme(new Date(2026, 8, 3, 6, 59, 0))).toBe("dark");
  });

  it("is light at 18:59, the last minute of the day window", () => {
    expect(resolveTheme(new Date(2026, 8, 3, 18, 59, 0))).toBe("light");
  });

  it("is dark at 19:00, the start of the night window", () => {
    expect(resolveTheme(new Date(2026, 8, 3, 19, 0, 0))).toBe("dark");
  });

  it("is dark at midnight", () => {
    expect(resolveTheme(new Date(2026, 8, 3, 0, 0, 0))).toBe("dark");
  });

  it("is light at midday", () => {
    expect(resolveTheme(new Date(2026, 8, 3, 12, 30, 0))).toBe("light");
  });

  it("is dark late at night", () => {
    expect(resolveTheme(new Date(2026, 8, 3, 23, 30, 0))).toBe("dark");
  });
});

describe("msUntilNextThemeBoundary", () => {
  // Same local-time discipline as resolveTheme above.

  it("is 60s from 18:59:00 to 19:00", () => {
    expect(msUntilNextThemeBoundary(new Date(2026, 8, 3, 18, 59, 0, 0))).toBe(60_000);
  });

  it("is 60s from 06:59:00 to 07:00", () => {
    expect(msUntilNextThemeBoundary(new Date(2026, 8, 3, 6, 59, 0, 0))).toBe(60_000);
  });

  it("rolls to the NEXT boundary (07:00 the following day) when now is exactly 19:00, never 0", () => {
    const delay = msUntilNextThemeBoundary(new Date(2026, 8, 3, 19, 0, 0, 0));
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBe(12 * 60 * 60 * 1000);
  });

  it("rolls to the same day's 19:00 when now is exactly 07:00, never 0", () => {
    const delay = msUntilNextThemeBoundary(new Date(2026, 8, 3, 7, 0, 0, 0));
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBe(12 * 60 * 60 * 1000);
  });

  it("crosses midnight correctly from 23:30 to next day's 07:00 (7.5h)", () => {
    expect(msUntilNextThemeBoundary(new Date(2026, 8, 3, 23, 30, 0, 0))).toBe(7.5 * 60 * 60 * 1000);
  });

  it("lands exactly on 19:00:00.000 from 18:59:30.500, sub-minute precision", () => {
    expect(msUntilNextThemeBoundary(new Date(2026, 8, 3, 18, 59, 30, 500))).toBe(29_500);
  });
});

describe("parseSummary", () => {
  it("passes prose with zero line breaks through unchanged, including a stray hyphen", () => {
    expect(parseSummary("GPT-4 - a new model")).toEqual({ lede: "GPT-4 - a new model", bullets: [] });
  });

  it("passes a single-sentence summary through as the lede with no bullets", () => {
    expect(parseSummary("OpenAI released a new model today.")).toEqual({
      lede: "OpenAI released a new model today.",
      bullets: [],
    });
  });

  it("splits a well-formed lede plus bullets, stripping the markers", () => {
    const raw = "OpenAI shipped GPT-5.\n\n- Faster inference\n- Lower price\n- New API";
    expect(parseSummary(raw)).toEqual({
      lede: "OpenAI shipped GPT-5.",
      bullets: ["Faster inference", "Lower price", "New API"],
    });
  });

  it("treats CRLF line breaks the same as LF", () => {
    const raw = "OpenAI shipped GPT-5.\r\n\r\n- Faster inference\r\n- Lower price";
    expect(parseSummary(raw)).toEqual({
      lede: "OpenAI shipped GPT-5.",
      bullets: ["Faster inference", "Lower price"],
    });
  });

  it("filters blank lines between bullets without falling back", () => {
    const raw = "Lede here.\n- First\n\n- Second\n   \n- Third";
    expect(parseSummary(raw)).toEqual({ lede: "Lede here.", bullets: ["First", "Second", "Third"] });
  });

  it("falls back to the full raw string when any non-lede line fails the bullet test", () => {
    const raw = "OpenAI shipped GPT-5.\n- Faster inference\nAlso available in the EU.\n- Lower price";
    expect(parseSummary(raw)).toEqual({ lede: raw, bullets: [] });
  });

  it("falls back to the full raw string when fewer than 2 non-blank lines remain", () => {
    const raw = "Just a lede.\n\n   \n";
    expect(parseSummary(raw)).toEqual({ lede: raw, bullets: [] });
  });

  it("is a lede-only paragraph, no list, for a multi-line summary with zero bullet lines", () => {
    // Only one non-blank line survives filtering -> falls under the "fewer
    // than 2 lines" unstructured rule, not a 1-bullet list.
    const raw = "Single point, no bullets at all.\n\n";
    const result = parseSummary(raw);
    expect(result.bullets).toEqual([]);
    expect(result.lede).toBe(raw);
  });

  it("is an empty paragraph for an empty string, never crashing", () => {
    expect(parseSummary("")).toEqual({ lede: "", bullets: [] });
  });

  it("does not deduplicate repeated bullets", () => {
    const raw = "Lede.\n- Same point\n- Same point";
    expect(parseSummary(raw)).toEqual({ lede: "Lede.", bullets: ["Same point", "Same point"] });
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

describe("toStorySnapshot", () => {
  it("captures unique source URLs, development count, tags, and parsed bullets", () => {
    const story = makeStory(
      [
        makeSource({ url: "https://a.example/1", contribution: "meaningful-update" }),
        makeSource({ url: "https://a.example/1" }), // duplicate URL, deduped
        makeSource({ url: "https://a.example/2", contribution: "supporting" }),
      ],
      { tags: ["safety"], summary: "Lede.\n\n- First\n- Second" },
    );

    expect(toStorySnapshot(story)).toEqual({
      sourceUrls: ["https://a.example/1", "https://a.example/2"],
      developmentCount: 1,
      tags: ["safety"],
      bullets: ["First", "Second"],
    });
  });

  it("defaults tags to [] and bullets to [] for an untagged, unstructured story", () => {
    const story = makeStory([makeSource()], { summary: "One paragraph." });

    expect(toStorySnapshot(story)).toEqual({
      sourceUrls: [story.sources[0].url],
      developmentCount: 0,
      tags: [],
      bullets: [],
    });
  });
});

describe("computeStoryDelta", () => {
  function makeSnapshot(overrides: Partial<StorySnapshot> = {}): StorySnapshot {
    return {
      sourceUrls: ["https://a.example/1"],
      developmentCount: 0,
      tags: [],
      bullets: [],
      ...overrides,
    };
  }

  it("is undefined with no cached snapshot — first-ever visit to this story, seed silently", () => {
    const story = makeStory([makeSource({ url: "https://a.example/1" })]);

    expect(computeStoryDelta(undefined, story)).toBeUndefined();
  });

  it("flags new unique source URLs and generates '+N sources' badge text", () => {
    const prior = makeSnapshot({ sourceUrls: ["https://a.example/1"] });
    const story = makeStory([
      makeSource({ url: "https://a.example/1" }),
      makeSource({ url: "https://a.example/2" }),
      makeSource({ url: "https://a.example/3" }),
    ]);

    const delta = computeStoryDelta(prior, story);

    expect(delta?.newSourceUrls).toEqual(new Set(["https://a.example/2", "https://a.example/3"]));
    expect(delta?.badgeText).toBe("+2 sources");
  });

  it("dedupes a duplicate URL against another source before flagging new", () => {
    const prior = makeSnapshot({ sourceUrls: ["https://a.example/1"] });
    // Two sources share the already-cached URL — neither is "new".
    const story = makeStory([makeSource({ url: "https://a.example/1" }), makeSource({ url: "https://a.example/1" })]);

    const delta = computeStoryDelta(prior, story);

    expect(delta?.newSourceUrls.size).toBe(0);
    expect(delta?.badgeText).toBeUndefined();
  });

  it("floors new-development count at zero and never fabricates a source change", () => {
    const prior = makeSnapshot({ sourceUrls: ["https://a.example/1"], developmentCount: 2 });
    const story = makeStory([makeSource({ url: "https://a.example/1", contribution: "meaningful-update" })]);

    const delta = computeStoryDelta(prior, story);

    expect(delta?.badgeText).toBeUndefined();
  });

  it("combines new sources and new developments into one badge, singular vs. plural", () => {
    const prior = makeSnapshot({ sourceUrls: ["https://a.example/1"], developmentCount: 0 });
    const story = makeStory([
      makeSource({ url: "https://a.example/1" }),
      makeSource({ url: "https://a.example/2", contribution: "meaningful-update" }),
    ]);

    const delta = computeStoryDelta(prior, story);

    expect(delta?.badgeText).toBe("+1 source, 1 new development");
  });

  it("counts a tag addition as a change, with real generic text, never a fabricated +0", () => {
    const prior = makeSnapshot({ sourceUrls: ["https://a.example/1"], tags: [] });
    const story = makeStory([makeSource({ url: "https://a.example/1" })], { tags: ["safety"] });

    const delta = computeStoryDelta(prior, story);

    expect(delta?.newSourceUrls.size).toBe(0);
    expect(delta?.badgeText).toBe("Updated");
  });

  it("is undefined badge text when nothing tracked changed", () => {
    const prior = makeSnapshot({ sourceUrls: ["https://a.example/1"] });
    const story = makeStory([makeSource({ url: "https://a.example/1" })]);

    expect(computeStoryDelta(prior, story)?.badgeText).toBeUndefined();
  });

  it("flags bullets added since the cached snapshot as a plain set difference, not a text diff", () => {
    const prior = makeSnapshot({ bullets: ["First", "Second"] });
    // "Second" is edited, not literally added, but the naive diff can't tell —
    // it reads as one dropped ("Second") and one added ("Second, revised").
    const story = makeStory([makeSource({ url: "https://a.example/1" })], {
      summary: "Lede.\n\n- First\n- Second, revised\n- Third",
    });

    const delta = computeStoryDelta(prior, story);

    expect(delta?.newBullets).toEqual(new Set(["Second, revised", "Third"]));
  });

  it("gives a bullets-only change no card badge — bullets are flagged in the sheet, but never vote on the badge", () => {
    // Deliberate: bullet detection is the noisiest signal (see the naive-diff
    // note in computeStoryDelta), so it stays out of the card badge every
    // scanning reader sees and only surfaces on an intentional card open.
    const prior = makeSnapshot({ sourceUrls: ["https://a.example/1"], bullets: ["First"] });
    const story = makeStory([makeSource({ url: "https://a.example/1" })], {
      summary: "Lede.\n\n- First\n- Second",
    });

    const delta = computeStoryDelta(prior, story);

    expect(delta?.newBullets).toEqual(new Set(["Second"]));
    expect(delta?.badgeText).toBeUndefined();
  });
});
