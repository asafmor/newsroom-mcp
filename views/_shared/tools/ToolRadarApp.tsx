import { useState } from "react";

import { Avatar } from "../feed/Avatar.js";
import { EmptyState } from "../feed/EmptyState.js";
import { SkeletonCard } from "../feed/SkeletonCard.js";
import {
  BOOKMARKS_STORAGE_KEY,
  KIND_EXPLAINER,
  actionLabel,
  addBookmark,
  allSourcesErrored,
  bookmarkedEntries,
  degradedSourceNames,
  formatCompactCount,
  kindLabel,
  kindsPresent,
  parseStoredBookmarks,
  persistBookmarks,
  recencyLabel,
  removeBookmark,
  toolsFreshness,
} from "./formatters.js";
import type { BookmarkedEntry } from "./formatters.js";
import type { ToolEntry, ToolKind, ToolRadarSources } from "./types.js";

/**
 * Bookmarked tool entries (full snapshots, not bare ids — see
 * formatters.ts), purely client-side — same tri-state discipline as
 * FeedApp's getInitialReadIds (views/_shared/feed/FeedApp.tsx): `undefined`
 * means localStorage itself is inaccessible this session (the sandboxed MCP
 * View host), and the caller must suppress the whole bookmarking feature
 * rather than render a "0 bookmarked" lie.
 */
function getInitialBookmarks(): Map<string, ToolEntry> | undefined {
  let raw: string | null;
  try {
    raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return new Map(); // first visit / cleared storage — normal, nothing bookmarked
  return new Map(parseStoredBookmarks(raw).map((entry) => [entry.id, entry]));
}

export type ToolRadarState =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "success";
      readonly generatedAt: string;
      readonly sources: ToolRadarSources;
      readonly entries: readonly ToolEntry[];
    };

/**
 * Top-level orchestrator for the standalone site's Tool Radar section — a
 * distinct reader-facing surface from the news feed/podcast digest (see the
 * feature requirements doc), mounted only by site/src/main.tsx today. Owns
 * the kind/bookmark filter state and the bookmark id set, the way FeedApp
 * owns sort/read-id state for the story feed.
 */
export function ToolRadarApp({ state }: { readonly state: ToolRadarState }) {
  if (state.status === "error") {
    return (
      <ToolsShell>
        <EmptyState title="Could not load Tool Radar" message={state.message} tone="error" />
      </ToolsShell>
    );
  }

  if (state.status === "pending") {
    return (
      <ToolsShell>
        <div className="tools-grid" aria-busy="true">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </ToolsShell>
    );
  }

  // Deliberately no all-sources-failed early return here either (P2
  // UI-review finding): an upstream outage must not cut off access to
  // already-bookmarked tools, which live in localStorage independently of
  // this run's sources. ToolsBoard still renders the outage message — kept
  // distinct from "sources ok, just no entries" (req. 33 vs. 34) — but does
  // it *below* the filter bar, so the bookmark toggle stays reachable.

  // Deliberately no zero-entries early return here (P2 UI-review finding):
  // an empty weekly snapshot must not also cut off access to previously
  // bookmarked tools, which live independently in localStorage. ToolsBoard
  // itself renders the "No tools yet" empty state (still reachable via its
  // own bookmark toggle) once it knows whether any bookmarks exist.
  return (
    <ToolsShell generatedAt={state.generatedAt}>
      <ToolsBoard sources={state.sources} entries={state.entries} />
    </ToolsShell>
  );
}

function ToolsShell({
  generatedAt,
  children,
}: {
  /** `undefined` in the pending/error states, where there's no snapshot timestamp to show yet. */
  readonly generatedAt?: string;
  readonly children: React.ReactNode;
}) {
  const toolsFreshnessInfo = generatedAt === undefined ? undefined : toolsFreshness(generatedAt);
  return (
    // id="tool-radar": an anchored section of the same standalone page, not
    // a new client-side route (see the static-site constraint).
    <section id="tool-radar" className="newsroomFeed newsroomTools" aria-label="Tool Radar">
      <div className="tools-shell">
        <header className="tools-header">
          <h2 className="tools-title">Tool Radar</h2>
          <p className="tools-subtitle">Trending AI tools, models, and Spaces — refreshed weekly.</p>
          {/* P2 UI-review finding: explain what distinguishes the three kinds, once, here — not repeated per card. */}
          <p className="tools-kind-explainer">{KIND_EXPLAINER}</p>
          {toolsFreshnessInfo !== undefined && (
            <p className="tools-updated-meta">
              Updated {toolsFreshnessInfo.label}
              {toolsFreshnessInfo.stale && (
                <>
                  {" "}
                  <span className="stale-badge">Stale</span>
                </>
              )}
            </p>
          )}
        </header>
        {children}
      </div>
    </section>
  );
}

function ToolsBoard({
  sources,
  entries,
}: {
  readonly sources: ToolRadarSources;
  readonly entries: readonly ToolEntry[];
}) {
  const [kindFilter, setKindFilter] = useState<ToolKind | "all">("all");
  const [bookmarkOnly, setBookmarkOnly] = useState(false);
  const [bookmarks, setBookmarks] = useState<Map<string, ToolEntry> | undefined>(getInitialBookmarks);
  // A *fourth* persistence state, distinct from the undefined/empty/populated
  // trio above: storage is readable but a write was just denied (quota,
  // Safari private mode) — see persistBookmarks. Never surfaced until a
  // write actually fails, and cleared again the moment one succeeds.
  const [persistFailed, setPersistFailed] = useState(false);

  // Deliberately no prune-on-load here: a bookmark's relevance lifecycle is
  // independent of the current weekly snapshot's membership (P1 UI-review
  // finding — turnover must never delete a bookmark; only an explicit
  // unbookmark does). Each stored bookmark is a full ToolEntry snapshot, so
  // it stays fully renderable even after its id leaves `entries` — see
  // bookmarkedEntries() below, which marks that case `stale` instead.

  // Persisted synchronously here rather than in an effect on `bookmarks`, so
  // the rendered star can never get ahead of what actually reached storage
  // (P1 UI-review finding: a denied write used to still fill the star and
  // flip the label to "Remove bookmark", and the explanatory notice could be
  // thousands of pixels up-page from the card just clicked). Committing only
  // what persisted makes the unchanged star itself the in-viewport feedback.
  function toggleBookmark(entry: ToolEntry) {
    if (bookmarks === undefined) return;
    const next = bookmarks.has(entry.id) ? removeBookmark(bookmarks, entry.id) : addBookmark(bookmarks, entry);
    const persisted = persistBookmarks(next);
    if (persisted === undefined) {
      // Denied even after persistBookmarks' one-eviction retry: reject the
      // change outright so nothing presents as saved that isn't.
      setPersistFailed(true);
      return;
    }
    setPersistFailed(false);
    // `persisted` — not `next` — because the retry may have evicted the
    // oldest bookmark to fit, and what's rendered must match what's stored.
    setBookmarks(persisted);
  }

  const kinds = kindsPresent(entries);
  const degraded = degradedSourceNames(sources);
  const filterBar = (
    <FilterBar
      kinds={kinds}
      kindFilter={kindFilter}
      onKindChange={setKindFilter}
      bookmarkOnly={bookmarkOnly}
      onBookmarkOnlyChange={setBookmarkOnly}
      bookmarksAvailable={bookmarks !== undefined}
    />
  );
  const outage = allSourcesErrored(sources);
  // On a full outage the outage empty state below says it more clearly than
  // "all 3 sources didn't respond" would, so the banner is redundant there.
  // The bookmarks-only view never reaches that empty state — it renders saved
  // tools out of storage — so keep the banner in that one case, or the reader
  // gets no hint the run failed at all.
  const banner = degraded.length > 0 && (!outage || bookmarkOnly) && <DegradedBanner sourceNames={degraded} outage={outage} />;
  // Explains the star that didn't change. Non-alarming: this is the rare
  // case (quota exhausted, Safari private mode), and nothing has been lost —
  // the change simply wasn't applied.
  // Pinned to the viewport, not placed in flow: the card that was just tapped
  // can be thousands of pixels below the top of the board, and an in-flow
  // notice up there explained nothing (P2 UI-review finding — measured ~2,560px
  // above the viewport). The star staying empty is the local signal; this says
  // why. It clears on the next save that does succeed.
  const persistWarning = persistFailed && (
    <p className="tools-degraded-banner tools-persist-warning" role="status">
      <span>Bookmarks can&rsquo;t be saved on this device right now, so that change wasn&rsquo;t kept.</span>
      {/* Dismissible because storage denial is a standing condition, not a
          transient one: without this the notice sat over the reader's content
          — including the very star they'd just tapped — until a save
          succeeded, which under a permanent denial is never. */}
      <button
        type="button"
        className="tools-persist-dismiss"
        aria-label="Dismiss bookmark save notice"
        onClick={() => { setPersistFailed(false); }}
      >
        Dismiss
      </button>
    </p>
  );

  // Req. 37: the bookmark filter is on but nothing has ever been bookmarked
  // — a distinct message from "filtered to zero" below, since resetting the
  // kind filter can't fix this; only turning the bookmark filter off can.
  if (bookmarkOnly && bookmarks?.size === 0) {
    return (
      <>
        {filterBar}
        {banner}
        {persistWarning}
        <EmptyState title="No bookmarks yet" message="Tap the bookmark button on a tool to save it here for next time." />
      </>
    );
  }

  // P2 UI-review finding: a genuinely empty weekly snapshot must not also
  // hide previously bookmarked tools — `filterBar` (with its bookmark
  // toggle, unconditionally rendered above whenever bookmarksAvailable) stays
  // reachable so the reader can still switch to their saved tools, which
  // live independently of `entries` via bookmarkedEntries() below.
  if (!bookmarkOnly && entries.length === 0) {
    return (
      <>
        {filterBar}
        {banner}
        {persistWarning}
        {outage ? (
          <EmptyState
            title="Tool Radar is temporarily unavailable"
            message="All three sources failed on the last run. Check back after the next scheduled update."
            tone="error"
          />
        ) : (
          <EmptyState
            title="No tools yet"
            message="Tool Radar publishes here once the next scheduled run finds trending repositories, models, or Spaces."
          />
        )}
      </>
    );
  }

  // Bookmarks-only view sources rows from the bookmark set itself (live
  // data where still present in `entries`, the stored snapshot otherwise —
  // see bookmarkedEntries), not from `entries` filtered by id, so a
  // bookmark that's left the current snapshot still shows up here.
  const filtered: BookmarkedEntry[] = bookmarkOnly
    ? bookmarkedEntries(bookmarks ?? new Map(), entries).filter((item) => kindFilter === "all" || item.entry.kind === kindFilter)
    : entries
        .filter((entry) => kindFilter === "all" || entry.kind === kindFilter)
        .map((entry) => ({ entry, stale: false }));

  return (
    <>
      {filterBar}
      {banner}
      {persistWarning}
      {filtered.length === 0 ? (
        // Req. 36: the combined kind+bookmark filter matched nothing, even
        // though entries/bookmarks themselves aren't empty — offer a way
        // back to the unfiltered view rather than a dead end.
        <EmptyState title="No matching tools" message="Nothing matches the current filters." />
      ) : (
        <div className="tools-grid">
          {filtered.map(({ entry, stale }) => (
            <ToolCard
              key={entry.id}
              entry={entry}
              stale={stale}
              bookmarked={bookmarks?.has(entry.id) === true}
              onToggleBookmark={bookmarks === undefined ? undefined : () => { toggleBookmark(entry); }}
            />
          ))}
        </div>
      )}
      {filtered.length === 0 && (kindFilter !== "all" || bookmarkOnly) && (
        <button
          type="button"
          className="tools-reset-filters"
          onClick={() => {
            setKindFilter("all");
            setBookmarkOnly(false);
          }}
        >
          Show all tools
        </button>
      )}
    </>
  );
}

function FilterBar({
  kinds,
  kindFilter,
  onKindChange,
  bookmarkOnly,
  onBookmarkOnlyChange,
  bookmarksAvailable,
}: {
  readonly kinds: readonly ToolKind[];
  readonly kindFilter: ToolKind | "all";
  readonly onKindChange: (kind: ToolKind | "all") => void;
  readonly bookmarkOnly: boolean;
  readonly onBookmarkOnlyChange: (value: boolean) => void;
  /** `false` when localStorage is unavailable this session — hides the toggle entirely rather than a control that can never persist (see getInitialBookmarks' tri-state). */
  readonly bookmarksAvailable: boolean;
}) {
  return (
    <div className="tools-filter-row">
      {/* Only rendered with >1 kind actually present — a single-kind board
          has nothing to filter, so "All" plus one chip would be a dead
          control (mirrors FeedHeader's "hide the tag select when empty"
          rule). */}
      {kinds.length > 1 && (
        <div className="tools-kind-chips" role="group" aria-label="Filter by kind">
          <button type="button" className="tools-kind-chip" aria-pressed={kindFilter === "all"} onClick={() => { onKindChange("all"); }}>
            All
          </button>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className="tools-kind-chip"
              aria-pressed={kindFilter === kind}
              onClick={() => { onKindChange(kind); }}
            >
              {kindLabel(kind)}
            </button>
          ))}
        </div>
      )}
      {bookmarksAvailable && (
        <button
          type="button"
          className="tools-bookmark-toggle"
          aria-pressed={bookmarkOnly}
          onClick={() => { onBookmarkOnlyChange(!bookmarkOnly); }}
        >
          ★ Bookmarked
        </button>
      )}
    </div>
  );
}

function DegradedBanner({ sourceNames, outage = false }: { readonly sourceNames: readonly string[]; readonly outage?: boolean }) {
  return (
    <p className="tools-degraded-banner" role="status">
      {sourceNames.join(" and ")} didn&rsquo;t respond on the last run —{" "}
      {/* "the sources that did" is false when none did: the only path that
          renders this banner under a full outage is the bookmarks-only view,
          where what's on screen came out of local storage, not this run. */}
      {outage ? "showing your saved tools from an earlier run." : "showing results from the sources that did."}
    </p>
  );
}

function ToolCard({
  entry,
  bookmarked,
  onToggleBookmark,
  stale = false,
}: {
  readonly entry: ToolEntry;
  readonly bookmarked: boolean;
  /** `undefined` when localStorage is unavailable this session — hides the bookmark button entirely rather than one that can never persist. */
  readonly onToggleBookmark: (() => void) | undefined;
  /** True only in the bookmarks-only view, for a bookmark whose id has left the current snapshot — shows a "no longer trending" marker instead of silently mixing eras (P1 UI-review finding). */
  readonly stale?: boolean;
}) {
  // "GitHub" / "Hugging Face" — the two brand keys added to providerBrand.ts
  // for this feature.
  const brandName = entry.source === "github" ? "GitHub" : "Hugging Face";

  return (
    <article className="tool-card">
      <div className="tool-card-head">
        <Avatar providerName={brandName} className="tool-card-avatar" />
        <div className="tool-card-heading">
          {/* Tool name vs. owner, distinguished (P2 UI-review finding): a
              Space's own display title (cardData.title) when it has one,
              its repo-slug name otherwise — the owner is a separate,
              muted line rather than baked into the same string. `title`
              exposes the complete identifier on hover for the rare name
              that's still too long for .tool-card-name's own 2-line clamp
              (P2 UI-review finding: model names carry meaningful variant
              info — size/quantization/revision — that readers need to
              distinguish). */}
          <a
            className="tool-card-name"
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            title={entry.displayName ?? entry.name}
          >
            {entry.displayName ?? entry.name}
          </a>
          <span className="tool-card-owner">{entry.owner}</span>
          <span className="tool-card-kind">
            {kindLabel(entry.kind)}
            {stale && <span className="tool-card-stale"> · No longer trending</span>}
          </span>
        </div>
        {onToggleBookmark !== undefined && (
          <button
            type="button"
            className="tool-card-bookmark"
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark this tool"}
            onClick={onToggleBookmark}
          >
            {bookmarked ? "★" : "☆"}
          </button>
        )}
      </div>

      {/* Models never carry a description (the HF models API has no such
          field) — explained once in KIND_EXPLAINER above rather than
          repeated per card (P2 UI-review finding: 18 identical "No
          description available" lines on one run added noise without
          helping anyone choose). */}
      {entry.description !== undefined && <p className="tool-card-description">{entry.description}</p>}

      {(entry.language !== undefined ||
        entry.pipelineTag !== undefined ||
        entry.libraryName !== undefined ||
        entry.sdk !== undefined ||
        entry.license !== undefined ||
        entry.topics !== undefined) && (
        <div className="tool-card-meta">
          {entry.language !== undefined && <span className="tool-card-tag">{entry.language}</span>}
          {entry.pipelineTag !== undefined && <span className="tool-card-tag">{entry.pipelineTag}</span>}
          {entry.libraryName !== undefined && <span className="tool-card-tag">{entry.libraryName}</span>}
          {entry.sdk !== undefined && <span className="tool-card-tag">{entry.sdk}</span>}
          {entry.license !== undefined && <span className="tool-card-tag">{entry.license}</span>}
          {entry.topics?.map((topic) => (
            <span key={topic} className="tool-card-tag">
              {topic}
            </span>
          ))}
        </div>
      )}

      <div className="tool-card-footer">
        {/* Recency label + generatedAt (shown once at the section level via
            freshness()) substitute for a numeric momentum score — no such
            number ever reaches this component (see types.ts). */}
        <span className="tool-card-recency">{recencyLabel(entry)}</span>
        {entry.starCount !== undefined && <span className="tool-card-count">{formatCompactCount(entry.starCount, "star")}</span>}
        {entry.likeCount !== undefined && <span className="tool-card-count">{formatCompactCount(entry.likeCount, "like")}</span>}
        {entry.downloads !== undefined && <span className="tool-card-count">{formatCompactCount(entry.downloads, "download")}</span>}
      </div>

      {entry.installCommand !== undefined && <InstallCommand command={entry.installCommand} />}

      {/* Kind-appropriate call to action (P2 UI-review finding) — "Open
          demo" for a Space, "View model"/"View repository" otherwise,
          instead of one generic link treatment for all three kinds. */}
      <a className="tool-card-action" href={entry.url} target="_blank" rel="noopener noreferrer">
        {actionLabel(entry.kind)}
      </a>
    </article>
  );
}

function InstallCommand({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="tool-install">
      <code className="tool-install-command">{command}</code>
      <button
        type="button"
        className="tool-install-copy"
        onClick={() => {
          // Silent failure on denial/unavailability (req. 30) — the command
          // text itself stays selectable/readable either way.
          void navigator.clipboard
            .writeText(command)
            .then(() => {
              setCopied(true);
              setTimeout(() => { setCopied(false); }, 2000);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
