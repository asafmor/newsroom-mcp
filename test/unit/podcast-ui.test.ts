import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// No DOM/React test harness exists in this repo (see docs/testing.md) —
// these assert on the source text, the same convention test/unit/feed-css.test.ts
// already uses for FeedHeader.tsx/StoryCard.tsx/feed.css.

describe("podcast digest entry point (P1 UI-review finding)", () => {
  it("gives FeedApp an optional digestEntry link to the podcast section", () => {
    const tsx = readFileSync(new URL("../../views/_shared/feed/FeedApp.tsx", import.meta.url), "utf8");

    expect(tsx).toContain("digestEntry");
    // aria-label carries the full-sentence accessible name (P1-b UI-review
    // finding) — the visible compact/full text below it is deliberately
    // abbreviated, so it can't double as the accessible name on its own.
    expect(tsx).toMatch(/<a href=\{digestEntry\.href\} className="digest-bar" aria-label=\{digestEntry\.ariaLabel\}>/);
  });

  it("scrolls/links to the podcast section's own id", () => {
    const feedAppTsx = readFileSync(new URL("../../views/_shared/feed/FeedApp.tsx", import.meta.url), "utf8");
    const podcastAppTsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");

    expect(feedAppTsx).toContain("digestEntry.href");
    expect(podcastAppTsx).toContain('id="podcast-digest"');
  });

  it("computes the header entry from the newest episode in site/src/main.tsx", () => {
    const mainTsx = readFileSync(new URL("../../site/src/main.tsx", import.meta.url), "utf8");

    expect(mainTsx).toContain("latestDigestEntry");
    expect(mainTsx).toContain("digestEntry={digestEntry}");
  });
});

describe("podcast digest entry point stays visible while scrolling (round-2 UI-review follow-up)", () => {
  // Round-2 finding: rendering the bar as a sibling BEFORE .app-shell (so it
  // sat above the whole Newsroom header) made it read as global navigation
  // while its own content read as an afterthought. It now renders AFTER the
  // complete feed header and BEFORE the story list, inside .app-shell/
  // .scroll-area — and still sticks, because those two ancestors switched
  // from `overflow: hidden`/`auto` (which trap `position: sticky`) to
  // `overflow: clip` on the standalone site (see feed.css). .feed-header's
  // own pre-existing `position: sticky` is explicitly neutralized back to
  // `static` there, so only the entry bar sticks, not the whole header.
  const feedAppTsx = readFileSync(new URL("../../views/_shared/feed/FeedApp.tsx", import.meta.url), "utf8");
  const feedHeaderTsx = readFileSync(new URL("../../views/_shared/feed/FeedHeader.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");

  it("no longer renders the digest link inside FeedHeader", () => {
    expect(feedHeaderTsx).not.toContain("digestEntry");
    expect(feedHeaderTsx).not.toContain("digest-bar");
  });

  it("renders the entry bar inside .app-shell/.scroll-area, after <FeedHeader> and before the story list", () => {
    // Scoped to the `Feed` function body — an earlier, unrelated
    // .app-shell also appears in FeedApp's own pending/skeleton branch.
    const feedFnBody = feedAppTsx.slice(feedAppTsx.indexOf("function Feed("));
    const appShellIndex = feedFnBody.indexOf('className="app-shell"');
    const headerIndex = feedFnBody.indexOf("<FeedHeader");
    const rowIndex = feedFnBody.indexOf('className="entry-bar-row"');
    const storyFeedIndex = feedFnBody.indexOf('className="story-feed"');

    expect(appShellIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeGreaterThan(appShellIndex);
    expect(rowIndex).toBeGreaterThan(headerIndex);
    expect(storyFeedIndex).toBeGreaterThan(rowIndex);
  });

  it("scopes .app-shell/.scroll-area overflow to `clip` on the site so sticky isn't trapped, while the MCP View keeps hidden/auto scrolling unchanged", () => {
    const mcpShellRule = /\.newsroomFeed--mcp \.app-shell\s*\{[^}]*\}/.exec(css)?.[0];
    const siteShellRule = /\.newsroomFeed:not\(\.newsroomFeed--mcp\) \.app-shell\s*\{[^}]*\}/.exec(css)?.[0];
    const mcpScrollRule = /\.newsroomFeed--mcp \.scroll-area\s*\{[^}]*\}/.exec(css)?.[0];
    const siteScrollRule = /\.newsroomFeed:not\(\.newsroomFeed--mcp\) \.scroll-area\s*\{[^}]*\}/.exec(css)?.[0];

    expect(mcpShellRule).toContain("overflow: hidden");
    expect(siteShellRule).toContain("overflow: clip");
    expect(siteShellRule).not.toContain("overflow: hidden");
    expect(mcpScrollRule).toContain("overflow-x: hidden");
    expect(mcpScrollRule).toContain("overflow-y: auto");
    expect(siteScrollRule).toContain("overflow-x: clip");
  });

  it("neutralizes .feed-header's sticky back to static on the site, so only the entry bar sticks there", () => {
    const baseHeaderRule = /^\.feed-header\s*\{[^}]*\}/m.exec(css)?.[0];
    const siteHeaderStaticRule = /\.newsroomFeed:not\(\.newsroomFeed--mcp\) \.feed-header\s*\{\s*position: static;\s*\}/.exec(
      css,
    )?.[0];

    // The base rule (MCP View) keeps its sticky behavior unchanged.
    expect(baseHeaderRule).toContain("position: sticky");
    expect(siteHeaderStaticRule).toBeDefined();
  });

  // Sticky lives on .entry-bar-row, the wrapper, not on .digest-bar. A sticky
  // element can only travel within its own containing block, and the row is
  // exactly as tall as the bars inside it — so sticky on the bar had zero room
  // and the shortcut scrolled away with the feed. This test used to assert the
  // rule on .digest-bar and passed the whole time the behavior was broken, so
  // it now pins the element that actually has somewhere to travel.
  it("sticks the entry bar row (the bars' containing block) with position: sticky", () => {
    const rowRule = /^\.entry-bar-row\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(rowRule).toBeDefined();
    expect(rowRule).toContain("position: sticky");
    expect(rowRule).toContain("top: 0");
    // Sticky on the child would be inert — and worse, would look correct in a
    // computed-style check while never actually sticking.
    expect(/^\.digest-bar\s*\{[^}]*\}/m.exec(css)?.[0]).not.toContain("position: sticky");
  });
});

describe("podcast episode date range (P2 UI-review finding: covered dates, not the calendar ISO week)", () => {
  it("renders a human calendar range derived from publishedAt as the primary date label, keeping the ISO code as secondary metadata", () => {
    const tsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");

    // NOT formatIsoWeekRange(episode.isoWeek): that range can start after the
    // covered content and end days in the future for a mid-week submission.
    expect(tsx).toContain("formatCoveredDateRange(episode.publishedAt)");
    expect(tsx).toMatch(/<span className="podcast-card-range">\{formatCoveredDateRange\(episode\.publishedAt\)\}<\/span>/);
    expect(tsx).toMatch(/<span className="podcast-card-week">\{episode\.isoWeek\}<\/span>/);
  });
});

describe("podcast failed-audio copy (P2 UI-review finding)", () => {
  it("never claims both 'no automated recovery' and an automatic retry in the same breath", () => {
    const tsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");

    expect(tsx).not.toMatch(/no automated recovery/i);
    expect(tsx).toContain("We&rsquo;ll retry automatically");
    expect(tsx).toContain("couldn&rsquo;t be produced");
  });

  it("gives the reader no retry control — recovery is CI-only", () => {
    const tsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");
    const failedBlock = /if \(episode\.audioStatus === "failed"\) \{[\s\S]*?\n {2}\}/.exec(tsx)?.[0] ?? "";

    expect(failedBlock).not.toMatch(/<button/);
  });
});

describe("podcast transcript default visibility (P2 UI-review finding)", () => {
  it("defaults the transcript open for every non-ready audio status", () => {
    const tsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");

    expect(tsx).toContain('const transcriptDefaultOpen = episode.audioStatus !== "ready";');
    expect(tsx).toContain("defaultOpen={transcriptDefaultOpen}");
    // The initial React state is seeded from the prop, not hardcoded closed.
    expect(tsx).toContain("useState(defaultOpen)");
  });
});

describe("transcript highlighting before playback (P1 review finding)", () => {
  it("leaves currentTime null until the first onTimeUpdate, so no line is marked active at rest", () => {
    const tsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");

    // Seeded to 0, activeSegmentIndex(0, ...) returns 0 and the first
    // paragraph reads as narrated before the reader ever pressed play.
    expect(tsx).toContain("useState<number | null>(null)");
    expect(tsx).toContain("currentTime !== null &&");
  });
});

describe("mobile episode-head layout (P2 UI-review finding)", () => {
  it("declares the mobile card-head override after the base rule, so it wins the cascade", () => {
    const css = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");

    // Same specificity, so source order alone decides. Declared earlier (as
    // it first was), the mobile rule silently loses and the metadata keeps
    // rendering as a right-aligned vertical stack.
    const base = css.indexOf(".podcast-card-head {");
    const override = css.indexOf(".podcast-card-head {", base + 1);

    expect(base).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(base);
    expect(css.slice(0, override)).toContain("@media (max-width: 639px)");
  });
});

describe("transcript highlight text metrics (P2 UI-review finding)", () => {
  it("does not change font weight on the active line, which would rewrap it mid-narration", () => {
    const css = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");
    const rule = /\.podcast-transcript-line--active\s*\{[^}]*\}/.exec(css)?.[0];

    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/font-weight|font-size|letter-spacing/);
  });

  it("draws the active line's accent bar as an absolutely positioned ::before in the gutter, not padding/a border that would shift or overlap the text", () => {
    const css = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");
    const beforeRule = /\.podcast-transcript-line--active::before\s*\{[^}]*\}/.exec(css)?.[0];

    expect(beforeRule).toBeDefined();
    expect(beforeRule).toContain("position: absolute");
  });
});

describe("podcast loading skeleton under reduced motion (P2 UI-review finding)", () => {
  it("disables the skeleton shimmer outright, rather than relying on the inherited near-0ms override", () => {
    const css = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");
    const rule = /\.newsroomPodcast \.skel-bar\s*\{[^}]*\}/.exec(css)?.[0];

    expect(rule).toBeDefined();
    expect(rule).toContain("animation: none !important");
  });

  it("keeps that override scoped to the podcast surface only, matching the reviewer's stated preference", () => {
    const css = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");
    const feedCss = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    // The shared global rule (feed.css) is left untouched — only shortened
    // via `!important`, never fully disabled there.
    expect(feedCss).toMatch(/\.newsroomFeed \* \{ animation-duration: 0\.01ms !important;/);
  });
});

describe("podcast player copy", () => {
  it("carries no AI-narration disclosure paragraph next to the player", () => {
    const tsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");

    expect(tsx).not.toContain("AI_VOICE_DISCLOSURE");
    expect(tsx).not.toContain("podcast-disclosure");
    expect(css).not.toContain("podcast-disclosure");
  });
});
