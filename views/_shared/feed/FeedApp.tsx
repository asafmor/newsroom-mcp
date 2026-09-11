import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { BackToTopButton } from "./BackToTopButton.js";
import { EmptyState } from "./EmptyState.js";
import { FeedHeader } from "./FeedHeader.js";
import { SkeletonCard } from "./SkeletonCard.js";
import { SourceSheet } from "./SourceSheet.js";
import { StoryCard } from "./StoryCard.js";
import type { DigestEntry, FeedStory, SortMode } from "./types.js";
import {
  availableTags,
  computeStoryDelta,
  latestPublishedAt,
  msUntilNextThemeBoundary,
  pruneReadIds,
  resolveTheme,
  storyMatchesFilters,
  toStorySnapshot,
  unreadCount,
} from "./formatters.js";
import type { StoryDelta, StorySnapshot } from "./formatters.js";

const SORT_STORAGE_KEY = "newsroom-sort-mode";
const READ_IDS_STORAGE_KEY = "newsroom-read-ids";
const SNAPSHOT_STORAGE_KEY = "newsroom-story-snapshots";

function getInitialSortMode(): SortMode {
  try {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    if (stored === "top" || stored === "latest") return stored;
  } catch {
    // ignore
  }
  return "top";
}

/**
 * Read-story ids, purely client-side. `undefined` is a distinct third state
 * from "empty set" — it means localStorage itself is inaccessible (the
 * sandboxed MCP View host), and the caller must suppress the whole feature
 * (no marker, no badge) rather than render every story as unread with a
 * "0 read" badge showing the full count.
 */
function getInitialReadIds(): Set<string> | undefined {
  let raw: string | null;
  try {
    raw = localStorage.getItem(READ_IDS_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return new Set(); // first visit / cleared storage — normal all-unread
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
      return new Set(parsed);
    }
  } catch {
    // malformed JSON — fall through to "no read ids", never partially trusted
  }
  return new Set();
}

function isStorySnapshot(v: unknown): v is StorySnapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.sourceUrls) &&
    o.sourceUrls.every((u) => typeof u === "string") &&
    typeof o.developmentCount === "number" &&
    Array.isArray(o.tags) &&
    o.tags.every((t) => typeof t === "string") &&
    Array.isArray(o.bullets) &&
    o.bullets.every((b) => typeof b === "string")
  );
}

/**
 * Cached per-story snapshots used to compute "what changed since you last
 * looked" (see computeStoryDelta). Same tri-state discipline as
 * getInitialReadIds above: `undefined` means storage is inaccessible this
 * session, and the whole delta feature must go silent (no badges, no
 * sheet flags, no write attempt) rather than show a "0 changes" lie —
 * distinct from an empty/absent cache, which is a normal first visit.
 *
 * UPGRADE NOTE: this cache ships after readIds is already populated for
 * returning readers. On the first load after deploy, every story is a
 * first-ever visit to *this* cache, so no story shows a delta that load
 * even though many cards are already marked read — expected and
 * self-correcting from the next load on, not a bug.
 */
function getInitialSnapshots(): Map<string, StorySnapshot> | undefined {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return new Map(); // first visit / cleared storage — normal, seeds silently
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.every(([, v]) => isStorySnapshot(v))) {
        return new Map(entries as [string, StorySnapshot][]);
      }
    }
  } catch {
    // malformed JSON — fall through to an empty cache, never partially trusted
  }
  return new Map();
}

export type FeedState =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "success"; readonly generatedAt: string; readonly stories: readonly FeedStory[] };

/**
 * Top-level orchestrator shared by the MCP `get-feed` View and the
 * standalone site — owns sort/selected-story state, delegates data
 * loading (pending/error/success) and link-opening to the caller, since
 * those differ by host (MCP host bridge vs. a real browser tab).
 */
export function FeedApp({
  state,
  locale,
  onOpenSource,
  variant = "site",
  digestEntry,
  toolsEntry,
}: {
  readonly state: FeedState;
  readonly locale?: string;
  readonly onOpenSource: (url: string) => void;
  /** "mcp" keeps the fixed-height scrolling card the sandboxed View was built for; "site" (default) lets the real page scroll and widens on desktop. */
  readonly variant?: "mcp" | "site";
  /** Site-only "Weekly digest" entry point (rendered as `.digest-bar` below). `undefined` in the MCP View, which has no podcast data. */
  readonly digestEntry?: DigestEntry;
  /** Site-only "Tool Radar" entry point — same `.digest-bar` treatment as `digestEntry`, rendered alongside it (P1 UI-review finding: Tool Radar was undiscoverable from the landing page). `undefined` in the MCP View, or whenever Tool Radar hasn't loaded/errored/has zero entries. */
  readonly toolsEntry?: DigestEntry;
}) {
  const rootClassName = variant === "mcp" ? "newsroomFeed newsroomFeed--mcp" : "newsroomFeed";
  // Automatic, time-of-day only (Waze-style) — no manual override, no OS
  // dark-mode signal. Re-evaluated on mount and whenever the tab regains
  // visibility; deliberately not polled, so a long-foregrounded tab won't
  // flip mid-session.
  const [resolvedTheme, setResolvedTheme] = useState(resolveTheme);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setResolvedTheme(resolveTheme());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  // Recovers a long-foregrounded tab that never lost visibility: one
  // setTimeout scheduled for the next boundary, re-resolving from the
  // CURRENT time (not the boundary it was scheduled for — a slept/suspended
  // machine can fire this well after 07:00/19:00) and rescheduling itself
  // for the following one. Not a poll/interval; complements, doesn't
  // replace, the visibilitychange recovery above (background tabs throttle
  // timers heavily).
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        setResolvedTheme(resolveTheme());
        scheduleNext();
      }, msUntilNextThemeBoundary());
    };
    scheduleNext();
    return () => { clearTimeout(timeoutId); };
  }, []);
  useEffect(() => {
    // data-theme on <main> only themes descendants — <html>/<body> sit
    // above it in the tree, so the page's own background (behind/around
    // the app-shell) needs the attribute mirrored up there too.
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  if (state.status === "error") {
    return (
      <main className={rootClassName} data-theme={resolvedTheme} lang={locale}>
        <EmptyState title="Could not load the feed" message={state.message} tone="error" />
      </main>
    );
  }

  if (state.status === "pending") {
    return (
      <main className={rootClassName} data-theme={resolvedTheme} lang={locale}>
        <div className="app-shell">
          <FeedHeader
            generatedAt={undefined}
            sortMode="top"
            onSortChange={() => undefined}
            providers={[]}
            providerFilter="all"
            onProviderFilterChange={() => undefined}
            tags={[]}
            tagFilter="all"
            onTagFilterChange={() => undefined}
            searchQuery=""
            onSearchChange={() => undefined}
          />
          <div className="story-feed" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={rootClassName} data-theme={resolvedTheme} lang={locale}>
      <Feed
        variant={variant}
        generatedAt={state.generatedAt}
        stories={state.stories}
        onOpenSource={onOpenSource}
        digestEntry={digestEntry}
        toolsEntry={toolsEntry}
      />
    </main>
  );
}

function Feed({
  variant,
  generatedAt,
  stories,
  onOpenSource,
  digestEntry,
  toolsEntry,
}: {
  readonly variant: "mcp" | "site";
  readonly generatedAt: string;
  readonly stories: readonly FeedStory[];
  readonly onOpenSource: (url: string) => void;
  readonly digestEntry?: DigestEntry;
  readonly toolsEntry?: DigestEntry;
}) {
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSortMode);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, sortMode);
    } catch {
      // ignore — sandboxed MCP host iframes can throw on localStorage access
    }
  }, [sortMode]);

  // `undefined` = storage unavailable this session (see getInitialReadIds) —
  // the read/unread feature goes silent rather than rendering a "0 read" lie.
  const [readIds, setReadIds] = useState<Set<string> | undefined>(getInitialReadIds);

  // Prune on every feed load: drop stored ids no longer present (archived,
  // merged away, aged out of the ~50-item feed.json) so storage never grows
  // past what's currently loaded. Reuses the same Set instance when nothing
  // changed, so this settles after one pass instead of looping.
  useEffect(() => {
    setReadIds((prev) => {
      if (prev === undefined) return prev;
      const pruned = pruneReadIds([...prev], stories.map((s) => s.id));
      if (pruned.length === prev.size && pruned.every((id) => prev.has(id))) return prev;
      return new Set(pruned);
    });
  }, [stories]);

  useEffect(() => {
    if (readIds === undefined) return;
    try {
      localStorage.setItem(READ_IDS_STORAGE_KEY, JSON.stringify([...readIds]));
    } catch {
      // ignore — sandboxed MCP host iframes can throw on localStorage access
    }
  }, [readIds]);

  // `undefined` = storage unavailable this session (see getInitialSnapshots)
  // — the delta feature goes silent rather than showing a "0 changes" lie.
  const [snapshots, setSnapshots] = useState<Map<string, StorySnapshot> | undefined>(getInitialSnapshots);

  // Computed during render (never blocks/delays first paint), comparing each
  // story against the snapshot cache AS IT STOOD BEFORE this load.
  // `generatedAt` — unique per get-feed call — is the load boundary and the
  // only intentional dependency: `snapshots` is read but must NOT be one,
  // since the overwrite effect below updates it right after this render, and
  // recomputing against the just-overwritten cache would compare it to itself
  // and erase every delta. Mirrors the read-before-write ordering openStory
  // already uses for readIds. Keyed on `generatedAt` rather than the
  // `stories` array so this never depends on the host preserving object
  // identity across unrelated re-renders.
  const deltas = useMemo(() => {
    if (snapshots === undefined) return undefined;
    const map = new Map<string, StoryDelta>();
    for (const story of stories) {
      const delta = computeStoryDelta(snapshots.get(story.id), story);
      if (delta !== undefined) map.set(story.id, delta);
    }
    return map;
  }, [generatedAt]);

  // Overwrite only AFTER the comparison above already ran this render —
  // never merge this into the memo, or the "before" value would already be
  // gone by the time it's read. Same `generatedAt` load key as the memo, so
  // the read and the overwrite always run against the same load. Also
  // prunes: reuses pruneReadIds (same helper readIds prunes with) over the
  // cached ids instead of a parallel Map-pruning function, so a snapshot for
  // a story no longer in the feed never lingers past this load.
  useEffect(() => {
    setSnapshots((prev) => {
      if (prev === undefined) return prev;
      const currentIds = stories.map((s) => s.id);
      const keptIds = new Set(pruneReadIds([...prev.keys()], currentIds));
      const next = new Map([...prev].filter(([id]) => keptIds.has(id)));
      for (const story of stories) next.set(story.id, toStorySnapshot(story));
      return next;
    });
  }, [generatedAt]);

  useEffect(() => {
    if (snapshots === undefined) return;
    try {
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(Object.fromEntries(snapshots)));
    } catch {
      // ignore — sandboxed MCP host iframes can throw on localStorage access
    }
  }, [snapshots]);

  const [selected, setSelected] = useState<FeedStory | undefined>(undefined);
  // Stays set through the sheet's close transition so it doesn't unmount
  // (and lose its content) before the animation finishes — cleared by
  // SourceSheet's onExited once that transition completes.
  const [renderedStory, setRenderedStory] = useState<FeedStory | undefined>(undefined);
  const [providerFilter, setProviderFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [search, setSearch] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const providers = [...new Set(stories.flatMap((s) => s.sources.map((src) => src.providerName)))].sort();
  const tags = availableTags(stories);

  const filtered = stories.filter((s) => storyMatchesFilters(s, { providerFilter, tagFilter, search }));

  // "top" trusts the server's own order — get-feed already ranks stories by
  // importance decayed since lastMeaningfulUpdateAt, which is smarter than
  // re-sorting by raw importanceScore here. Only "latest" re-sorts client-side.
  const sorted =
    sortMode === "latest"
      ? [...filtered].sort(
          (a, b) => new Date(latestPublishedAt(b)).getTime() - new Date(latestPublishedAt(a)).getTime(),
        )
      : filtered;

  function openStory(story: FeedStory, trigger: HTMLElement) {
    lastFocused.current = trigger;
    setSelected(story);
    setRenderedStory(story);
    // Idempotent: bails out (same Set reference, no re-render) when storage
    // is unavailable or the story is already read.
    setReadIds((prev) => {
      if (prev === undefined || prev.has(story.id)) return prev;
      return new Set(prev).add(story.id);
    });
  }

  // Swipe-to-mark-read (touch only — see useSwipeToRead.ts): the same
  // idempotent readIds transition openStory performs above, minus opening
  // the sheet. Kept as a separate function rather than a flag on openStory
  // so StoryCard never has a way to open the sheet from the swipe path.
  function markRead(story: FeedStory) {
    setReadIds((prev) => {
      if (prev === undefined || prev.has(story.id)) return prev;
      return new Set(prev).add(story.id);
    });
  }
  function closeSheet() {
    // flushSync forces the DOM commit — and with it, .app-shell losing its
    // `inert` attribute — to happen before the next line runs. Without it,
    // setSelected's update is batched: `.focus()` below would run while the
    // origin card is still inert, which the HTML spec makes a silent no-op
    // in real browsers (jsdom doesn't enforce this, so this regression only
    // shows up outside unit tests).
    flushSync(() => {
      setSelected(undefined);
    });
    lastFocused.current?.focus({ preventScroll: true });
  }

  return (
    <>
      {/* inert while the sheet is open (tracks `open` via `selected`, not
          mount state — see `renderedStory`) makes the whole background
          subtree unfocusable and removes it from the accessibility tree
          natively, so Tab/Shift+Tab can only reach the dialog's own
          controls without a hand-rolled focus trap. */}
      <div className="app-shell" inert={selected !== undefined}>
        {/* tabIndex={-1}: not a tab stop, only a programmatic focus target —
            BackToTopButton.tsx focuses this after scrolling back to the top
            so keyboard focus lands somewhere sensible instead of staying on
            a control that's about to go inert (criterion 7). */}
        <div className="scroll-area" ref={scrollAreaRef} tabIndex={-1}>
          <FeedHeader
            generatedAt={generatedAt}
            sortMode={sortMode}
            onSortChange={(mode) => {
              setSortMode(mode);
              scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
            providers={providers}
            providerFilter={providerFilter}
            onProviderFilterChange={setProviderFilter}
            tags={tags}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
            searchQuery={search}
            onSearchChange={setSearch}
            // Over the full unfiltered `stories`, not `filtered`/`sorted` —
            // filters are transient view state (design decision #1).
            // `undefined` when storage is unavailable suppresses the badge.
            unreadCount={readIds === undefined ? undefined : unreadCount(stories, readIds)}
          />
          {/* Persistent entry-point bar (site only — `digestEntry`/
              `toolsEntry` stay `undefined` in the MCP View, so this never
              renders there): "Weekly podcast" (to the podcast section) and
              "Tool Radar" (P1 UI-review finding: Tool Radar was
              undiscoverable from the landing page), as two equal cells on
              one shared surface. Deliberately placed here — after the
              complete brand header, before the first story card — rather
              than above it (round-2 UI-review finding: sitting above the
              header implied global navigation while its own 36px/12px
              content was under-weighted for that position).

              This can now live as a normal descendant of .app-shell/
              .scroll-area and still stick: those two ancestors switched from
              `overflow: hidden`/`overflow-x: hidden` to `overflow: clip`/
              `overflow-x: clip` for the standalone site (see feed.css) —
              `clip` clips identically but, unlike `hidden`/`auto`, never
              establishes a scroll container, so it no longer traps a
              descendant's `position: sticky` against the real page scroll.
              That also means .feed-header's own long-inert `position:
              sticky` would start engaging for the first time — deliberately
              neutralized back to `position: static` on the site variant
              (feed.css), since pinning the full header (brand, search,
              filters) for the whole scroll was never the intent, only this
              bar was. Verified by driving headless Chromium and measuring
              this row's and .feed-header's bounding boxes before/after
              scrolling ~1000px at 390px, 320px and 1440px widths.

              .entry-bar-row itself carries the sticky/top:0; the bars do
              not — a sticky child has zero travel inside a row exactly as
              tall as itself, so both shortcuts would scroll away with the
              feed if sticky were placed on them instead. */}
          {(digestEntry !== undefined || toolsEntry !== undefined) && (
            <div className="entry-bar-row">
              {digestEntry !== undefined && (
                <a href={digestEntry.href} className="digest-bar" aria-label={digestEntry.ariaLabel}>
                  {/* Microphone, drawn in the same stroked-24px idiom as
                      every other icon here (SourceSheet/StoryCard) — never
                      emoji. The <a>'s aria-label above already conveys full
                      meaning, so the visible spans below need no separate
                      aria-hidden treatment. */}
                  <span className="digest-bar-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="2" width="6" height="11" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
                    </svg>
                  </span>
                  <span className="digest-bar-text">
                    <span className="digest-bar-name">Weekly podcast</span>
                    <span className={digestEntry.accentSupporting ? "digest-bar-supporting digest-bar-supporting--accent" : "digest-bar-supporting"}>
                      {/* Two variants of the same fact, CSS-switched by
                          :only-child (see feed.css) — compact fits this cell
                          sharing the row with `toolsEntry`; full uses the
                          extra width the bar gets when this is the row's
                          only entry (P1-b UI-review finding: the single
                          podcast entry used to truncate its date at 320px). */}
                      <span className="digest-bar-supporting-compact">{digestEntry.compactSupporting}</span>
                      <span className="digest-bar-supporting-full">{digestEntry.fullSupporting}</span>
                    </span>
                  </span>
                </a>
              )}
              {toolsEntry !== undefined && (
                <a href={toolsEntry.href} className="digest-bar" aria-label={toolsEntry.ariaLabel}>
                  {/* Compass — matches the "Radar" name and the intent of the
                      emoji it replaces. */}
                  <span className="digest-bar-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M16 8l-2.5 5.5L8 16l2.5-5.5z" />
                    </svg>
                  </span>
                  <span className="digest-bar-text">
                    <span className="digest-bar-name">Tool Radar</span>
                    <span className={toolsEntry.accentSupporting ? "digest-bar-supporting digest-bar-supporting--accent" : "digest-bar-supporting"}>
                      <span className="digest-bar-supporting-compact">{toolsEntry.compactSupporting}</span>
                      <span className="digest-bar-supporting-full">{toolsEntry.fullSupporting}</span>
                    </span>
                  </span>
                </a>
              )}
            </div>
          )}
          <main className="story-feed" aria-live="polite">
            {sorted.length === 0 ? (
              <EmptyState
                title={stories.length === 0 ? "No stories right now" : "No matching stories"}
                message={
                  stories.length === 0
                    ? "Newsroom refreshes automatically as new AI coverage comes in — check back soon."
                    : "Try a different search term, provider, or tag filter."
                }
              />
            ) : (
              sorted.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  isRead={readIds?.has(story.id)}
                  delta={deltas?.get(story.id)}
                  onOpen={openStory}
                  onMarkRead={markRead}
                />
              ))
            )}
          </main>
        </div>
      </div>

      {/* Sibling of .app-shell, not a child — .app-shell's overflow:hidden
          clips position:fixed descendants on mobile WebKit (and breaks
          backdrop-filter compositing along with it), even though fixed
          positioning is meant to escape the ancestor's box entirely. Same
          reason BackToTopButton sits out here too. */}
      <BackToTopButton variant={variant} scrollAreaRef={scrollAreaRef} suppressed={selected !== undefined} />

      {renderedStory === undefined ? null : (
        <SourceSheet
          story={renderedStory}
          open={selected !== undefined}
          onClose={closeSheet}
          onExited={() => { setRenderedStory(undefined); }}
          onOpenSource={onOpenSource}
          delta={deltas?.get(renderedStory.id)}
        />
      )}
    </>
  );
}
