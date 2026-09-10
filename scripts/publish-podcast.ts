#!/usr/bin/env -S npx tsx
// Publishes the database's full podcast episode history onto the `feed`
// branch's podcast.json, merge-only: adds any episode not already present
// (by id) as `pending`, and leaves every already-published episode's audio
// state/metadata untouched (D.18). Direct in-process call — no MCP round
// trip, so it costs no extra agent tokens — via the same disposable
// git-worktree pattern scripts/publish-feed.ts already uses, with a
// push-retry loop for contention against the other two writers to `feed`
// (feed publish, site deploy).
import { buildNewsroomServices } from "../src/composition.js";
import { mergeNewEpisodes, parsePodcastJson } from "../src/podcast/podcast-json.js";
import { publishPodcastJson } from "./lib/worktree-publish.js";

const services = buildNewsroomServices();
const episodes = await services.podcasts.findAll();

if (episodes.length === 0) {
  console.log("No podcast episodes in the database; nothing to publish.");
  process.exit(0);
}

publishPodcastJson((currentContent) => {
  const current = currentContent === undefined ? undefined : parsePodcastJson(currentContent);
  const merged = mergeNewEpisodes(current, episodes, new Date());
  return JSON.stringify(merged, null, 2) + "\n";
});

console.log("podcast.json publish complete.");
