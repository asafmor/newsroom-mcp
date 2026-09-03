import { describe, expect, it } from "vitest";

import { contributionLabel, developmentCount } from "../../views/_shared/feed/formatters.js";
import type { FeedSource, FeedStory } from "../../views/_shared/feed/types.js";

function makeStory(sources: FeedSource[]): FeedStory {
  return {
    id: "story-1",
    title: "A story",
    summary: "s",
    lastMeaningfulUpdateAt: "2026-01-02T00:00:00.000Z",
    sources,
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
