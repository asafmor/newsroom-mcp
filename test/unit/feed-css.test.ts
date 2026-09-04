import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("feed touch behavior", () => {
  it("does not trigger Chromium's post-drag click suppression on the sheet header", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const dragHeaderRule = /\.sheet-drag-header\s*\{[^}]*\}/.exec(css)?.[0];

    expect(dragHeaderRule).toContain("touch-action: manipulation");
    expect(dragHeaderRule).not.toMatch(/touch-action:\s*(?:none|pan-x)/);
  });
});

describe("feed header typography", () => {
  it("uses smaller sort text without shrinking the fixed-height toggle buttons", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const sortTabRule = /\.newsroomFeed \.sort-tab\s*\{[^}]*\}/.exec(css)?.[0];

    expect(sortTabRule).toContain("height: calc(var(--control-h) - 4px)");
    expect(sortTabRule).toContain("font-size: 12px");
    expect(sortTabRule).toContain("line-height: 12.8px");
  });
});

describe("story development markers", () => {
  it("tints the development badge and the meaningful-update tag with the accent color", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    // Shares one rule with .delta-badge — see "story delta badge" below.
    const badgeRule = /\.newsroomFeed \.development-badge,[^{]*\{[^}]*\}/.exec(css)?.[0];
    const tagRule = /\.newsroomFeed \.contribution-tag\s*\{[^}]*\}/.exec(css)?.[0];
    const developmentTagRule = /\.newsroomFeed \.contribution-tag\.is-development\s*\{[^}]*\}/.exec(css)?.[0];

    expect(badgeRule).toContain("background: var(--accent-soft)");
    expect(badgeRule).toContain("color: var(--accent)");
    // A plain tag stays quiet; only the new-development one borrows the accent.
    expect(tagRule).toContain("color: var(--muted)");
    expect(developmentTagRule).toContain("color: var(--accent)");
  });
});

describe("read-state legibility", () => {
  it("never dims .story-title or .story-summary from a read-state rule", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    // Every rule whose selector list mentions a read-state hook alongside
    // .story-title/.story-summary — walk every `selector { body }` block.
    const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
    const readSelector = /read/i;
    const storyTextSelector = /\.story-title|\.story-summary/;

    let match: RegExpExecArray | null;
    const offenders: string[] = [];
    while ((match = ruleRegex.exec(css)) !== null) {
      const [, selector, body] = match;
      if (readSelector.test(selector) && storyTextSelector.test(selector)) {
        if (/\bcolor\s*:|\bopacity\s*:/.test(body)) offenders.push(selector.trim());
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps .story-card--read de-emphasis to border-only — no background/color/opacity shift", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
    // Excludes border-color/etc. by requiring the property name isn't
    // preceded by a word char or hyphen (so "border-color:" doesn't match "color:").
    const bannedProperty = /(?<![\w-])(background(-color)?|color|opacity)\s*:/;

    let match: RegExpExecArray | null;
    const offenders: string[] = [];
    while ((match = ruleRegex.exec(css)) !== null) {
      const [, selector, body] = match;
      if (selector.includes("story-card--read") && bannedProperty.test(body)) {
        offenders.push(selector.trim());
      }
    }

    expect(offenders).toEqual([]);
  });

  it("gives unread cards a non-color marker element, not a color-only signal", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const markerRule = /\.unread-marker\s*\{[^}]*\}/.exec(css)?.[0];

    expect(markerRule).toBeDefined();
    expect(markerRule).toContain("position: absolute");
  });
});

describe("story delta badge", () => {
  it("shares one rule with the development badge it replaces, so the two can never drift apart", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const badgeRule =
      /\.newsroomFeed \.development-badge,\s*\.newsroomFeed \.delta-badge\s*\{[^}]*\}/.exec(css)?.[0];

    expect(badgeRule).toBeDefined();
    expect(badgeRule).toContain("background: var(--accent-soft)");
    expect(badgeRule).toContain("color: var(--accent)");
  });

  it("gives the new-source/new-bullet sheet flag a real-text tag distinct from is-development", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const isNewRule = /\.newsroomFeed \.contribution-tag\.is-new\s*\{[^}]*\}/.exec(css)?.[0];

    expect(isNewRule).toBeDefined();
    expect(isNewRule).toContain("color: var(--accent)");
    // Outlined, not filled — visually distinct from .is-development even though both use accent.
    expect(isNewRule).toContain("border: 1px solid var(--accent)");
  });

  it("renders the badge as real text in StoryCard, never a bare icon/dot", () => {
    const tsx = readFileSync(new URL("../../views/_shared/feed/StoryCard.tsx", import.meta.url), "utf8");

    expect(tsx).toMatch(/<span className="delta-badge"[^>]*>\s*\{badgeText\}\s*<\/span>/);
  });

  it("demotes the cumulative badge to neutral on a read card, so accent means only 'changed since your last visit'", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const tsx = readFileSync(new URL("../../views/_shared/feed/StoryCard.tsx", import.meta.url), "utf8");
    const historicalRule = /\.newsroomFeed \.development-badge\.is-historical\s*\{[^}]*\}/.exec(css)?.[0];

    // Neutral, not accent — otherwise it reads as a fresh change at a glance.
    expect(historicalRule).toContain("color: var(--muted)");
    expect(historicalRule).not.toContain("var(--accent)");
    // No pill fill: it inherits .story-meta-row's own --muted-on-surface pair,
    // which clears WCAG AA in both themes. A faint grey chip did not (4.20:1).
    expect(historicalRule).toContain("background: transparent");
    // Applied only when the card is known-read; unread cards keep the accent.
    expect(tsx).toContain('isRead === true ? "development-badge is-historical" : "development-badge"');
  });
});

describe("story summary preview", () => {
  it("clamps the card preview to 3 lines, leaving the full text only in the detail sheet", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const summaryRule = /\.story-summary\s*\{[^}]*\}/.exec(css)?.[0];
    const sheetSummaryRule = /\.sheet-summary\s*\{[^}]*\}/.exec(css)?.[0];

    expect(summaryRule).toContain("-webkit-line-clamp: 3");
    expect(summaryRule).toContain("overflow: hidden");
    // The detail-sheet copy must stay untruncated.
    expect(sheetSummaryRule).toBeDefined();
    expect(sheetSummaryRule).not.toMatch(/line-clamp/);
  });
});

describe("mobile filter row recomposition", () => {
  it("gives search its own full row, wrapping provider/tag onto the next one, below 640px", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const filterRowRule = /\.filter-row\s*\{[^}]*\}/.exec(css)?.[0];
    const searchInputRule = /\.newsroomFeed \.search-input\s*\{[^}]*\}/.exec(css)?.[0];

    expect(filterRowRule).toContain("flex-wrap: wrap");
    expect(searchInputRule).toContain("flex: 1 1 100%");
  });

  it("restores the single-row layout at >=640px on the site, but never in the fixed-width MCP panel", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const desktopBlock = /@media \(min-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

    expect(desktopBlock).toMatch(/\.newsroomFeed:not\(\.newsroomFeed--mcp\) \.filter-row\s*\{\s*flex-wrap: nowrap;/);
  });
});

describe("feed freshness", () => {
  it("renders staleness as a real text node, not a color/icon-only signal", () => {
    // The invariant that matters ("not color alone") lives in the markup,
    // not the stylesheet — a CSS-only check here would pass even if the
    // text were swapped for a bare icon. Check the JSX literal instead.
    const tsx = readFileSync(new URL("../../views/_shared/feed/FeedHeader.tsx", import.meta.url), "utf8");

    expect(tsx).toMatch(/<span className="stale-badge">Stale<\/span>/);
  });
});

describe("feed header controls", () => {
  it("gives the theme toggle a persistent background with stronger interaction states", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const themeToggleRule = /\.newsroomFeed \.theme-toggle\s*\{[^}]*\}/.exec(css)?.[0];
    const themeToggleHoverRule = /\.theme-toggle:hover\s*\{[^}]*\}/.exec(css)?.[0];
    const themeToggleActiveRule = /\.theme-toggle:active\s*\{[^}]*\}/.exec(css)?.[0];

    expect(themeToggleRule).toContain("width: var(--control-h)");
    expect(themeToggleRule).toContain("height: var(--control-h)");
    expect(themeToggleRule).toContain("background: var(--border-soft)");
    expect(themeToggleHoverRule).toContain("var(--fg) 6%");
    expect(themeToggleActiveRule).toContain("var(--fg) 11%");
  });

  it("uses the sort-label font size without shrinking the search and select controls", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const searchInputRule = /\.newsroomFeed \.search-input\s*\{[^}]*\}/.exec(css)?.[0];
    // The provider and tag selects share one grouped rule, so match past the
    // rest of the selector list rather than requiring the brace to follow.
    const selectRule = /\.newsroomFeed \.provider-select[^{]*\{[^}]*\}/.exec(css)?.[0];

    // The tag select must inherit the same sizing, not drift into its own rule.
    expect(selectRule).toContain(".newsroomFeed .tag-select");

    for (const rule of [searchInputRule, selectRule]) {
      expect(rule).toContain("height: 40px");
      expect(rule).toContain("font-size: var(--text-xs)");
      expect(rule).toContain("line-height: 12.8px");
    }
  });
});
