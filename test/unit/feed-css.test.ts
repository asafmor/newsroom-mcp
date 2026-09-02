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
