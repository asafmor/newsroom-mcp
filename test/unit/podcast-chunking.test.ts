import { describe, expect, it } from "vitest";

import { CHUNK_SEPARATOR, packSegmentsIntoChunks } from "../../src/podcast/chunking.js";

describe("packSegmentsIntoChunks", () => {
  it("packs everything into one chunk when well under the limit", () => {
    const chunks = packSegmentsIntoChunks(["a", "b", "c"], 100);
    expect(chunks).toEqual([["a", "b", "c"].join(CHUNK_SEPARATOR)]);
  });

  it("preserves segment order across chunk boundaries", () => {
    const segments = ["1111", "2222", "3333", "4444"];
    // limit fits exactly two 4-char segments plus the 2-char separator (10 chars)
    const chunks = packSegmentsIntoChunks(segments, 10);

    expect(chunks).toEqual([
      ["1111", "2222"].join(CHUNK_SEPARATOR),
      ["3333", "4444"].join(CHUNK_SEPARATOR),
    ]);
  });

  it("never exceeds the given limit for any chunk", () => {
    const segments = Array.from({ length: 20 }, (_, i) => `segment-${String(i)}-`.repeat(10));
    const limit = 200;
    const chunks = packSegmentsIntoChunks(segments, limit);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(limit);
    }
  });

  it("never splits a segment: every chunk is composed of whole segments joined by the separator", () => {
    const segments = ["alpha", "beta", "gamma", "delta"];
    const chunks = packSegmentsIntoChunks(segments, 12);

    const rejoined = chunks.flatMap((chunk) => chunk.split(CHUNK_SEPARATOR));
    expect(rejoined).toEqual(segments);
  });

  it("puts a single oversized segment alone in its own chunk rather than dropping or splitting it", () => {
    const oversized = "x".repeat(50);
    const chunks = packSegmentsIntoChunks(["short", oversized, "short2"], 20);

    expect(chunks).toContain(oversized);
  });

  it("returns an empty array for no segments", () => {
    expect(packSegmentsIntoChunks([])).toEqual([]);
  });

  it("defaults to the 4096-char TTS request limit", () => {
    const segments = [
      "a".repeat(2000),
      "b".repeat(2000),
      "c".repeat(2000),
    ];
    const chunks = packSegmentsIntoChunks(segments);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
    expect(chunks).toHaveLength(2);
  });
});
