import { describe, expect, it } from "vitest";

import { createStoryInputSchema, getStoryInputSchema, updateStoryInputSchema } from "../../src/tools/schemas.js";

const baseCreateInput = {
  contentItemIds: ["item-1"],
  title: "Title",
  summary: "Summary",
  relevanceScore: 0.5,
  importanceScore: 0.5,
};

describe("createStoryInputSchema tags", () => {
  it("accepts zero or more valid vocabulary values", () => {
    expect(createStoryInputSchema.safeParse(baseCreateInput).success).toBe(true);
    expect(createStoryInputSchema.safeParse({ ...baseCreateInput, tags: [] }).success).toBe(true);
    expect(createStoryInputSchema.safeParse({ ...baseCreateInput, tags: ["safety", "funding"] }).success).toBe(true);
  });

  it("rejects a value outside the closed vocabulary", () => {
    const result = createStoryInputSchema.safeParse({ ...baseCreateInput, tags: ["misc"] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 3 tags", () => {
    const result = createStoryInputSchema.safeParse({
      ...baseCreateInput,
      tags: ["safety", "funding", "research", "opinion"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate values within one array", () => {
    const result = createStoryInputSchema.safeParse({ ...baseCreateInput, tags: ["safety", "safety"] });
    expect(result.success).toBe(false);
  });
});

describe("updateStoryInputSchema tags", () => {
  const base = { storyId: "story-1" };

  it("allows omitting tags entirely", () => {
    expect(updateStoryInputSchema.safeParse(base).success).toBe(true);
  });

  it("allows an explicit empty array (clears tags)", () => {
    expect(updateStoryInputSchema.safeParse({ ...base, tags: [] }).success).toBe(true);
  });

  it("rejects a value outside the closed vocabulary", () => {
    expect(updateStoryInputSchema.safeParse({ ...base, tags: ["misc"] }).success).toBe(false);
  });

  it("rejects more than 3 tags", () => {
    expect(
      updateStoryInputSchema.safeParse({ ...base, tags: ["safety", "funding", "research", "opinion"] }).success,
    ).toBe(false);
  });

  it("rejects duplicate values within one array", () => {
    expect(updateStoryInputSchema.safeParse({ ...base, tags: ["safety", "safety"] }).success).toBe(false);
  });
});

describe("getStoryInputSchema", () => {
  it("accepts a non-empty storyId", () => {
    expect(getStoryInputSchema.safeParse({ storyId: "story-1" }).success).toBe(true);
  });

  it("rejects an empty storyId", () => {
    expect(getStoryInputSchema.safeParse({ storyId: "" }).success).toBe(false);
  });

  it("rejects a missing storyId", () => {
    expect(getStoryInputSchema.safeParse({}).success).toBe(false);
  });
});
