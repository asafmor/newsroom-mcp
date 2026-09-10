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
    // Still distinguishable without relying on hue alone.
    expect(rule).toContain("border-left-color");
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
