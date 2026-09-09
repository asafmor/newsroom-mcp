// The GitHub Release seam — injectable so tests never call the real GitHub
// API (see docs/testing.md). `defaultGithubApi` (only wired by
// scripts/synthesize-podcast.ts) is the one real implementation, using
// native `fetch` against the REST API — no new dependency.

export interface ReleaseAsset {
  readonly id: number;
  readonly name: string;
  readonly contentType: string;
  readonly browserDownloadUrl: string;
}

export interface Release {
  readonly id: number;
  readonly assets: readonly ReleaseAsset[];
}

// Property (arrow-typed) methods, not TS "method shorthand" syntax — plain
// object literals implementing this (tests' stubs, `defaultGithubApi` below)
// are then ordinary function values with no `this` binding to worry about,
// which also matches how `vi.fn()` stubs get passed around in tests.
export interface GithubApi {
  getReleaseByTag: (tag: string) => Promise<Release | null>;
  createRelease: (tag: string) => Promise<Release>;
  deleteAsset: (assetId: number) => Promise<void>;
  uploadAsset: (releaseId: number, filename: string, contentType: string, data: Buffer) => Promise<ReleaseAsset>;
  /**
   * Corrects an asset's served content type when the upload didn't set it
   * as requested. The public GitHub API has no direct "edit content type"
   * call, so the real implementation deletes and re-uploads the asset with
   * the right `Content-Type` header — still one logical "explicit
   * follow-up API call" from this seam's point of view (G.40).
   */
  setAssetContentType: (
    releaseId: number,
    existingAssetId: number,
    filename: string,
    contentType: string,
    data: Buffer,
  ) => Promise<ReleaseAsset>;
}

const AUDIO_MIME_TYPE = "audio/mpeg";
const ASSET_NAME = "episode.mp3";

/**
 * Uploads `filePath`'s bytes as a per-episode GitHub Release asset, tagged
 * `tag` (the episode id, e.g. "podcast-2026-W37"): reuses an existing
 * release for that tag (idempotent across retries) rather than failing on
 * "tag already exists", replaces ("clobbers") any existing asset with the
 * same name, and verifies/corrects the served content type.
 */
export async function publishEpisodeAsset(
  tag: string,
  filePath: string,
  api: GithubApi,
  readFile: (path: string) => Buffer,
): Promise<{ url: string; sizeBytes: number; mimeType: string }> {
  const release = (await api.getReleaseByTag(tag)) ?? (await api.createRelease(tag));

  const existing = release.assets.find((asset) => asset.name === ASSET_NAME);
  if (existing) {
    await api.deleteAsset(existing.id);
  }

  const data = readFile(filePath);
  const uploaded = await api.uploadAsset(release.id, ASSET_NAME, AUDIO_MIME_TYPE, data);

  const finalAsset =
    uploaded.contentType === AUDIO_MIME_TYPE
      ? uploaded
      : await api.setAssetContentType(release.id, uploaded.id, ASSET_NAME, AUDIO_MIME_TYPE, data);

  return { url: finalAsset.browserDownloadUrl, sizeBytes: data.byteLength, mimeType: AUDIO_MIME_TYPE };
}

interface GithubApiOptions {
  readonly token: string;
  /** "owner/repo", e.g. `process.env.GITHUB_REPOSITORY` in Actions. */
  readonly repository: string;
}

/** Real implementation: GitHub REST API via native `fetch`. Only ever called by scripts/synthesize-podcast.ts. */
export function defaultGithubApi(options: GithubApiOptions): GithubApi {
  const apiBase = `https://api.github.com/repos/${options.repository}`;
  const uploadBase = `https://uploads.github.com/repos/${options.repository}`;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  function toAsset(raw: { id: number; name: string; content_type: string; browser_download_url: string }): ReleaseAsset {
    return { id: raw.id, name: raw.name, contentType: raw.content_type, browserDownloadUrl: raw.browser_download_url };
  }

  return {
    async getReleaseByTag(tag) {
      const response = await fetch(`${apiBase}/releases/tags/${encodeURIComponent(tag)}`, { headers });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`GitHub getReleaseByTag failed: ${String(response.status)}`);
      }
      const body = (await response.json()) as {
        id: number;
        assets: { id: number; name: string; content_type: string; browser_download_url: string }[];
      };
      return { id: body.id, assets: body.assets.map(toAsset) };
    },

    async createRelease(tag) {
      const response = await fetch(`${apiBase}/releases`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ tag_name: tag, name: tag }),
      });
      if (response.status === 422) {
        // Idempotency under a race: someone else already created this tag's
        // release between our getReleaseByTag and this call — reuse it.
        const existing = await defaultGithubApi(options).getReleaseByTag(tag);
        if (existing) return existing;
      }
      if (!response.ok) {
        throw new Error(`GitHub createRelease failed: ${String(response.status)}`);
      }
      const body = (await response.json()) as { id: number };
      return { id: body.id, assets: [] };
    },

    async deleteAsset(assetId) {
      const response = await fetch(`${apiBase}/releases/assets/${String(assetId)}`, { method: "DELETE", headers });
      if (!response.ok && response.status !== 404) {
        throw new Error(`GitHub deleteAsset failed: ${String(response.status)}`);
      }
    },

    async uploadAsset(releaseId, filename, contentType, data) {
      const response = await fetch(`${uploadBase}/releases/${String(releaseId)}/assets?name=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType },
        body: new Uint8Array(data),
      });
      if (!response.ok) {
        throw new Error(`GitHub uploadAsset failed: ${String(response.status)}`);
      }
      const body = (await response.json()) as { id: number; name: string; content_type: string; browser_download_url: string };
      return toAsset(body);
    },

    async setAssetContentType(releaseId, existingAssetId, filename, contentType, data) {
      await this.deleteAsset(existingAssetId);
      return this.uploadAsset(releaseId, filename, contentType, data);
    },
  };
}
