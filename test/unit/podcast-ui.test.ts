import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// No DOM/React test harness exists in this repo (see docs/testing.md) —
// these assert on the source text, the same convention test/unit/feed-css.test.ts
// already uses for FeedHeader.tsx/StoryCard.tsx/feed.css.

describe("podcast digest entry point (P1 UI-review finding)", () => {
  it("gives FeedApp an optional digestEntry link to the podcast section", () => {
    const tsx = readFileSync(new URL("../../views/_shared/feed/FeedApp.tsx", import.meta.url), "utf8");

    expect(tsx).toContain("digestEntry");
    expect(tsx).toMatch(/<a href=\{digestEntry\.href\} className="digest-bar">/);
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

describe("podcast digest entry point stays visible while scrolling (P2 UI-review follow-up)", () => {
  // Regression guard for the root cause the reviewer measured: .feed-header
  // and .app-shell both establish their own (non-scrolling) scroll
  // containers via overflow: hidden/auto on the standalone site, which traps
  // `position: sticky` and stops it from ever engaging — see the comment on
  // .feed-header in feed.css. The digest bar must render as a sibling of
  // .app-shell, not nested inside it, and stick on its own.
  const feedAppTsx = readFileSync(new URL("../../views/_shared/feed/FeedApp.tsx", import.meta.url), "utf8");
  const feedHeaderTsx = readFileSync(new URL("../../views/_shared/feed/FeedHeader.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");

  it("no longer renders the digest link inside FeedHeader", () => {
    expect(feedHeaderTsx).not.toContain("digestEntry");
    expect(feedHeaderTsx).not.toContain("digest-bar");
  });

  it("renders the digest bar before (a sibling of, not nested inside) .app-shell", () => {
    // Scoped to the `Feed` function body — an earlier, unrelated
    // .app-shell also appears in FeedApp's own pending/skeleton branch.
    const feedFnBody = feedAppTsx.slice(feedAppTsx.indexOf("function Feed("));
    const digestIndex = feedFnBody.indexOf('className="digest-bar"');
    const appShellIndex = feedFnBody.indexOf('className="app-shell"');

    expect(digestIndex).toBeGreaterThan(-1);
    expect(appShellIndex).toBeGreaterThan(-1);
    expect(digestIndex).toBeLessThan(appShellIndex);
  });

  it("sticks the digest bar itself with position: sticky", () => {
    const rule = /^\.digest-bar\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(rule).toBeDefined();
    expect(rule).toContain("position: sticky");
    expect(rule).toContain("top: 0");
  });
});

describe("podcast episode date range (P2 UI-review finding)", () => {
  it("renders a human calendar range as the primary date label, keeping the ISO code as secondary metadata", () => {
    const tsx = readFileSync(new URL("../../views/_shared/podcast/PodcastApp.tsx", import.meta.url), "utf8");

    expect(tsx).toContain("formatIsoWeekRange(episode.isoWeek)");
    expect(tsx).toMatch(/<span className="podcast-card-range">\{formatIsoWeekRange\(episode\.isoWeek\)\}<\/span>/);
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
