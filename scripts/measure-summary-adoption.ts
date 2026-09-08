#!/usr/bin/env -S npx tsx
// Read-only measurement of adoption for the structured lede+bullets summary
// convention (docs/agent-system-prompt.md) against one published feed.json
// snapshot. No network, no live DB/server, no writes — this is a manually
// run report, never wired into `npm run verify`/CI (it measures, it doesn't
// gate). Usage: npm run measure-summary-adoption -- <path-to-feed.json>
import { readFileSync } from "node:fs";

import { parseSummary } from "../src/shared/summary-format.js";
import { SUMMARY_STRUCTURE_THRESHOLD } from "../src/tools/summary-structure.js";
import { developmentCount } from "../views/_shared/feed/formatters.js";
import type { FeedStory } from "../views/_shared/feed/types.js";

// Imported, not redeclared: the report must bucket on exactly the length the
// create-story/update-story nudge uses, or the two would drift apart and the
// measurement would stop describing the thing the fix actually changed.
const STRUCTURE_THRESHOLD = SUMMARY_STRUCTURE_THRESHOLD;
const SHORT_THRESHOLD = 200;

const snapshotPath = process.argv[2];
if (!snapshotPath) {
  console.error("Usage: npm run measure-summary-adoption -- <path-to-feed.json>");
  process.exit(1);
}

interface FeedSnapshot {
  readonly stories?: readonly FeedStory[];
}

/** Missing/unreadable/malformed snapshot reads as zero stories, never a crash. */
function loadStories(path: string): readonly FeedStory[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as FeedSnapshot;
    return parsed.stories ?? [];
  } catch {
    return [];
  }
}

/** Same recognition the reader-facing renderer uses — see src/tools/summary-structure.ts. */
function isStructured(summary: string): boolean {
  return parseSummary(summary).bullets.length > 0;
}

interface Bucket {
  readonly total: number;
  readonly structured: number;
}

function bucket(stories: readonly FeedStory[], matches: (s: FeedStory) => boolean): Bucket {
  const qualifying = stories.filter(matches);
  return { total: qualifying.length, structured: qualifying.filter((s) => isStructured(s.summary)).length };
}

function formatBucket(label: string, b: Bucket): string {
  if (b.total === 0) return `${label}: no qualifying stories`;
  const pct = ((b.structured / b.total) * 100).toFixed(1);
  return `${label}: ${String(b.structured)}/${String(b.total)} (${pct}%)`;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const stories = loadStories(snapshotPath);
const lengths = stories.map((s) => s.summary.length).toSorted((a, b) => a - b);

console.log(`Snapshot: ${snapshotPath}`);
console.log(`Total stories: ${String(stories.length)}`);
console.log("");

console.log("Length distribution (chars):");
console.log(
  lengths.length === 0
    ? "  no stories"
    : `  min=${String(lengths[0])} median=${String(median(lengths))} p90=${String(percentile(lengths, 0.9))} max=${String(lengths[lengths.length - 1])}`,
);
console.log("");

console.log(`Primary adoption — summaries > ${String(STRUCTURE_THRESHOLD)} chars with valid lede+bullets structure:`);
// Measured on the pre-fix published snapshot (origin/feed:feed.json, 50
// stories curated after PR #15 shipped) at this same >280 threshold. An
// earlier ad-hoc pass quoted 0/10, but that counted a >300 bucket; reusing it
// here would print a baseline against a different denominator than the one
// below it.
console.log("  (recorded pre-fix baseline: 0/15, 0%)");
console.log(`  ${formatBucket("Overall", bucket(stories, (s) => s.summary.length > STRUCTURE_THRESHOLD))}`);
console.log("");

console.log(`Regression guard — summaries < ${String(SHORT_THRESHOLD)} chars with valid structure (expected to stay near 0%):`);
console.log(`  ${formatBucket("Overall", bucket(stories, (s) => s.summary.length < SHORT_THRESHOLD))}`);
console.log("");

console.log("Mechanism check — primary metric split by prior meaningful-update history:");
const neverUpdated = stories.filter((s) => developmentCount(s) === 0);
const everUpdated = stories.filter((s) => developmentCount(s) > 0);
console.log(
  `  ${formatBucket("Never received a meaningful-update", bucket(neverUpdated, (s) => s.summary.length > STRUCTURE_THRESHOLD))}`,
);
console.log(
  `  ${formatBucket("Received 1+ meaningful-update(s)", bucket(everUpdated, (s) => s.summary.length > STRUCTURE_THRESHOLD))}`,
);
