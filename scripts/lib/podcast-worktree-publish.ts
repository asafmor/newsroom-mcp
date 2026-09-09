// Publishes a computed `podcast.json` to the `feed` branch via a disposable
// git worktree, mirroring publish-feed.sh's pattern (direct in-process
// call, disposable worktree, never touching the caller's working tree) but
// adding the push-retry loop D.18/D.19/D.21 require: on a non-fast-forward
// rejection, re-fetch and reset the worktree to the latest `origin/feed`
// and re-run `compute` against it (so a concurrent writer's change is
// re-merged, never clobbered) before retrying the push, up to 3 total
// attempts. Shared by scripts/publish-podcast.ts (D.18) and
// scripts/synthesize-podcast.ts (D.19) — same discipline, same code.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { pushWithRetry, type PushAttemptOutcome } from "../../src/podcast/push-retry.js";

function git(args: string[], cwd: string) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

/**
 * `compute(currentContent)` receives the current `podcast.json` text
 * (`undefined` if the file doesn't exist on `feed` yet — not an error) and
 * must return the full desired next content, or `undefined` if there's
 * nothing to publish. Called fresh on every retry attempt against whatever
 * `podcast.json` currently looks like on `origin/feed`.
 */
export type ComputePodcastJson = (currentContent: string | undefined) => string | undefined;

/**
 * Runs after `podcast.json` is written but before it's committed — a place
 * to stage any other file the new content depends on (e.g. a newly
 * synthesized episode's mp3 under `audio/`) so it lands in the SAME
 * commit. Optional: scripts/publish-podcast.ts (Phase 1) has no audio to
 * place and passes none.
 */
export type SyncWorktreeFiles = (worktreeDir: string, nextContent: string) => void;

export function publishPodcastJson(
  compute: ComputePodcastJson,
  repoDir: string = process.cwd(),
  syncFiles?: SyncWorktreeFiles,
): void {
  const worktreeDir = mkdtempSync(path.join(tmpdir(), "podcast-publish-"));
  let worktreeCreated = false;

  try {
    const result = pushWithRetry((): PushAttemptOutcome => {
      const fetch = git(["fetch", "origin", "feed"], repoDir);
      if (fetch.status !== 0) {
        throw new Error(`git fetch origin feed failed: ${fetch.stderr}`);
      }

      if (!worktreeCreated) {
        const add = git(["worktree", "add", "-B", "feed", worktreeDir, "origin/feed"], repoDir);
        if (add.status !== 0) {
          throw new Error(`git worktree add failed: ${add.stderr}`);
        }
        worktreeCreated = true;
      } else {
        const worktreeFetch = git(["fetch", "origin", "feed"], worktreeDir);
        if (worktreeFetch.status !== 0) {
          throw new Error(`git fetch (worktree) failed: ${worktreeFetch.stderr}`);
        }
        const reset = git(["reset", "--hard", "origin/feed"], worktreeDir);
        if (reset.status !== 0) {
          throw new Error(`git reset --hard origin/feed failed: ${reset.stderr}`);
        }
      }

      const podcastJsonPath = path.join(worktreeDir, "podcast.json");
      const currentContent = existsSync(podcastJsonPath) ? readFileSync(podcastJsonPath, "utf8") : undefined;
      const nextContent = compute(currentContent);

      if (nextContent === undefined) {
        return "success"; // nothing new to publish this attempt
      }

      writeFileSync(podcastJsonPath, nextContent);
      syncFiles?.(worktreeDir, nextContent);

      // -A (not a fixed pathspec): also stages a newly copied audio/*.mp3
      // and any pruned (deleted) one in the SAME commit as podcast.json —
      // podcast.json must never be pushed pointing at an mp3 that hasn't
      // landed in the same commit. Nothing else in the worktree changes.
      const add = git(["add", "-A"], worktreeDir);
      if (add.status !== 0) {
        throw new Error(`git add failed: ${add.stderr}`);
      }

      const diff = git(["diff", "--cached", "--quiet"], worktreeDir);
      if (diff.status === 0) {
        return "success"; // computed content is unchanged — no empty commit
      }

      const commit = git(["commit", "-m", "Update podcast.json"], worktreeDir);
      if (commit.status !== 0) {
        throw new Error(`git commit failed: ${commit.stderr}`);
      }

      const push = git(["push", "origin", "feed"], worktreeDir);
      if (push.status === 0) {
        return "success";
      }

      const rejected = /rejected|non-fast-forward|fetch first/i.test(push.stderr);
      if (!rejected) {
        throw new Error(`git push failed: ${push.stderr}`);
      }

      // Undo the local commit before the next attempt recomputes against a
      // freshly fetched/reset base — otherwise the next reset --hard would
      // discard it anyway, but this keeps intent explicit.
      git(["reset", "--soft", "HEAD~1"], worktreeDir);
      return "rejected";
    }, 3);

    if (!result.succeeded) {
      throw new Error(`Failed to push podcast.json after ${String(result.attempts)} attempts (non-fast-forward each time)`);
    }
  } finally {
    git(["worktree", "remove", "--force", worktreeDir], repoDir);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}
