// The pure transform: raw API response JSON in, ranked/deduped/capped
// ToolEntry[] + per-source status out. No network, no filesystem, no git —
// unit-testable in isolation from fetch.ts the same way src/podcast/'s pure
// chunk-packing logic is tested apart from its TTS/ffmpeg seams.
import type {
  RawSourceResult,
  RawToolRadarSources,
  SourceStatus,
  ToolEntry,
  ToolKind,
  ToolRadarSnapshot,
} from "./types.js";

/** Per-endpoint caps so one healthy source can never crowd out a struggling sibling. Sum equals TOTAL_CAP by construction. */
export const GITHUB_CAP = 24;
export const HF_MODELS_CAP = 18;
export const HF_SPACES_CAP = 18;
/** Defensive backstop — entries is already <= this by construction of the three caps above. */
export const TOTAL_CAP = GITHUB_CAP + HF_MODELS_CAP + HF_SPACES_CAP;

/** Max description length in chars — truncateDescription() prefers a word boundary near the cut, falling back to a mid-word cut when there's no nearby space. */
export const DESCRIPTION_MAX = 220;

/**
 * Rolling recency window every GitHub search query filters to (`created:>`)
 * — an all-time star sort with no recency filter produces a rich-get-richer
 * leaderboard of old repos, which this feature must never ship (see the
 * requirements doc). 45 days comfortably covers a weekly cadence even after
 * a missed run or two, without reaching back to "all-time popular".
 */
export const GITHUB_RECENCY_DAYS = 45;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Truncated to DESCRIPTION_MAX chars at a word boundary + "…". `undefined` (never `""`) for a missing/blank description. */
export function truncateDescription(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length <= DESCRIPTION_MAX) return trimmed;

  const cut = trimmed.slice(0, DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on whitespace if it doesn't throw away most of the budget
  // (a description with no spaces near the cut point truncates mid-word).
  const boundary = lastSpace > DESCRIPTION_MAX * 0.6 ? lastSpace : cut.length;
  return `${cut.slice(0, boundary).trimEnd()}…`;
}

/**
 * One GitHub `/search/repositories` item -> a ToolEntry, or `undefined` if
 * a required field (owner, name, url, createdAt) can't be resolved — such
 * an item is dropped, never published with a placeholder.
 */
export function normalizeGithubRepo(raw: unknown): ToolEntry | undefined {
  if (!isRecord(raw)) return undefined;

  const owner = isRecord(raw.owner) && isNonEmptyString(raw.owner.login) ? raw.owner.login : undefined;
  const name = isNonEmptyString(raw.name) ? raw.name : undefined;
  const url = isNonEmptyString(raw.html_url) ? raw.html_url : undefined;
  const createdAt = toIsoDate(raw.created_at);
  if (owner === undefined || name === undefined || url === undefined || createdAt === undefined) return undefined;

  const topics = Array.isArray(raw.topics) ? raw.topics.filter(isNonEmptyString).slice(0, 5) : undefined;
  const license = isRecord(raw.license) && isNonEmptyString(raw.license.name) ? raw.license.name : undefined;

  return {
    id: `github:${owner}/${name}`,
    source: "github",
    kind: "repository",
    name,
    owner,
    url,
    description: truncateDescription(raw.description),
    language: isNonEmptyString(raw.language) ? raw.language : undefined,
    license,
    topics: topics !== undefined && topics.length > 0 ? topics : undefined,
    starCount: isFiniteNumber(raw.stargazers_count) ? raw.stargazers_count : undefined,
    createdAt,
    lastActivityAt: toIsoDate(raw.pushed_at),
  };
}

/** Splits an HF `id` ("org/name") into its owner/name segments — HF has no separate author field. `undefined` when there's no owner segment (a bare, org-less id). */
function splitHfId(id: string): { owner: string; name: string } | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return undefined;
  return { owner: id.slice(0, slash), name: id.slice(slash + 1) };
}

/**
 * One HF `/api/models` item -> a ToolEntry. Never reads `trendingScore` —
 * that field drives fetch-time sort order only (see fetch.ts) and must
 * never reach the output (rank is list position only). `description` is
 * always omitted: the models endpoint has no description field to read, and
 * this deliberately never falls back to a fabricated one (P2 UI-review
 * finding — `downloads`/`library_name` stand in as the model's own
 * at-a-glance signal instead).
 */
export function normalizeHfModel(raw: unknown): ToolEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const id = isNonEmptyString(raw.id) ? raw.id : undefined;
  const split = id === undefined ? undefined : splitHfId(id);
  const createdAt = toIsoDate(raw.createdAt);
  if (id === undefined || split === undefined || createdAt === undefined) return undefined;

  return {
    id: `hf-model:${id}`,
    source: "huggingface",
    kind: "model",
    name: split.name,
    owner: split.owner,
    url: `https://huggingface.co/${id}`,
    pipelineTag: isNonEmptyString(raw.pipeline_tag) ? raw.pipeline_tag : undefined,
    libraryName: isNonEmptyString(raw.library_name) ? raw.library_name : undefined,
    likeCount: isFiniteNumber(raw.likes) ? raw.likes : undefined,
    downloads: isFiniteNumber(raw.downloads) ? raw.downloads : undefined,
    createdAt,
    installCommand: `huggingface-cli download ${id}`,
  };
}

/**
 * One HF `/api/spaces` item -> a ToolEntry. `installCommand` always omitted
 * — a Space is used via its web UI, not installed. Unlike models, a Space
 * does carry a description, but it lives in `cardData.short_description`
 * (and its display title in `cardData.title`), not a top-level field (P2
 * UI-review finding).
 */
export function normalizeHfSpace(raw: unknown): ToolEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const id = isNonEmptyString(raw.id) ? raw.id : undefined;
  const split = id === undefined ? undefined : splitHfId(id);
  const createdAt = toIsoDate(raw.createdAt);
  if (id === undefined || split === undefined || createdAt === undefined) return undefined;

  const cardData = isRecord(raw.cardData) ? raw.cardData : undefined;

  return {
    id: `hf-space:${id}`,
    source: "huggingface",
    kind: "space",
    name: split.name,
    owner: split.owner,
    displayName: cardData !== undefined && isNonEmptyString(cardData.title) ? cardData.title : undefined,
    url: `https://huggingface.co/spaces/${id}`,
    description: cardData === undefined ? undefined : truncateDescription(cardData.short_description),
    sdk: cardData !== undefined && isNonEmptyString(cardData.sdk) ? cardData.sdk : undefined,
    likeCount: isFiniteNumber(raw.likes) ? raw.likes : undefined,
    createdAt,
  };
}

/** Order-preserving de-duplication by `id` — keeps the first occurrence, drops the rest. Used both for GitHub's cross-query duplicates and defensively for HF. */
function dedupeById(entries: readonly ToolEntry[]): ToolEntry[] {
  const seen = new Set<string>();
  const result: ToolEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

/**
 * `sortBy`, when given, runs BEFORE the `cap` slice — the cap must always
 * keep the best `cap` items by that ordering, not the first `cap` items in
 * raw (topic-query merge) order. Omitted for Hugging Face, whose raw order
 * (the API's own `sort=trendingScore`) is the desired final order already.
 */
function normalizeSource(
  raw: RawSourceResult,
  normalize: (item: unknown) => ToolEntry | undefined,
  cap: number,
  sortBy?: (a: ToolEntry, b: ToolEntry) => number,
): ToolEntry[] {
  if (raw.status === "error") return [];
  const deduped = dedupeById(raw.items.map(normalize).filter((entry): entry is ToolEntry => entry !== undefined));
  const ordered = sortBy === undefined ? deduped : [...deduped].sort(sortBy);
  return ordered.slice(0, cap);
}

function toSourceStatus(raw: RawSourceResult, count: number): SourceStatus {
  return raw.status === "error" ? { status: "error", count: 0, error: raw.error } : { status: "ok", count };
}

/**
 * Raw JSON from the three endpoints (`RawToolRadarSources`) -> the exact
 * `tools.json` contract. Deterministic from this single run's data only —
 * no delta/velocity/comparison to a previous run.
 *
 * - GitHub: each topic query is already asked to sort by `stargazers_count`
 *   descending, but merging + de-duplicating multiple topic queries does
 *   not preserve that order — so the merged list is explicitly re-sorted by
 *   `stargazers_count` descending BEFORE the per-source cap is applied
 *   (normalizeSource's `sortBy` param), so the cap keeps the highest-star
 *   repos rather than whichever topic query happened to list them first.
 * - Hugging Face: preserves the API's own `sort=trendingScore` response
 *   order verbatim — no local re-scoring, and `trendingScore` itself is
 *   never read.
 */
export function buildToolRadarSnapshot(raw: RawToolRadarSources, now: Date): ToolRadarSnapshot {
  const githubEntries = normalizeSource(
    raw.github,
    normalizeGithubRepo,
    GITHUB_CAP,
    (a, b) => (b.starCount ?? 0) - (a.starCount ?? 0),
  );
  const hfModelEntries = normalizeSource(raw.hfModels, normalizeHfModel, HF_MODELS_CAP);
  const hfSpaceEntries = normalizeSource(raw.hfSpaces, normalizeHfSpace, HF_SPACES_CAP);

  const entries = [...githubEntries, ...hfModelEntries, ...hfSpaceEntries].slice(0, TOTAL_CAP);

  return {
    generatedAt: now.toISOString(),
    sources: {
      github: toSourceStatus(raw.github, githubEntries.length),
      huggingfaceModels: toSourceStatus(raw.hfModels, hfModelEntries.length),
      huggingfaceSpaces: toSourceStatus(raw.hfSpaces, hfSpaceEntries.length),
    },
    entries,
  };
}

/** Whether every one of the three sources failed this run — the script's signal to exit non-zero (partial degradation stays exit 0). */
export function allSourcesFailed(snapshot: ToolRadarSnapshot): boolean {
  return (Object.values(snapshot.sources) as SourceStatus[]).every((source) => source.status === "error");
}

export const TOOL_KINDS: readonly ToolKind[] = ["repository", "model", "space"];
