import { useEffect, useRef, useState } from "react";

import { EmptyState } from "./EmptyState.js";
import { FeedHeader } from "./FeedHeader.js";
import { SkeletonCard } from "./SkeletonCard.js";
import { SourceSheet } from "./SourceSheet.js";
import { StoryCard } from "./StoryCard.js";
import type { FeedStory, SortMode, Theme } from "./types.js";
import { latestPublishedAt } from "./formatters.js";

const THEME_STORAGE_KEY = "newsroom-theme";
const SORT_STORAGE_KEY = "newsroom-sort-mode";

// Sandboxed MCP host iframes can throw on localStorage access — theme
// persistence is a nicety, not something worth crashing the feed over.
function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore — see getInitialTheme
    }
  }, [theme]);

  if (state.status === "error") {
    return (
      <main className={rootClassName} data-theme={theme} lang={locale}>
        <EmptyState title="Could not load the feed" message={state.message} tone="error" />
      </main>
    );
  }

  if (state.status === "pending") {
    return (
      <main className={rootClassName} data-theme={theme} lang={locale}>
        <div className="app-shell">
          <FeedHeader
            generatedAt={undefined}
            storyCount={undefined}
            sortMode="top"
            onSortChange={() => undefined}
            theme={theme}
            onThemeChange={setTheme}
            providers={[]}
            providerFilter="all"
            onProviderFilterChange={() => undefined}
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
    <main className={rootClassName} data-theme={theme} lang={locale}>
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
  const [selected, setSelected] = useState<FeedStory | undefined>(undefined);
  // Stays set through the sheet's close transition so it doesn't unmount
  // (and lose its content) before the animation finishes — cleared by
  // SourceSheet's onExited once that transition completes.
  const [renderedStory, setRenderedStory] = useState<FeedStory | undefined>(undefined);
  const [providerFilter, setProviderFilter] = useState("all");
  const [search, setSearch] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const providers = [...new Set(stories.flatMap((s) => s.sources.map((src) => src.providerName)))].sort();

  const query = search.trim().toLowerCase();
  const filtered = stories.filter((s) => {
    const matchesProvider = providerFilter === "all" || s.sources.some((src) => src.providerName === providerFilter);
    const matchesSearch =
      query === "" || s.title.toLowerCase().includes(query) || s.summary.toLowerCase().includes(query);
    return matchesProvider && matchesSearch;
  });

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
  }
  function closeSheet() {
    setSelected(undefined);
    lastFocused.current?.focus({ preventScroll: true });
  }

  return (
    <div className="app-shell">
      <div className="scroll-area" ref={scrollAreaRef}>
        <FeedHeader
          generatedAt={generatedAt}
          storyCount={sorted.length}
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
          searchQuery={search}
          onSearchChange={setSearch}
        />
        <main className="story-feed" aria-live="polite">
          {sorted.length === 0 ? (
            <EmptyState
              title={stories.length === 0 ? "No stories right now" : "No matching stories"}
              message={
                stories.length === 0
                  ? "Newsroom refreshes automatically as new AI coverage comes in — check back soon."
                  : "Try a different search term or provider filter."
              }
            />
          ) : (
            sorted.map((story) => <StoryCard key={story.id} story={story} onOpen={openStory} />)
          )}
        </main>
      </div>

      {renderedStory === undefined ? null : (
        <SourceSheet
          story={renderedStory}
          open={selected !== undefined}
          onClose={closeSheet}
          onExited={() => { setRenderedStory(undefined); }}
          onOpenSource={onOpenSource}
        />
      )}
    </div>
  );
}
