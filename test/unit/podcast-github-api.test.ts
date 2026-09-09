import { describe, expect, it, vi } from "vitest";

import { publishEpisodeAsset, type GithubApi, type Release, type ReleaseAsset } from "../../src/podcast/github-api.js";

function makeAsset(overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
  return {
    id: 1,
    name: "episode.mp3",
    contentType: "audio/mpeg",
    browserDownloadUrl: "https://github.com/example/repo/releases/download/podcast-2026-W37/episode.mp3",
    ...overrides,
  };
}

function makeStubApi(overrides: Partial<GithubApi> = {}): GithubApi {
  return {
    getReleaseByTag: vi.fn().mockResolvedValue(null),
    createRelease: vi.fn().mockResolvedValue({ id: 100, assets: [] } satisfies Release),
    deleteAsset: vi.fn().mockResolvedValue(undefined),
    uploadAsset: vi.fn().mockResolvedValue(makeAsset()),
    setAssetContentType: vi.fn().mockResolvedValue(makeAsset()),
    ...overrides,
  };
}

const readFile = (path: string) => Buffer.from(`fake mp3 bytes for ${path}`);

describe("publishEpisodeAsset", () => {
  it("creates a release when none exists for the tag", async () => {
    const api = makeStubApi();

    await publishEpisodeAsset("podcast-2026-W37", "/tmp/episode.mp3", api, readFile);

    expect(api.getReleaseByTag).toHaveBeenCalledWith("podcast-2026-W37");
    expect(api.createRelease).toHaveBeenCalledWith("podcast-2026-W37");
  });

  it("REUSES an existing release for the tag rather than creating a duplicate", async () => {
    const api = makeStubApi({ getReleaseByTag: vi.fn().mockResolvedValue({ id: 100, assets: [] }) });

    await publishEpisodeAsset("podcast-2026-W37", "/tmp/episode.mp3", api, readFile);

    expect(api.createRelease).not.toHaveBeenCalled();
  });

  it("replaces ('clobbers') an existing asset with the same name instead of failing or duplicating", async () => {
    const existing = makeAsset({ id: 42 });
    const api = makeStubApi({ getReleaseByTag: vi.fn().mockResolvedValue({ id: 100, assets: [existing] }) });

    await publishEpisodeAsset("podcast-2026-W37", "/tmp/episode.mp3", api, readFile);

    expect(api.deleteAsset).toHaveBeenCalledWith(42);
    expect(api.uploadAsset).toHaveBeenCalledWith(100, "episode.mp3", "audio/mpeg", readFile("/tmp/episode.mp3"));
  });

  it("does NOT issue a content-type correction call when the upload already reports audio/mpeg", async () => {
    const api = makeStubApi({ uploadAsset: vi.fn().mockResolvedValue(makeAsset({ contentType: "audio/mpeg" })) });

    await publishEpisodeAsset("podcast-2026-W37", "/tmp/episode.mp3", api, readFile);

    expect(api.setAssetContentType).not.toHaveBeenCalled();
  });

  it("issues an explicit follow-up call to correct the content type when the upload set it wrong", async () => {
    const api = makeStubApi({
      uploadAsset: vi.fn().mockResolvedValue(makeAsset({ id: 7, contentType: "application/octet-stream" })),
      setAssetContentType: vi.fn().mockResolvedValue(makeAsset({ contentType: "audio/mpeg" })),
    });

    const result = await publishEpisodeAsset("podcast-2026-W37", "/tmp/episode.mp3", api, readFile);

    expect(api.setAssetContentType).toHaveBeenCalledWith(100, 7, "episode.mp3", "audio/mpeg", readFile("/tmp/episode.mp3"));
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("returns the final asset's URL, size, and audio/mpeg mime type", async () => {
    const api = makeStubApi();
    const result = await publishEpisodeAsset("podcast-2026-W37", "/tmp/episode.mp3", api, readFile);

    expect(result.url).toContain("podcast-2026-W37");
    expect(result.sizeBytes).toBe(readFile("/tmp/episode.mp3").byteLength);
    expect(result.mimeType).toBe("audio/mpeg");
  });
});
