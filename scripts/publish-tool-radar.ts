#!/usr/bin/env -S npx tsx
// Tool Radar's one and only publisher: entirely mechanical, stateless, and
// outside the MCP server process (never imported by src/composition.ts,
// never run by `npm run dev`/`start`, touches no SQLite table). Queries
// three independent public HTTP APIs (src/tool-radar/fetch.ts), ranks
// deterministically from that single run's data (src/tool-radar/
// transform.ts — no stored history, no deltas), and always publishes a
// result — even an all-failed one — via the same disposable-git-worktree
// pattern scripts/publish-feed.ts and scripts/publish-podcast.ts already
// use, so `tools.json`'s `generatedAt` always reflects the latest run.
//
// Reads GITHUB_TOKEN / HF_TOKEN from process.env only (script/CI-only, see
// .env.example) — this script doesn't import src/config.ts at all, so it
// loads .env itself for a local run, same as scripts/synthesize-podcast.ts.
// git push auth for the `feed` branch reuses whatever credentials are
// already configured for `origin` in this checkout.
import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

import { collectRawToolRadarSources } from "../src/tool-radar/fetch.js";
import { allSourcesFailed, buildToolRadarSnapshot } from "../src/tool-radar/transform.js";
import type { SourceStatus } from "../src/tool-radar/types.js";
import { publishJsonFile } from "./lib/worktree-publish.js";

const now = new Date();
const raw = await collectRawToolRadarSources(now);
const snapshot = buildToolRadarSnapshot(raw, now);

if (raw.githubPartialFailure !== undefined) {
  console.warn(`tool-radar: ${raw.githubPartialFailure}`);
}

// Listed explicitly rather than via Object.entries: an interface without an
// index signature falls back to TS's `[string, any][]` overload, which the
// no-unsafe-member-access rule (correctly) rejects.
const sourceStatuses: readonly (readonly [string, SourceStatus])[] = [
  ["github", snapshot.sources.github],
  ["huggingfaceModels", snapshot.sources.huggingfaceModels],
  ["huggingfaceSpaces", snapshot.sources.huggingfaceSpaces],
];

for (const [name, source] of sourceStatuses) {
  if (source.status === "error") {
    console.error(`tool-radar: ${name} failed this run: ${source.error ?? "unknown error"}`);
  } else {
    console.log(`tool-radar: ${name} contributed ${String(source.count)} entries`);
  }
}

// Always overwrites with this run's full content — merge-only publishing
// (like podcast.json's) doesn't apply here, since there's no per-item state
// to preserve across runs; every entry is recomputed from scratch each time.
publishJsonFile("tools.json", () => JSON.stringify(snapshot, null, 2) + "\n");

if (allSourcesFailed(snapshot)) {
  console.error("tool-radar: all three sources failed this run — tools.json was still published with entries: [].");
  process.exitCode = 1;
}
