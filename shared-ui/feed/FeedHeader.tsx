import type { SortMode } from "./types.js";
import { shortTime } from "./formatters.js";

export function FeedHeader({
  generatedAt,
  storyCount,
  sortMode,
  onSortChange,
  providers,
  providerFilter,
  onProviderFilterChange,
  searchQuery,
  onSearchChange,
}: {
  readonly generatedAt: string | undefined;
  readonly storyCount: number | undefined;
  readonly sortMode: SortMode;
  readonly onSortChange: (mode: SortMode) => void;
  readonly providers: readonly string[];
  readonly providerFilter: string;
  readonly onProviderFilterChange: (provider: string) => void;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
}) {
  return (
    <header className="feed-header">
      <div className="brand-row">
        <div className="brand">
          <span className="live-dot" aria-hidden="true" />
          <span className="wordmark">Newsroom</span>
        </div>
        <div className="sort-tabs" role="group" aria-label="Sort feed">
          <button className="sort-tab" aria-pressed={sortMode === "top"} onClick={() => { onSortChange("top"); }}>
            Top
          </button>
          <button className="sort-tab" aria-pressed={sortMode === "latest"} onClick={() => { onSortChange("latest"); }}>
            Latest
          </button>
        </div>
      </div>
      <div className="meta-row">
        <span className="updated-meta">{generatedAt === undefined ? "Updated —" : `Updated ${shortTime(generatedAt)}`}</span>
        <span className="meta-sep" aria-hidden="true">·</span>
        <span className="sample-tag">{storyCount === undefined ? "—" : `${String(storyCount)} stories`}</span>
      </div>
      <div className="filter-row">
        <input
          type="search"
          className="search-input"
          placeholder="Search stories…"
          aria-label="Search stories"
          value={searchQuery}
          onChange={(e) => { onSearchChange(e.target.value); }}
        />
        <select
          className="provider-select"
          aria-label="Filter by provider"
          value={providerFilter}
          onChange={(e) => { onProviderFilterChange(e.target.value); }}
        >
          <option value="all">All providers</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
