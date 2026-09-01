import { useRef, useState } from "react";

import { EmptyState } from "./EmptyState.js";
import { FeedHeader } from "./FeedHeader.js";
import { SkeletonCard } from "./SkeletonCard.js";
import { SourceSheet } from "./SourceSheet.js";
import { StoryCard } from "./StoryCard.js";
import type { FeedStory, SortMode } from "./types.js";
import { latestPublishedAt } from "./formatters.js";

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

  if (state.status === "error") {
    return (
      <main className={rootClassName} lang={locale}>
        <EmptyState title="Could not load the feed" message={state.message} tone="error" />
      </main>
    );
  }

  if (state.status === "pending") {
    return (
      <main className={rootClassName} lang={locale}>
        <div className="app-shell">
          <FeedHeader generatedAt={undefined} storyCount={undefined} sortMode="top" onSortChange={() => undefined} />
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
    <main className={rootClassName} lang={locale}>
      <Feed generatedAt={state.generatedAt} stories={state.stories} onOpenSource={onOpenSource} />
    </main>
  );
}

function Feed({
  generatedAt,
  stories,
  onOpenSource,
}: {
  readonly generatedAt: string;
  readonly stories: readonly FeedStory[];
  readonly onOpenSource: (url: string) => void;
}) {
  const [sortMode, setSortMode] = useState<SortMode>("top");
  const [selected, setSelected] = useState<FeedStory | undefined>(undefined);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  // "top" trusts the server's own order — get-feed already ranks stories by
  // importance decayed since lastMeaningfulUpdateAt, which is smarter than
  // re-sorting by raw importanceScore here. Only "latest" re-sorts client-side.
  const sorted =
    sortMode === "latest"
      ? [...stories].sort(
          (a, b) => new Date(latestPublishedAt(b)).getTime() - new Date(latestPublishedAt(a)).getTime(),
        )
      : stories;

  function openStory(story: FeedStory, trigger: HTMLElement) {
    lastFocused.current = trigger;
    setSelected(story);
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
          storyCount={stories.length}
          sortMode={sortMode}
          onSortChange={(mode) => {
            setSortMode(mode);
            scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
        <main className="story-feed" aria-live="polite">
          {sorted.length === 0 ? (
            <EmptyState
              title="No stories right now"
              message="Newsroom refreshes automatically as new AI coverage comes in — check back soon."
            />
          ) : (
            sorted.map((story) => <StoryCard key={story.id} story={story} onOpen={openStory} />)
          )}
        </main>
      </div>

      {selected === undefined ? null : <SourceSheet story={selected} onClose={closeSheet} onOpenSource={onOpenSource} />}
    </div>
  );
}
