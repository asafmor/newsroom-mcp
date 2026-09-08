import { describe, expect, it } from "vitest";

import { needsStructureNudge, SUMMARY_STRUCTURE_THRESHOLD } from "../../src/tools/summary-structure.js";

function proseOfLength(n: number): string {
  return "a".repeat(n);
}

describe("needsStructureNudge", () => {
  it("is false below the threshold even with no structure", () => {
    expect(needsStructureNudge(proseOfLength(SUMMARY_STRUCTURE_THRESHOLD - 1))).toBe(false);
  });

  it("is false above the threshold when the summary already has valid lede+bullets structure", () => {
    const bullets = Array.from(
      { length: 8 },
      (_, i) => `- Bullet number ${String(i)} with plenty of padding text to add length`,
    ).join("\n");
    const raw = `${proseOfLength(50)}\n\n${bullets}`;
    expect(raw.length).toBeGreaterThan(SUMMARY_STRUCTURE_THRESHOLD);

    expect(needsStructureNudge(raw)).toBe(false);
  });

  it("is true above the threshold with no structure", () => {
    expect(needsStructureNudge(proseOfLength(SUMMARY_STRUCTURE_THRESHOLD + 1))).toBe(true);
  });

  it("is false exactly at the 280-char boundary (strictly-greater semantics)", () => {
    expect(needsStructureNudge(proseOfLength(SUMMARY_STRUCTURE_THRESHOLD))).toBe(false);
  });

  // The threshold must mean the same thing to this predicate as `.min(1)`
  // already means to the schema: UTF-16 code units via String.prototype
  // .length, not grapheme clusters. An emoji counts as its surrogate pair, so
  // 140 of them clear a 280 boundary the naive "one visible character each"
  // reading would say they miss.
  it("measures length in the same units the schema's min-length check uses", () => {
    const astral = "😀".repeat(140);
    expect(astral.length).toBe(SUMMARY_STRUCTURE_THRESHOLD);
    expect(needsStructureNudge(astral)).toBe(false);
    expect(needsStructureNudge(`${astral}😀`)).toBe(true);
  });

  it("still fires when a line break is present but one line fails the bullet test", () => {
    const raw = `${proseOfLength(200)}\n- A bullet\n${proseOfLength(100)}\n- Another bullet`;
    expect(raw.length).toBeGreaterThan(SUMMARY_STRUCTURE_THRESHOLD);

    expect(needsStructureNudge(raw)).toBe(true);
  });
});
