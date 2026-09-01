import type { SortMode } from "./types.js";
import { shortTime } from "./formatters.js";

export function FeedHeader({
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
