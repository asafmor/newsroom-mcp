import { describe, expect, it } from "vitest";

import { PODCAST_MAX_SEGMENTS, PODCAST_SEGMENT_MAX_CHARS } from "../../src/domain/podcast.js";
import { submitPodcastEpisodeInputSchema } from "../../src/tools/schemas.js";

function segmentsOfTotalLength(totalChars: number, segmentLength = 500): string[] {
  const segments: string[] = [];
  let remaining = totalChars;
  while (remaining > 0) {
    const length = Math.min(segmentLength, remaining);
    segments.push("x".repeat(length));
    remaining -= length;
  }
  return segments;
}

const validInput = {
  title: "This week in AI",
  segments: segmentsOfTotalLength(6000),
};

describe("submitPodcastEpisodeInputSchema", () => {
  it("accepts a well-formed submission within the documented bounds", () => {
    expect(submitPodcastEpisodeInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(submitPodcastEpisodeInputSchema.safeParse({ ...validInput, title: "  " }).success).toBe(false);
  });

  it("rejects zero segments", () => {
    expect(submitPodcastEpisodeInputSchema.safeParse({ ...validInput, segments: [] }).success).toBe(false);
  });

  it("rejects a whitespace-only segment", () => {
    const result = submitPodcastEpisodeInputSchema.safeParse({
      ...validInput,
      segments: [...validInput.segments, "   "],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a segment over the per-segment cap", () => {
    const result = submitPodcastEpisodeInputSchema.safeParse({
      title: validInput.title,
      segments: ["x".repeat(PODCAST_SEGMENT_MAX_CHARS + 1)],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a segment exactly at the per-segment cap", () => {
    const result = submitPodcastEpisodeInputSchema.safeParse({
      title: validInput.title,
      segments: [...segmentsOfTotalLength(4500 - PODCAST_SEGMENT_MAX_CHARS), "x".repeat(PODCAST_SEGMENT_MAX_CHARS)],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than the maximum number of segments", () => {
    const result = submitPodcastEpisodeInputSchema.safeParse({
      title: validInput.title,
      segments: Array.from({ length: PODCAST_MAX_SEGMENTS + 1 }, () => "a valid short segment"),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a total script length below the documented minimum, with the computed total and range in the message", () => {
    const result = submitPodcastEpisodeInputSchema.safeParse({
      title: validInput.title,
      segments: segmentsOfTotalLength(300),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(" ");
      expect(message).toContain("300");
      expect(message).toContain("4500");
      expect(message).toContain("9000");
    }
  });

  it("rejects a total script length above the documented maximum", () => {
    const result = submitPodcastEpisodeInputSchema.safeParse({
      title: validInput.title,
      segments: segmentsOfTotalLength(9500, 1000),
    });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit voice from the closed set and rejects one outside it", () => {
    expect(submitPodcastEpisodeInputSchema.safeParse({ ...validInput, voice: "echo" }).success).toBe(true);
    expect(submitPodcastEpisodeInputSchema.safeParse({ ...validInput, voice: "not-a-voice" }).success).toBe(false);
  });

  it("trims segments and title", () => {
    const result = submitPodcastEpisodeInputSchema.safeParse({
      title: "  Trimmed title  ",
      segments: ["  leading and trailing space  ", ...validInput.segments.slice(1)],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Trimmed title");
      expect(result.data.segments[0]).toBe("leading and trailing space");
    }
  });
});
