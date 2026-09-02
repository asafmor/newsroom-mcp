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
