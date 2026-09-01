#!/usr/bin/env -S npx tsx
// Publishes a get-feed(50) snapshot without going through an MCP client/AI
// agent: calls FeedService in-process, serializes exactly like
// get-feed-tool.ts, then hands the file to publish-feed.sh for the actual
// git worktree push.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildNewsroomServices } from "../src/composition.js";

const services = buildNewsroomServices();
const feed = await services.feedService.getFeed({ limit: 50, offset: 0 });

const serialized = {
  generatedAt: feed.generatedAt.toISOString(),
  stories: feed.stories.map((story) => ({
    ...story,
    firstSeenAt: story.firstSeenAt.toISOString(),
    lastMeaningfulUpdateAt: story.lastMeaningfulUpdateAt.toISOString(),
    sources: story.sources.map((source) => ({
      ...source,
      publishedAt: source.publishedAt.toISOString(),
    })),
  })),
  totalCount: feed.totalCount,
  hasMore: feed.hasMore,
};

const scratchFile = path.join(mkdtempSync(path.join(tmpdir(), "feed-")), "feed.json");
writeFileSync(scratchFile, JSON.stringify(serialized, null, 2));

const result = spawnSync(
  path.join(import.meta.dirname, "publish-feed.sh"),
  [scratchFile],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
