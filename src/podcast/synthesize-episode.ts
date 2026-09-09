// Ties chunking + TTS + ffmpeg concat/probe together for one eligible
// episode. Every dependency is passed in (`SynthesisDeps`) — this is the
// "exact same synthesis-request/chunk-packing/concatenation code path" both
// the CI workflow step and the local script run (F.37):
// scripts/synthesize-podcast.ts is the one place that wires real
// implementations; tests wire stubs.
//
// Does NOT upload anywhere itself (there is no Release/CDN seam any more —
// see the iOS-playback fix in docs/mcp-tools.md): it returns the finished
// mp3's local path alongside the audio result, and the caller
// (scripts/synthesize-podcast.ts) is responsible for placing that file
// wherever `audio.url` ("audio/<episode.id>.mp3", relative — served
// same-origin by the static site) will resolve to.
import path from "node:path";

import { packSegmentsIntoChunks } from "./chunking.js";
import { concatenateMp3, probeDurationSeconds, type ProcessRunner } from "./ffmpeg.js";
import type { AudioResult, PodcastJsonEpisode } from "./podcast-json.js";
import { synthesizeChunkWithRetry, type TtsRequestFn } from "./tts-client.js";

const AUDIO_MIME_TYPE = "audio/mpeg";

export interface SynthesisFs {
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Buffer;
}

export interface SynthesisDeps {
  /** A fresh, empty directory this episode's synthesis may write scratch files into. */
  readonly scratchDir: string;
  readonly requestTts: TtsRequestFn;
  readonly runProcess: ProcessRunner;
  readonly fs: SynthesisFs;
}

export interface SynthesisOutcome {
  readonly result: AudioResult;
  /** The finished mp3's path in `scratchDir`, for the caller to copy into place. Present iff `result.audioStatus === "ready"`. */
  readonly localAudioPath?: string;
}

function shortFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Non-sensitive by construction: every error thrown in this module's own
  // code is built from HTTP status codes / ffmpeg-ffprobe stderr / GitHub
  // API status codes, never from a secret or a full stack trace.
  return message.replace(/\s+/g, " ").trim().slice(0, 200);
}

function buildConcatList(chunkPaths: readonly string[]): string {
  return chunkPaths.map((chunkPath) => `file '${chunkPath.replace(/'/g, String.raw`'\''`)}'`).join("\n");
}

/**
 * Synthesizes one episode's audio end to end. Never throws — a failure at
 * any stage (a chunk exhausting its retries, or ffmpeg/ffprobe failing or
 * reporting an invalid duration) resolves to `{ result: { audioStatus:
 * "failed", failureReason } }` rather than propagating, so the caller can
 * process every eligible episode independently (E.28) without a try/catch
 * of its own around each one.
 */
export async function synthesizeEpisode(episode: PodcastJsonEpisode, deps: SynthesisDeps): Promise<SynthesisOutcome> {
  try {
    const chunks = packSegmentsIntoChunks(episode.segments);
    const chunkPaths: string[] = [];

    for (const [index, chunk] of chunks.entries()) {
      // Every chunk resends the episode's STORED voice/instructions exactly
      // as submitted in Phase 1 — never varied or regenerated per chunk (F.31).
      const buffer = await synthesizeChunkWithRetry(
        { text: chunk, voice: episode.voice, instructions: episode.instructions },
        deps.requestTts,
      );
      const chunkPath = path.join(deps.scratchDir, `chunk-${String(index).padStart(3, "0")}.mp3`);
      deps.fs.writeFile(chunkPath, new Uint8Array(buffer));
      chunkPaths.push(chunkPath);
    }

    const listPath = path.join(deps.scratchDir, "concat-list.txt");
    deps.fs.writeFile(listPath, buildConcatList(chunkPaths));

    const outputPath = path.join(deps.scratchDir, "episode.mp3");
    concatenateMp3(listPath, outputPath, deps.runProcess);
    const durationSeconds = probeDurationSeconds(outputPath, deps.runProcess);
    const sizeBytes = deps.fs.readFile(outputPath).byteLength;

    return {
      result: {
        audioStatus: "ready",
        // Relative — resolved same-origin by the static site against its
        // own `./podcast.json` fetch (site/vite.config.ts's `base: "./"`).
        audio: { url: `audio/${episode.id}.mp3`, durationSeconds, sizeBytes, mimeType: AUDIO_MIME_TYPE },
      },
      localAudioPath: outputPath,
    };
  } catch (error) {
    return { result: { audioStatus: "failed", failureReason: shortFailureReason(error) } };
  }
}
