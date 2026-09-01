#!/usr/bin/env bash
# Publishes a get-feed snapshot to the `feed` branch via a disposable worktree.
# Usage: scripts/publish-feed.sh <path-to-raw-get-feed-output.json>
set -euo pipefail

SRC_FILE="${1:?Usage: publish-feed.sh <path-to-get-feed-output.json>}"
REPO_DIR="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="$(mktemp -d)"

cleanup() { git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true; }
trap cleanup EXIT

git -C "$REPO_DIR" fetch origin feed
git -C "$REPO_DIR" worktree add -B feed "$WORKTREE_DIR" origin/feed

cp "$SRC_FILE" "$WORKTREE_DIR/feed.json"

git -C "$WORKTREE_DIR" add feed.json
if git -C "$WORKTREE_DIR" diff --cached --quiet; then
  echo "feed.json unchanged, nothing to publish"
else
  git -C "$WORKTREE_DIR" commit -m "Update feed.json snapshot from get-feed (limit 50)"
  git -C "$WORKTREE_DIR" push origin feed
fi
