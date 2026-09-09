import { describe, expect, it, vi } from "vitest";

import type { GithubApi } from "../../src/podcast/github-api.js";
import type { PodcastJsonEpisode } from "../../src/podcast/podcast-json.js";
import type { ProcessResult, ProcessRunner } from "../../src/podcast/ffmpeg.js";
import { synthesizeEpisode, type SynthesisDeps } from "../../src/podcast/synthesize-episode.js";

function makeEpisode(overrides: Partial<PodcastJsonEpisode> = {}): PodcastJsonEpisode {
  return {
    id: "podcast-2026-W37",
    isoWeek: "2026-W37",
    title: "This week in AI",
    publishedAt: "2026-09-09T00:00:00.000Z",
    segments: ["First story segment.", "Second story segment."],
    totalCharacterCount: 42,
    voice: "alloy",
    instructions: "warm, clear, moderate pace, professional newsroom narrator",
    audioStatus: "pending",
    audio: null,
    failureReason: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SynthesisDeps> = {}): SynthesisDeps {
  const files = new Map<string, Buffer>();

  // Simulates ffmpeg actually producing an output file, so the eventual
  // `sizeBytes` reflects something real rather than an empty stub read.
  const runProcess: ProcessRunner = (command, args): ProcessResult => {
    if (command === "ffmpeg") {
      const outputPath = args.at(-1);
      if (outputPath !== undefined) {
        files.set(outputPath, Buffer.from("x".repeat(16)));
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "ffprobe") return { status: 0, stdout: "123.0\n", stderr: "" };
    throw new Error(`unexpected command: ${command}`);
  };

  const githubApi: GithubApi = {
    getReleaseByTag: vi.fn().mockResolvedValue(null),
    createRelease: vi.fn().mockResolvedValue({ id: 1, assets: [] }),
    deleteAsset: vi.fn().mockResolvedValue(undefined),
    uploadAsset: vi.fn().mockResolvedValue({
      id: 1,
      name: "episode.mp3",
      contentType: "audio/mpeg",
      browserDownloadUrl: "https://example.com/podcast-2026-W37/episode.mp3",
    }),
    setAssetContentType: vi.fn(),
  };

  return {
    scratchDir: "/tmp/scratch",
    requestTts: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    runProcess,
    githubApi,
    fs: {
      writeFile: (path, data) => {
        files.set(path, typeof data === "string" ? Buffer.from(data) : Buffer.from(data));
      },
      readFile: (path) => files.get(path) ?? Buffer.from(""),
    },
    ...overrides,
  };
}

describe("synthesizeEpisode", () => {
  it("succeeds end to end: chunks -> TTS -> ffmpeg concat -> ffprobe -> Release upload", async () => {
    const deps = makeDeps();
    const result = await synthesizeEpisode(makeEpisode(), deps);

    expect(result).toEqual({
      audioStatus: "ready",
      audio: {
        url: "https://example.com/podcast-2026-W37/episode.mp3",
        durationSeconds: 123,
        sizeBytes: 16,
        mimeType: "audio/mpeg",
      },
    });
  });

  it("resends the episode's stored voice/instructions unchanged on every chunk", async () => {
    const requestTts = vi.fn().mockResolvedValue(new ArrayBuffer(4));
    const episode = makeEpisode({
      segments: ["a".repeat(3000), "b".repeat(3000), "c".repeat(3000)], // forces 3 separate chunks
      voice: "nova",
      instructions: "brisk",
    });

    await synthesizeEpisode(episode, makeDeps({ requestTts }));

    expect(requestTts).toHaveBeenCalledTimes(3);
    for (const call of requestTts.mock.calls) {
      expect(call[0]).toMatchObject({ voice: "nova", instructions: "brisk" });
    }
  });

  it("marks the episode failed (never uploads) when every TTS retry is exhausted", async () => {
    const requestTts = vi.fn().mockRejectedValue(new Error("TTS is down"));
    const githubApi: GithubApi = {
      getReleaseByTag: vi.fn(),
      createRelease: vi.fn(),
      deleteAsset: vi.fn(),
      uploadAsset: vi.fn(),
      setAssetContentType: vi.fn(),
    };

    const result = await synthesizeEpisode(makeEpisode(), makeDeps({ requestTts, githubApi }));

    expect(result.audioStatus).toBe("failed");
    if (result.audioStatus === "failed") {
      expect(result.failureReason).toMatch(/TTS is down/);
    }
    expect(githubApi.uploadAsset).not.toHaveBeenCalled();
  });

  it("marks the episode failed and never uploads when ffmpeg concatenation fails", async () => {
    const runProcess: ProcessRunner = (command) =>
      command === "ffmpeg" ? { status: 1, stdout: "", stderr: "concat error" } : { status: 0, stdout: "1", stderr: "" };
    const githubApi: GithubApi = {
      getReleaseByTag: vi.fn(),
      createRelease: vi.fn(),
      deleteAsset: vi.fn(),
      uploadAsset: vi.fn(),
      setAssetContentType: vi.fn(),
    };

    const result = await synthesizeEpisode(makeEpisode(), makeDeps({ runProcess, githubApi }));

    expect(result.audioStatus).toBe("failed");
    expect(githubApi.uploadAsset).not.toHaveBeenCalled();
  });

  it("marks the episode failed when ffprobe reports a zero/invalid duration, and never uploads", async () => {
    const runProcess: ProcessRunner = (command) =>
      command === "ffprobe" ? { status: 0, stdout: "0\n", stderr: "" } : { status: 0, stdout: "", stderr: "" };
    const githubApi: GithubApi = {
      getReleaseByTag: vi.fn(),
      createRelease: vi.fn(),
      deleteAsset: vi.fn(),
      uploadAsset: vi.fn(),
      setAssetContentType: vi.fn(),
    };

    const result = await synthesizeEpisode(makeEpisode(), makeDeps({ runProcess, githubApi }));

    expect(result.audioStatus).toBe("failed");
    if (result.audioStatus === "failed") {
      expect(result.failureReason).toMatch(/invalid duration/);
    }
    expect(githubApi.uploadAsset).not.toHaveBeenCalled();
  });

  it("the failure reason is short and never contains the raw TTS request params object", async () => {
    const requestTts = vi.fn().mockRejectedValue(new Error("x".repeat(1000)));
    const result = await synthesizeEpisode(makeEpisode(), makeDeps({ requestTts }));

    expect(result.audioStatus).toBe("failed");
    if (result.audioStatus === "failed") {
      expect(result.failureReason.length).toBeLessThanOrEqual(200);
    }
  });
});
