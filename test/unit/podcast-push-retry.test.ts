import { describe, expect, it, vi } from "vitest";

import { pushWithRetry } from "../../src/podcast/push-retry.js";

describe("pushWithRetry", () => {
  it("succeeds on the first attempt without retrying", () => {
    const attempt = vi.fn().mockReturnValue("success");
    const result = pushWithRetry(attempt, 3);

    expect(result).toEqual({ succeeded: true, attempts: 1 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries a rejected push and succeeds within the attempt budget", () => {
    const attempt = vi.fn().mockReturnValueOnce("rejected").mockReturnValueOnce("success");
    const result = pushWithRetry(attempt, 3);

    expect(result).toEqual({ succeeded: true, attempts: 2 });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts rejections, calling attempt exactly maxAttempts times", () => {
    const attempt = vi.fn().mockReturnValue("rejected");
    const result = pushWithRetry(attempt, 3);

    expect(result).toEqual({ succeeded: false, attempts: 3 });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("propagates a thrown (non-retryable) failure immediately, without further attempts", () => {
    const attempt = vi.fn().mockImplementation(() => {
      throw new Error("non-retryable failure");
    });

    expect(() => pushWithRetry(attempt, 3)).toThrow(/non-retryable failure/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("passes the 1-based attempt number to each call", () => {
    const seen: number[] = [];
    const attempt = (attemptNumber: number) => {
      seen.push(attemptNumber);
      return attemptNumber < 3 ? "rejected" : "success";
    };

    pushWithRetry(attempt, 5);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("defaults maxAttempts to 3", () => {
    const attempt = vi.fn().mockReturnValue("rejected");
    pushWithRetry(attempt);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
