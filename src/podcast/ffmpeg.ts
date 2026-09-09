// The `ffmpeg`/`ffprobe` shell-out seam — injectable so tests never invoke
// a real binary (see docs/testing.md). `defaultProcessRunner` (only wired
// by scripts/synthesize-podcast.ts) is the one real implementation.

export interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (command: string, args: string[]) => ProcessResult;

export interface AvailabilityCheck {
  readonly available: boolean;
  readonly message?: string;
}

/** Verifies `ffmpeg`/`ffprobe` are on PATH before anything that depends on them (E.25). */
export function checkFfmpegAndFfprobeAvailable(run: ProcessRunner): AvailabilityCheck {
  const ffmpeg = run("ffmpeg", ["-version"]);
  if (ffmpeg.status !== 0) {
    return { available: false, message: "ffmpeg is not available on this runner" };
  }

  const ffprobe = run("ffprobe", ["-version"]);
  if (ffprobe.status !== 0) {
    return { available: false, message: "ffprobe is not available on this runner" };
  }

  return { available: true };
}

/**
 * Concatenates the chunk files listed in `concatListPath` (ffmpeg concat
 * demuxer format: one `file '<path>'` line per chunk) into `outputPath`,
 * WITH RE-ENCODING (`-c:a libmp3lame -b:a 128k`) — never `-c copy`, never a
 * naive byte-level concatenation, since either produces wrong
 * duration/seek behavior and audible seams between chunks.
 */
export function concatenateMp3(concatListPath: string, outputPath: string, run: ProcessRunner): void {
  const result = run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath,
  ]);

  if (result.status !== 0) {
    throw new Error(`ffmpeg concatenation failed: ${result.stderr.slice(0, 300)}`);
  }
}

/**
 * Obtains the final duration by PROBING the concatenated file, not by
 * summing estimated per-chunk durations. Returns a rounded, whole,
 * non-negative integer number of seconds; throws if `ffprobe` fails or
 * reports a zero/invalid duration.
 */
export function probeDurationSeconds(filePath: string, run: ProcessRunner): number {
  const result = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr.slice(0, 300)}`);
  }

  const seconds = Math.round(Number(result.stdout.trim()));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported an invalid duration: "${result.stdout.trim()}"`);
  }

  return seconds;
}

/** Real implementation: `node:child_process.spawnSync`, wired only by scripts/synthesize-podcast.ts. */
export function defaultProcessRunner(spawnSync: typeof import("node:child_process").spawnSync): ProcessRunner {
  return (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
}
