// Generic "push, retry on rejection, give up after N attempts" decision
// logic shared by every writer that pushes to the `feed` branch (feed
// publish, podcast publish, podcast synthesis) — see
// `scripts/lib/worktree-publish.ts` for the git plumbing that
// drives this with a real `attempt` implementation.

export type PushAttemptOutcome = "success" | "rejected";

export interface PushRetryResult {
  readonly succeeded: boolean;
  readonly attempts: number;
}

/**
 * Calls `attempt(attemptNumber)` up to `maxAttempts` times. Returns as soon
 * as an attempt reports "success". An attempt reporting "rejected" (e.g. a
 * non-fast-forward push, because someone else pushed to `feed` first) is
 * retried; `attempt` should re-fetch/rebase against the latest remote state
 * before returning, so the next attempt in the loop pushes on top of it.
 * `attempt` throwing (any non-retryable failure) propagates immediately —
 * only "rejected" is retried.
 */
export function pushWithRetry(attempt: (attemptNumber: number) => PushAttemptOutcome, maxAttempts = 3): PushRetryResult {
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    if (attempt(attemptNumber) === "success") {
      return { succeeded: true, attempts: attemptNumber };
    }
  }

  return { succeeded: false, attempts: maxAttempts };
}
