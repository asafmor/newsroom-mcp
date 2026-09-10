// Shared between the standalone site (site/src/main.tsx) and any future MCP
// View — structurally compatible with the published tools.json snapshot
// (src/tool-radar/types.ts's ToolRadarSnapshot), but declared independently
// here (not imported from src/) the same way views/_shared/podcast/types.ts
// duplicates rather than imports src/domain/podcast.ts: views/ must not
// reach into src/ layers the browser bundle has no business carrying.
export type ToolSource = "github" | "huggingface";
export type ToolKind = "repository" | "model" | "space";

export interface ToolEntry {
  readonly id: string;
  readonly source: ToolSource;
  readonly kind: ToolKind;
  readonly name: string;
  readonly owner: string;
  readonly url: string;
  /** Omitted (never faked) — always absent for `kind: "model"`, since HF models have no description field. */
  readonly description?: string;
  /** Spaces only — the Space's own display title, distinct from `name`. */
  readonly displayName?: string;
  readonly language?: string;
  readonly pipelineTag?: string;
  /** Models only. */
  readonly libraryName?: string;
  /** Spaces only, e.g. "gradio"/"streamlit"/"docker". */
  readonly sdk?: string;
  readonly license?: string;
  readonly topics?: readonly string[];
  readonly starCount?: number;
  readonly likeCount?: number;
  /** Models only. */
  readonly downloads?: number;
  readonly createdAt: string;
  readonly lastActivityAt?: string;
  readonly installCommand?: string;
}

export interface ToolSourceStatus {
  readonly status: "ok" | "error";
  readonly count: number;
  readonly error?: string;
}

export interface ToolRadarSources {
  readonly github: ToolSourceStatus;
  readonly huggingfaceModels: ToolSourceStatus;
  readonly huggingfaceSpaces: ToolSourceStatus;
}
