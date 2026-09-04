import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { EmptyState } from "./EmptyState.js";
import { FeedHeader } from "./FeedHeader.js";
import { SkeletonCard } from "./SkeletonCard.js";
import { SourceSheet } from "./SourceSheet.js";
import { StoryCard } from "./StoryCard.js";
import type { FeedStory, SortMode, Theme } from "./types.js";
import {
  availableTags,
  computeStoryDelta,
  latestPublishedAt,
  pruneReadIds,
  storyMatchesFilters,
  toStorySnapshot,
  unreadCount,
} from "./formatters.js";
import type { StoryDelta, StorySnapshot } from "./formatters.js";

const THEME_STORAGE_KEY = "newsroom-theme";
const SORT_STORAGE_KEY = "newsroom-sort-mode";
const READ_IDS_STORAGE_KEY = "newsroom-read-ids";
const SNAPSHOT_STORAGE_KEY = "newsroom-story-snapshots";

// Sandboxed MCP host iframes can throw on localStorage access — theme
// persistence is a nicety, not something worth crashing the feed over.
function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch {
    // ignore
  }
  return "auto";
}

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
}: {
  readonly state: FeedState;
  readonly locale?: string;
  readonly onOpenSource: (url: string) => void;
  /** "mcp" keeps the fixed-height scrolling card the sandboxed View was built for; "site" (default) lets the real page scroll and widens on desktop. */
  readonly variant?: "mcp" | "site";
}) {
  const rootClassName = variant === "mcp" ? "newsroomFeed newsroomFeed--mcp" : "newsroomFeed";
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  // "auto" tracks the OS/browser preference live — re-render on change so
  // toggling dark mode at the OS level flips the feed without a reload.
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { setSystemDark(mq.matches); };
    mq.addEventListener("change", onChange);
    return () => { mq.removeEventListener("change", onChange); };
  }, []);
  const resolvedTheme: "light" | "dark" = theme === "auto" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore — see getInitialTheme
    }
    // data-theme on <main> only themes descendants — <html>/<body> sit
    // above it in the tree, so the page's own background (behind/around
    // the app-shell) needs the attribute mirrored up there too.
    document.documentElement.dataset.theme = resolvedTheme;
  }, [theme, resolvedTheme]);

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
            theme={theme}
            onThemeChange={setTheme}
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
        generatedAt={state.generatedAt}
        stories={state.stories}
        onOpenSource={onOpenSource}
        theme={theme}
        onThemeChange={setTheme}
      />
    </main>
  );
}

function Feed({
  generatedAt,
  stories,
  onOpenSource,
  theme,
  onThemeChange,
}: {
  readonly generatedAt: string;
  readonly stories: readonly FeedStory[];
  readonly onOpenSource: (url: string) => void;
  readonly theme: Theme;
  readonly onThemeChange: (theme: Theme) => void;
}) {
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSortMode);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, sortMode);
    } catch {
      // ignore — see getInitialTheme
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
      // ignore — see getInitialTheme
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
      // ignore — see getInitialTheme
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
        <div className="scroll-area" ref={scrollAreaRef}>
          <FeedHeader
            generatedAt={generatedAt}
            sortMode={sortMode}
            onSortChange={(mode) => {
              setSortMode(mode);
              scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
            theme={theme}
            onThemeChange={onThemeChange}
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
                />
              ))
            )}
          </main>
        </div>
      </div>

      {/* Sibling of .app-shell, not a child — .app-shell's overflow:hidden
          clips position:fixed descendants on mobile WebKit (and breaks
          backdrop-filter compositing along with it), even though fixed
          positioning is meant to escape the ancestor's box entirely. */}
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
