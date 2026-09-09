import { describe, expect, it } from "vitest";

import {
  checkFfmpegAndFfprobeAvailable,
  concatenateMp3,
  probeDurationSeconds,
  type ProcessResult,
  type ProcessRunner,
} from "../../src/podcast/ffmpeg.js";

function ok(stdout = ""): ProcessResult {
  return { status: 0, stdout, stderr: "" };
}
function fail(stderr = "boom"): ProcessResult {
  return { status: 1, stdout: "", stderr };
}

describe("checkFfmpegAndFfprobeAvailable", () => {
  it("reports available when both commands succeed", () => {
    const run: ProcessRunner = () => ok();
    expect(checkFfmpegAndFfprobeAvailable(run)).toEqual({ available: true });
  });

  it("reports ffmpeg missing when it fails first", () => {
    const run: ProcessRunner = (command) => (command === "ffmpeg" ? fail() : ok());
    const result = checkFfmpegAndFfprobeAvailable(run);
    expect(result.available).toBe(false);
    expect(result.message).toMatch(/ffmpeg/);
  });

  it("reports ffprobe missing when ffmpeg is fine but ffprobe fails", () => {
    const run: ProcessRunner = (command) => (command === "ffprobe" ? fail() : ok());
    const result = checkFfmpegAndFfprobeAvailable(run);
    expect(result.available).toBe(false);
    expect(result.message).toMatch(/ffprobe/);
  });
});

describe("concatenateMp3", () => {
  it("re-encodes with libmp3lame, never -c copy", () => {
    let capturedArgs: string[] = [];
    const run: ProcessRunner = (_command, args) => {
      capturedArgs = args;
      return ok();
    };

    concatenateMp3("/tmp/list.txt", "/tmp/out.mp3", run);

    expect(capturedArgs).toContain("libmp3lame");
    expect(capturedArgs).not.toContain("copy");
    expect(capturedArgs).toContain("-c:a");
  });

  it("throws with the (truncated) stderr on failure", () => {
    const run: ProcessRunner = () => fail("invalid concat list");
    expect(() => {
      concatenateMp3("/tmp/list.txt", "/tmp/out.mp3", run);
    }).toThrow(/invalid concat list/);
  });
});

describe("probeDurationSeconds", () => {
  it("returns a rounded, whole, non-negative integer number of seconds", () => {
    const run: ProcessRunner = () => ok("123.456\n");
    expect(probeDurationSeconds("/tmp/out.mp3", run)).toBe(123);
  });

  it("throws when ffprobe fails", () => {
    const run: ProcessRunner = () => fail("no such file");
    expect(() => probeDurationSeconds("/tmp/out.mp3", run)).toThrow(/no such file/);
  });

  it("throws on a zero duration rather than reporting it as valid", () => {
    const run: ProcessRunner = () => ok("0\n");
    expect(() => probeDurationSeconds("/tmp/out.mp3", run)).toThrow(/invalid duration/);
  });

  it("throws on a non-numeric duration", () => {
    const run: ProcessRunner = () => ok("N/A\n");
    expect(() => probeDurationSeconds("/tmp/out.mp3", run)).toThrow(/invalid duration/);
  });
});
