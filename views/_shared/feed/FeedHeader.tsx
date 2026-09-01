import type { SortMode, Theme } from "./types.js";
import { shortTime } from "./formatters.js";

export function FeedHeader({
  generatedAt,
  sortMode,
  onSortChange,
  theme,
  onThemeChange,
  providers,
  providerFilter,
  onProviderFilterChange,
  searchQuery,
  onSearchChange,
}: {
  readonly generatedAt: string | undefined;
  readonly sortMode: SortMode;
  readonly onSortChange: (mode: SortMode) => void;
  readonly theme: Theme;
  readonly onThemeChange: (theme: Theme) => void;
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
          <span className="wordmark">Newsroom</span>
          <div className="meta-text">
            <span className="updated-meta">{generatedAt === undefined ? "Updated —" : `Updated ${shortTime(generatedAt)}`}</span>
          </div>
        </div>
        <div className="header-controls">
          <button
            className="theme-toggle"
            aria-label={
              theme === "light" ? "Theme: light. Click for dark." :
              theme === "dark" ? "Theme: dark. Click for auto (system)." :
              "Theme: auto (system). Click for light."
            }
            // Three-state cycle, not a binary toggle — light → dark → auto → light.
            onClick={() => { onThemeChange(theme === "light" ? "dark" : theme === "dark" ? "auto" : "light"); }}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : theme === "auto" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
              </svg>
            )}
          </button>
          <div className="sort-tabs" role="group" aria-label="Sort feed">
            <button className="sort-tab" aria-pressed={sortMode === "top"} onClick={() => { onSortChange("top"); }}>
              Top
            </button>
            <button className="sort-tab" aria-pressed={sortMode === "latest"} onClick={() => { onSortChange("latest"); }}>
              Latest
            </button>
          </div>
        </div>
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
          <option value="all">All</option>
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
