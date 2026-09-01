import { useEffect, useRef, useState } from "react";
import type { ViewConfig } from "mcp-use/react";
import { useHostContext, useOpenExternal, useToolContext } from "mcp-use/react";

import "./get-feed.css";

export const viewConfig = {
  autoResize: true,
  displayModes: ["inline"],
} satisfies ViewConfig;

type FeedStory = ReturnType<typeof useToolContext<"get-feed">>["toolOutput"] extends infer T
  ? T extends { stories: readonly (infer S)[] }
    ? S
    : never
  : never;

type SortMode = "top" | "latest";

export default function GetFeedView() {
  const context = useToolContext<"get-feed">();
  const { locale } = useHostContext();

  if (context.status === "error") {
    return (
      <main className="newsroomFeed" lang={locale}>
        <EmptyState title="Could not load the feed" message={context.error.message} tone="error" />
      </main>
    );
  }

  if (context.status === "pending") {
    return (
      <main className="newsroomFeed" lang={locale}>
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
    <main className="newsroomFeed" lang={locale}>
      <Feed generatedAt={context.toolOutput.generatedAt} stories={context.toolOutput.stories} />
    </main>
  );
}

function Feed({ generatedAt, stories }: { readonly generatedAt: string; readonly stories: readonly FeedStory[] }) {
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

      {selected === undefined ? null : <SourceSheet story={selected} onClose={closeSheet} />}
    </div>
  );
}

function FeedHeader({
  generatedAt,
  storyCount,
  sortMode,
  onSortChange,
}: {
  readonly generatedAt: string | undefined;
  readonly storyCount: number | undefined;
  readonly sortMode: SortMode;
  readonly onSortChange: (mode: SortMode) => void;
}) {
  return (
    <header className="feed-header">
      <div className="brand-row">
        <div className="brand">
          <span className="live-dot" aria-hidden="true" />
          <span className="wordmark">Newsroom</span>
        </div>
        <span className="updated-meta">{generatedAt === undefined ? "Updated —" : `Updated ${shortTime(generatedAt)}`}</span>
      </div>
      <div className="eyebrow-row">
        <span className="eyebrow">AI News · Curated Feed</span>
        <span className="sample-tag">{storyCount === undefined ? "—" : `${String(storyCount)} stories`}</span>
      </div>
      <div className="sort-tabs" role="group" aria-label="Sort feed">
        <button className="sort-tab" aria-pressed={sortMode === "top"} onClick={() => { onSortChange("top"); }}>
          Top Stories
        </button>
        <button className="sort-tab" aria-pressed={sortMode === "latest"} onClick={() => { onSortChange("latest"); }}>
          Latest
        </button>
      </div>
    </header>
  );
}

function StoryCard({ story, onOpen }: { readonly story: FeedStory; readonly onOpen: (story: FeedStory, trigger: HTMLElement) => void }) {
  const n = story.sources.length;
  const shown = story.sources.slice(0, 3);
  const extra = n - shown.length;
  const names = [...new Set(shown.map((s) => s.providerName.replace(" AI", "").replace(" News", "")))].join(", ");

  return (
    <article
      className="story-card"
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      onClick={(e) => { onOpen(story, e.currentTarget); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(story, e.currentTarget);
        }
      }}
    >
      <div className="story-meta-row">
        <span>{timeAgo(latestPublishedAt(story))}</span>
        <span className="dot-sep">
          {n} source{n === 1 ? "" : "s"}
        </span>
      </div>
      <h3 className="story-title">{story.title}</h3>
      <p className="story-summary">{story.summary}</p>
      <div className="source-row">
        <span className="avatar-stack">
          {shown.map((s, i) => (
            <span className="avatar" title={s.providerName} key={i}>
              {initials(s.providerName)}
            </span>
          ))}
          {extra > 0 ? <span className="avatar more">+{extra}</span> : null}
        </span>
        <span className="source-count">
          {names}
          {extra > 0 ? ` +${String(extra)}` : ""}
        </span>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skel-bar" style={{ width: "35%" }} />
      <div className="skel-bar" style={{ width: "85%", height: 19 }} />
      <div className="skel-bar" style={{ width: "55%", height: 19 }} />
      <div className="skel-bar" style={{ width: "92%" }} />
      <div className="skel-bar" style={{ width: "70%" }} />
    </div>
  );
}

function EmptyState({ title, message, tone }: { readonly title: string; readonly message: string; readonly tone?: "error" }) {
  return (
    <div className={`feed-empty${tone === "error" ? " feed-empty--error" : ""}`}>
      <p className="feed-empty-title">{title}</p>
      <p className="feed-empty-sub">{message}</p>
    </div>
  );
}

function SourceSheet({ story, onClose }: { readonly story: FeedStory; readonly onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const openExternal = useOpenExternal();

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <>
      <div className="sheet-overlay open" onClick={onClose} />
      <section className="source-sheet open" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-head-row">
            <h2 className="sheet-title" id="sheetTitle">
              {story.title}
            </h2>
            <button className="sheet-close" aria-label="Close" onClick={onClose} ref={closeRef}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="sheet-stats">
            <div>
              <div className="sheet-stat-label">First seen</div>
              <div className="sheet-stat-value">
                {shortDate(earliestPublishedAt(story))} · {shortTime(earliestPublishedAt(story))}
              </div>
            </div>
            <div>
              <div className="sheet-stat-label">Updated</div>
              <div className="sheet-stat-value">
                {shortDate(story.lastMeaningfulUpdateAt)} · {shortTime(story.lastMeaningfulUpdateAt)}
              </div>
            </div>
          </div>
        </div>
        <div className="sheet-body">
          <p className="sheet-section-label">Sources ({story.sources.length})</p>
          {story.sources.map((s, i) => (
            <a
              className="source-item"
              href={s.url}
              key={i}
              onClick={(e) => {
                // Views run sandboxed and can't navigate the top window themselves —
                // target="_blank" is silently swallowed, so route through the host.
                e.preventDefault();
                void openExternal({ url: s.url }).catch(() => undefined);
              }}
            >
              <span className="avatar">{initials(s.providerName)}</span>
              <span className="source-item-body">
                <span className="source-provider">{s.providerName}</span>
                <div className="source-title">{s.title}</div>
                <div className="source-date">{shortDate(s.publishedAt)}</div>
              </span>
              <span className="open-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}

// World-time, not ingest-time: a story's sources may be reported at different
// moments, so "latest"/"earliest" reflects when the news actually happened
// rather than story.firstSeenAt (when our server first pulled it in).
function latestPublishedAt(story: FeedStory): string {
  return story.sources.reduce((max, s) => (s.publishedAt > max ? s.publishedAt : max), story.sources[0].publishedAt);
}
function earliestPublishedAt(story: FeedStory): string {
  return story.sources.reduce((min, s) => (s.publishedAt < min ? s.publishedAt : min), story.sources[0].publishedAt);
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  return `${String(Math.round(hr / 24))}d ago`;
}
function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
