// Tool Radar — a standalone, stateless reader-facing surface distinct from
// the news feed (see the feature requirements doc). Entirely mechanical:
// scripts/publish-tool-radar.ts queries three public HTTP APIs at publish
// time, `transform.ts` ranks/dedupes/caps that single run's raw responses
// deterministically (no stored history, no deltas), and the result is
// published as `tools.json` the same way `feed.json`/`podcast.json` are.
// Never imported by src/composition.ts — no SQLite, no MCP tool.

export type ToolSource = "github" | "huggingface";
export type ToolKind = "repository" | "model" | "space";

export interface ToolEntry {
  /** Stable/unique, e.g. "github:owner/name", "hf-model:org/name", "hf-space:org/name". The bookmark key. */
  readonly id: string;
  readonly source: ToolSource;
  readonly kind: ToolKind;
  readonly name: string;
  readonly owner: string;
  readonly url: string;
  /**
   * Truncated to DESCRIPTION_MAX chars at a word boundary. Omitted (never an
   * empty string) if the source gave none — notably, HF models never
   * provide one (the `/api/models` endpoint has no description field), so
   * this is always omitted for `kind: "model"`. Never fabricated.
   */
  readonly description?: string;
  /** HF Spaces only (`cardData.title`) — the Space's own display title, distinct from `name` (the repo-slug segment of its id). Falls back to `name` when absent. */
  readonly displayName?: string;
  /** GitHub only. */
  readonly language?: string;
  /** HF models only (`pipeline_tag`). */
  readonly pipelineTag?: string;
  /** HF models only (`library_name`, e.g. "transformers"). */
  readonly libraryName?: string;
  /** HF Spaces only (`cardData.sdk`, e.g. "gradio"/"streamlit"/"docker"). */
  readonly sdk?: string;
  /** GitHub only (`license.name`) — HF license parsing is out of scope. */
  readonly license?: string;
  /** GitHub only, capped at 5. */
  readonly topics?: readonly string[];
  /** GitHub only (`stargazers_count`). */
  readonly starCount?: number;
  /** HF only (`likes`). Never the raw `trendingScore` — that field drives rank order only, never output. */
  readonly likeCount?: number;
  /** HF models only (`downloads`). */
  readonly downloads?: number;
  readonly createdAt: string;
  /** GitHub only (`pushed_at`). HF has no equivalent — omitted rather than faked. */
  readonly lastActivityAt?: string;
  /** `huggingface-cli download <id>` for HF models only. Omitted (never an empty string) otherwise. */
  readonly installCommand?: string;
}

export interface SourceStatus {
  readonly status: "ok" | "error";
  /** Entries from this endpoint actually included in `entries` after dedup/cap — always agrees with what a reader can count. */
  readonly count: number;
  /** Bounded to <=200 chars. Present only when `status === "error"`. */
  readonly error?: string;
}

export interface ToolRadarSources {
  readonly github: SourceStatus;
  readonly huggingfaceModels: SourceStatus;
  readonly huggingfaceSpaces: SourceStatus;
}

export interface ToolRadarSnapshot {
  readonly generatedAt: string;
  readonly sources: ToolRadarSources;
  readonly entries: readonly ToolEntry[];
}

/** One endpoint's raw fetch outcome, JSON-parsed but not yet normalized — the boundary the pure transform (transform.ts) consumes. */
export type RawSourceResult =
  | { readonly status: "ok"; readonly items: readonly unknown[] }
  | { readonly status: "error"; readonly error: string };

export interface RawToolRadarSources {
  readonly github: RawSourceResult;
  readonly hfModels: RawSourceResult;
  readonly hfSpaces: RawSourceResult;
}
