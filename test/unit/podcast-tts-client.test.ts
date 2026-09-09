import { describe, expect, it, vi } from "vitest";

import { synthesizeChunkWithRetry } from "../../src/podcast/tts-client.js";

const params = { text: "hello", voice: "alloy", instructions: "warm" };
const noDelay = { delayMs: () => 0 };

describe("synthesizeChunkWithRetry", () => {
  it("returns the buffer on the first successful attempt without retrying", async () => {
    const buffer = new ArrayBuffer(4);
    const request = vi.fn().mockResolvedValue(buffer);

    const result = await synthesizeChunkWithRetry(params, request, noDelay);

    expect(result).toBe(buffer);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(params);
  });

  it("retries a failing request and succeeds within the attempt budget", async () => {
    const buffer = new ArrayBuffer(4);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(buffer);

    const result = await synthesizeChunkWithRetry(params, request, noDelay);

    expect(result).toBe(buffer);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries an empty/invalid response body", async () => {
    const buffer = new ArrayBuffer(4);
    const request = vi.fn().mockResolvedValueOnce(new ArrayBuffer(0)).mockResolvedValueOnce(buffer);

    const result = await synthesizeChunkWithRetry(params, request, noDelay);
    expect(result).toBe(buffer);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("gives up after the default 3 attempts (2 retries) and throws a descriptive error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("persistent failure"));

    await expect(synthesizeChunkWithRetry(params, request, noDelay)).rejects.toThrow(/persistent failure/);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("honors a custom maxAttempts", async () => {
    const request = vi.fn().mockRejectedValue(new Error("nope"));

    await expect(synthesizeChunkWithRetry(params, request, { ...noDelay, maxAttempts: 1 })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never calls the real network — the seam is fully injectable", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const request = vi.fn().mockResolvedValue(new ArrayBuffer(2));
    await synthesizeChunkWithRetry(params, request, noDelay);

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
