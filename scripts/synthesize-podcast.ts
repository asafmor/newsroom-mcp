#!/usr/bin/env -S npx tsx
// Phase 2: the fully mechanical synthesis pipeline. Reads podcast.json off
// the `feed` branch, synthesizes real audio (OpenAI TTS) for every
// `pending`/`failed` episode, concatenates + probes with ffmpeg/ffprobe,
// uploads to a per-episode GitHub Release, and publishes the result back to
// podcast.json — merge-only, one episode at a time, so a mid-run failure
// never loses already-completed work. Runs identically in CI
// (.github/workflows/synthesize-podcast.yml) and locally: this is the one
// script both call, wiring the SAME src/podcast/ logic either way (F.37).
//
// Reads OPENAI_API_KEY/GITHUB_TOKEN/GITHUB_REPOSITORY from process.env only
// — never from src/config.ts/NewsroomConfig, which the MCP server never
// needs any of these for. This script doesn't import config.ts at all, so it
// has to load .env itself: in CI these come from the job environment, but a
// local run gets them from .env like every other NEWSROOM_* var. Without
// this, `npm run synthesize-podcast` fails locally even with a valid .env.
import { config as loadDotenv } from "dotenv";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

loadDotenv({ quiet: true });

import { defaultGithubApi } from "../src/podcast/github-api.js";
import { checkFfmpegAndFfprobeAvailable, defaultProcessRunner } from "../src/podcast/ffmpeg.js";
import { applyAudioResult, parsePodcastJson, type PodcastJsonFile } from "../src/podcast/podcast-json.js";
import { synthesizeEpisode } from "../src/podcast/synthesize-episode.js";
import { defaultTtsRequest } from "../src/podcast/tts-client.js";
import { publishPodcastJson } from "./lib/podcast-worktree-publish.js";

// Collapse an unknown error into one short, bounded line. Mirrors
// shortFailureReason() in src/podcast/synthesize-episode.ts so nothing
// unbounded (or a raw stack trace) reaches podcast.json or the run log.
function shortReason(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(/\s+/g, " ").trim().slice(0, 200) || fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required (script/CI-only — see .env.example)`);
  }
  return value;
}

async function main() {
  const openaiApiKey = requireEnv("OPENAI_API_KEY");
  const githubToken = requireEnv("GITHUB_TOKEN");
  const githubRepository = requireEnv("GITHUB_REPOSITORY"); // "owner/repo"

  const repoDir = process.cwd();
  const runProcess = defaultProcessRunner(spawnSync);

  const availability = checkFfmpegAndFfprobeAvailable(runProcess);
  if (!availability.available) {
    throw new Error(availability.message ?? "ffmpeg/ffprobe are not available on this runner");
  }

  const feedShow = spawnSync("git", ["fetch", "origin", "feed"], { cwd: repoDir, encoding: "utf8" });
  if (feedShow.status !== 0) {
    throw new Error(`git fetch origin feed failed: ${feedShow.stderr}`);
  }
  const showPodcastJson = spawnSync("git", ["show", "origin/feed:podcast.json"], { cwd: repoDir, encoding: "utf8" });
  const currentPodcast: PodcastJsonFile | undefined =
    showPodcastJson.status === 0 ? parsePodcastJson(showPodcastJson.stdout) : undefined;

  const eligible = (currentPodcast?.episodes ?? []).filter(
    (episode) => episode.audioStatus === "pending" || episode.audioStatus === "failed",
  );

  if (eligible.length === 0) {
    console.log("No eligible (pending/failed) episodes; nothing to synthesize.");
    return;
  }

  const githubApi = defaultGithubApi({ token: githubToken, repository: githubRepository });
  const scratchRoot = mkdtempSync(path.join(tmpdir(), "podcast-synth-"));

  // Each episode is processed and published independently: one episode's
  // failure never blocks another from being attempted or succeeding (same
  // failure-isolation principle IngestionService already uses per-provider).
  // The publish step is inside the per-episode try/catch too — publishing
  // throws when it exhausts its push retries against a busy `feed` branch,
  // and one lost publish must not starve the episodes queued behind it.
  let publishFailures = 0;

  for (const episode of eligible) {
    try {
      let result: Awaited<ReturnType<typeof synthesizeEpisode>>;

      try {
        const scratchDir = mkdtempSync(path.join(scratchRoot, `${episode.id}-`));
        result = await synthesizeEpisode(episode, {
          scratchDir,
          requestTts: (params) => defaultTtsRequest({ ...params, apiKey: openaiApiKey }),
          runProcess,
          githubApi,
          fs: {
            writeFile: (filePath, data) => {
              writeFileSync(filePath, data);
            },
            readFile: (filePath) => readFileSync(filePath),
          },
        });
      } catch (error) {
        // synthesizeEpisode() itself never throws — this only catches a truly
        // unexpected crash (e.g. disk full writing scratch files).
        result = { audioStatus: "failed", failureReason: shortReason(error, "Unexpected synthesis error") };
      }

      console.log(
        `Episode ${episode.id}: ${result.audioStatus}${result.audioStatus === "failed" ? ` (${result.failureReason})` : ""}`,
      );

      publishPodcastJson((currentContent) => {
        const current = currentContent === undefined ? undefined : parsePodcastJson(currentContent);
        const next = applyAudioResult(current, episode.id, result, new Date());
        return JSON.stringify(next, null, 2) + "\n";
      }, repoDir);
    } catch (error) {
      // Publishing this episode's result failed (e.g. persistent push
      // contention). Nothing is corrupted: the Release upload is idempotent
      // and podcast.json merging tolerates re-processing, so the next run
      // simply retries this episode. Keep going so the rest still publish.
      publishFailures += 1;
      console.error(
        `Episode ${episode.id}: could not publish its audio result; continuing with the remaining episodes. ${shortReason(error, "Unknown publish error")}`,
      );
    }
  }

  if (publishFailures > 0) {
    // Surface the partial failure to CI rather than reporting a green run.
    process.exitCode = 1;
  }
}

await main();
