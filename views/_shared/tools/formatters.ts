// Pure, framework-free helpers for the Tool Radar UI — mirrors
// views/_shared/feed/formatters.ts's shape (small, independently-testable
// functions the components call, nothing stateful here).
import { freshness, timeAgo, timeAgoLong } from "../feed/formatters.js";
import type { Freshness } from "../feed/formatters.js";
import type { ToolEntry, ToolKind, ToolRadarSources } from "./types.js";

/**
 * Tool Radar publishes weekly (scripts/publish-tool-radar.ts's cron), not
 * every ~30 minutes like the news feed — reusing the feed's own 6-hour
 * STALE_AFTER_MS here would mark every snapshot stale within hours of
 * publishing. 10 days comfortably covers the weekly cadence plus a missed
 * run before flagging a real publishing stall.
 */
const TOOLS_STALE_AFTER_MS = 10 * 24 * 60 * 60 * 1000;

/** Tool Radar's own `generatedAt` freshness — same calendar-aware label/stale-badge logic as the feed's `freshness()`, just a longer threshold. */
export function toolsFreshness(generatedAtIso: string, now: Date = new Date()): Freshness {
  return freshness(generatedAtIso, now, TOOLS_STALE_AFTER_MS);
}

const KIND_ORDER: readonly ToolKind[] = ["repository", "model", "space"];
const KIND_LABEL_PLURAL: Record<ToolKind, string> = {
  repository: "Repositories",
  model: "Models",
  space: "Spaces",
};

/** Distinct kinds actually present in `entries`, in a fixed display order (never "first seen" order, so the chip row doesn't reshuffle between loads). */
export function kindsPresent(entries: readonly ToolEntry[]): ToolKind[] {
  const present = new Set(entries.map((entry) => entry.kind));
  return KIND_ORDER.filter((kind) => present.has(kind));
}

export function kindLabel(kind: ToolKind): string {
  return KIND_LABEL_PLURAL[kind];
}

const ACTION_LABEL: Record<ToolKind, string> = {
  repository: "View repository",
  model: "View model",
  space: "Open demo",
};

/** Kind-appropriate call-to-action label for a card's outbound link (P2 UI-review finding — one generic link treatment didn't distinguish "install this" from "try this live"). */
export function actionLabel(kind: ToolKind): string {
  return ACTION_LABEL[kind];
}

/**
 * "last pushed 3d ago" for a GitHub repo (from `lastActivityAt`), "added 3d
 * ago" for a Hugging Face model/Space (from `createdAt`, since HF exposes
 * no push-equivalent timestamp) — substitutes for a fabricated momentum
 * delta (Tool Radar ranks from one run's data only, never a comparison to a
 * previous run).
 */
export function recencyLabel(entry: ToolEntry): string {
  if (entry.source === "github" && entry.lastActivityAt !== undefined) {
    return `last pushed ${timeAgo(entry.lastActivityAt)}`;
  }
  return `added ${timeAgo(entry.createdAt)}`;
}

const SOURCE_LABELS: { readonly key: keyof ToolRadarSources; readonly label: string }[] = [
  { key: "github", label: "GitHub" },
  { key: "huggingfaceModels", label: "Hugging Face models" },
  { key: "huggingfaceSpaces", label: "Hugging Face Spaces" },
];

/** Human-readable names of every source currently reporting `status: "error"`, for the partial-degradation banner. */
export function degradedSourceNames(sources: ToolRadarSources): string[] {
  return SOURCE_LABELS.filter(({ key }) => sources[key].status === "error").map(({ label }) => label);
}

export function allSourcesErrored(sources: ToolRadarSources): boolean {
  return SOURCE_LABELS.every(({ key }) => sources[key].status === "error");
}

/** "1.2K stars" / "3 likes" — compact via the platform's own Intl formatter, no hand-rolled thousands logic. */
export function formatCompactCount(count: number, noun: string): string {
  const formatted = new Intl.NumberFormat("en-US", { notation: "compact" }).format(count);
  return `${formatted} ${noun}${count === 1 ? "" : "s"}`;
}

export interface ToolsEntrySummary {
  /** e.g. "AI tools · 1h ago" — fits the entry bar's two-cell-wide budget (P1-b UI-review finding). */
  readonly compactSupporting: string;
  /** e.g. "Trending AI tools · updated 1 hour ago" — used when Tool Radar is the row's only entry. */
  readonly fullSupporting: string;
  readonly accentSupporting: boolean;
  readonly ariaLabel: string;
}

/**
 * Compact summary for the site header's "Tool Radar" entry point (P1
 * UI-review finding: Tool Radar was undiscoverable from the landing page)
 * — mirrors views/_shared/podcast/formatters.ts's `latestDigestEntry`.
 * `undefined` when there's nothing worth linking to yet: no entries, or
 * every source errored on the last run (the same distinction
 * ToolRadarApp.tsx itself draws between those two states).
 *
 * Leads with freshness rather than the entry count: a raw "60 tools" count
 * doesn't communicate why to click today, and the reviewer's second UI pass
 * asked for it to be dropped in favor of "updated ___ ago", derived from
 * `generatedAt` — already fetched by site/src/main.tsx for this same
 * snapshot, so this adds no new data plumbing.
 */
export function toolsDigestEntry(
  entries: readonly ToolEntry[],
  sources: ToolRadarSources,
  generatedAt: string,
): ToolsEntrySummary | undefined {
  if (entries.length === 0 || allSourcesErrored(sources)) return undefined;
  return {
    compactSupporting: `AI tools · ${timeAgo(generatedAt)}`,
    fullSupporting: `Trending AI tools · updated ${timeAgoLong(generatedAt)}`,
    accentSupporting: false,
    ariaLabel: `Tool Radar, trending AI tools, updated ${timeAgoLong(generatedAt)}`,
  };
}

/**
 * Bookmarks have a different relevance lifecycle from "read" news stories
 * (P1 UI-review finding): a tool stays worth revisiting for months after it
 * drops out of a weekly trending snapshot, so — unlike FeedApp's read-id
 * pruning — a bookmark is never dropped just because its id left the
 * current run. Stored full ToolEntry snapshots (not bare ids), keyed by id,
 * so a bookmarked tool stays fully renderable/openable after it's gone.
 * Bounded at BOOKMARKS_MAX (FIFO eviction of the oldest bookmark) so
 * localStorage can't grow without limit.
 */
export const BOOKMARKS_MAX = 200;

/** Mirrors src/tool-radar/transform.ts's own cap on the same field. */
const MAX_TOPICS = 5;

function isParseableDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function optionalString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

function optionalFiniteNumber(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Validates one raw stored value into a well-formed ToolEntry, or drops it —
 * localStorage is a trust boundary (user-writable, survives across
 * deploys), so a truncated/corrupted/older-shape object can land here even
 * from a future schema change. Required fields must all be present and
 * correctly typed or the whole entry is dropped; every *optional* field is
 * independently validated to its declared type and simply omitted when
 * wrong-typed, rather than rejecting an otherwise-valid entry — a bad
 * `topics` value (e.g. an object instead of an array) must never take the
 * rest of the entry, or its siblings, down with it (P1 UI-review finding:
 * a malformed field previously reached render unchecked and crashed the
 * whole page via `entry.topics?.map is not a function`).
 */
function sanitizeBookmarkEntry(value: unknown): ToolEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const o = value as Record<string, unknown>;
  const source = o.source;
  const kind = o.kind;
  if (
    typeof o.id !== "string" ||
    (source !== "github" && source !== "huggingface") ||
    (kind !== "repository" && kind !== "model" && kind !== "space") ||
    typeof o.name !== "string" ||
    typeof o.owner !== "string" ||
    typeof o.url !== "string" ||
    !isParseableDateString(o.createdAt)
  ) {
    return undefined;
  }

  const topics =
    Array.isArray(o.topics) && o.topics.every((t): t is string => typeof t === "string")
      ? o.topics.slice(0, MAX_TOPICS)
      : undefined;

  return {
    id: o.id,
    source,
    kind,
    name: o.name,
    owner: o.owner,
    url: o.url,
    createdAt: o.createdAt,
    description: optionalString(o, "description"),
    displayName: optionalString(o, "displayName"),
    language: optionalString(o, "language"),
    pipelineTag: optionalString(o, "pipelineTag"),
    libraryName: optionalString(o, "libraryName"),
    sdk: optionalString(o, "sdk"),
    license: optionalString(o, "license"),
    topics,
    starCount: optionalFiniteNumber(o, "starCount"),
    likeCount: optionalFiniteNumber(o, "likeCount"),
    downloads: optionalFiniteNumber(o, "downloads"),
    lastActivityAt: isParseableDateString(o.lastActivityAt) ? o.lastActivityAt : undefined,
    installCommand: optionalString(o, "installCommand"),
  };
}

/**
 * Defensive parse of the raw localStorage value — malformed JSON, a
 * non-array value, or the previous bare-id-array shape all degrade to "no
 * bookmarks". Each array element is validated/sanitized independently via
 * sanitizeBookmarkEntry, so one damaged entry is dropped without discarding
 * its valid siblings.
 */
export function parseStoredBookmarks(raw: string): ToolEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => sanitizeBookmarkEntry(item))
        .filter((entry): entry is ToolEntry => entry !== undefined);
    }
  } catch {
    // malformed JSON — fall through to "no bookmarks"
  }
  return [];
}

export const BOOKMARKS_STORAGE_KEY = "newsroom-tool-bookmarks";

/**
 * Attempts to persist `bookmarks` to localStorage, reporting success/failure
 * so the caller never presents a denied write as a successful save (P1
 * UI-review finding — the write used to be fire-and-forget with a swallowed
 * exception, so in-memory and persisted state silently diverged). On a
 * quota-style failure, evicts the single oldest bookmark and retries once —
 * a set that only just crossed a real storage quota is likely to fit once
 * it's one entry smaller — before giving up. Returns the map that actually
 * ended up persisted (possibly one entry smaller than `bookmarks` after a
 * recovered eviction), or `undefined` if even the retry failed.
 */
export function persistBookmarks(
  bookmarks: ReadonlyMap<string, ToolEntry>,
  // Resolved inside the try below rather than as a default parameter value:
  // default initializers evaluate *before* the function body (and so before
  // its try) runs, so `= localStorage` would let a throw from merely reaching
  // localStorage escape uncaught — the exact "storage went inaccessible" case
  // this function exists to absorb. getInitialBookmarks() reads inside its own
  // try for the same reason.
  storage?: Pick<Storage, "setItem">,
): Map<string, ToolEntry> | undefined {
  try {
    (storage ?? localStorage).setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify([...bookmarks.values()]));
    return new Map(bookmarks);
  } catch {
    if (bookmarks.size === 0) return undefined;
    const oldestId: string | undefined = bookmarks.keys().next().value;
    const shrunk = new Map(bookmarks);
    if (oldestId !== undefined) shrunk.delete(oldestId);
    try {
      (storage ?? localStorage).setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify([...shrunk.values()]));
      return shrunk;
    } catch {
      return undefined;
    }
  }
}

/** Adds/refreshes one bookmark (re-adding moves it to the most-recent end). Evicts the single oldest bookmark first if already at BOOKMARKS_MAX. */
export function addBookmark(bookmarks: ReadonlyMap<string, ToolEntry>, entry: ToolEntry): Map<string, ToolEntry> {
  const next = new Map(bookmarks);
  next.delete(entry.id);
  if (next.size >= BOOKMARKS_MAX) {
    const oldestId: string | undefined = next.keys().next().value;
    if (oldestId !== undefined) next.delete(oldestId);
  }
  next.set(entry.id, entry);
  return next;
}

export function removeBookmark(bookmarks: ReadonlyMap<string, ToolEntry>, id: string): Map<string, ToolEntry> {
  const next = new Map(bookmarks);
  next.delete(id);
  return next;
}

export interface BookmarkedEntry {
  readonly entry: ToolEntry;
  /** True when this bookmark's id is no longer in the current snapshot — the stored snapshot is shown instead of live data, so the UI can mark it e.g. "no longer trending". */
  readonly stale: boolean;
}

/**
 * The bookmarks-only view: one row per bookmark, newest-bookmarked-first.
 * Prefers the live entry from `currentEntries` (freshest star/like counts
 * etc.) and falls back to the stored snapshot — never drops a bookmark just
 * because it left the current run.
 */
export function bookmarkedEntries(
  bookmarks: ReadonlyMap<string, ToolEntry>,
  currentEntries: readonly ToolEntry[],
): BookmarkedEntry[] {
  const current = new Map(currentEntries.map((entry) => [entry.id, entry]));
  return [...bookmarks.entries()].reverse().map(([id, saved]) => {
    const live = current.get(id);
    // An empty snapshot — every source failed, or a genuinely empty run — is
    // no evidence that a bookmark stopped trending, so don't assert it of
    // every saved tool at once. Guarded here rather than at the call site so
    // any future caller inherits it.
    return live === undefined
      ? { entry: saved, stale: currentEntries.length > 0 }
      : { entry: live, stale: false };
  });
}
