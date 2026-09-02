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

  it("uses the sort-label font size without shrinking the search and provider controls", () => {
    const css = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const searchInputRule = /\.newsroomFeed \.search-input\s*\{[^}]*\}/.exec(css)?.[0];
    const providerSelectRule = /\.newsroomFeed \.provider-select\s*\{[^}]*\}/.exec(css)?.[0];

    for (const rule of [searchInputRule, providerSelectRule]) {
      expect(rule).toContain("height: 40px");
      expect(rule).toContain("font-size: var(--text-xs)");
      expect(rule).toContain("line-height: 12.8px");
    }
  });
});
