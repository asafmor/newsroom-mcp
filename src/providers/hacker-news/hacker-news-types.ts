import type { ProviderId } from "../../domain/provider.js";

/**
 * Persisted cursor for a Hacker News Algolia search poll: the newest
 * `created_at_i` (Unix seconds) seen so far, used as the `numericFilters`
 * lower bound on the next poll.
 */
export interface HackerNewsProviderState {
  latestCreatedAt?: number;
}

export interface HackerNewsContentProviderOptions {
  id: ProviderId;
  name: string;
  /** Algolia search query, e.g. `AI OR "artificial intelligence" OR LLM`. */
  query: string;
  /** Defaults to 20000ms. */
  fetchTimeoutMs?: number;
}

/** Fields this provider actually reads from an Algolia `search_by_date` hit. */
export interface HackerNewsHit {
  objectID?: string;
  author?: string | null;
  title?: string | null;
  url?: string | null;
  created_at_i?: number;
  points?: number | null;
  num_comments?: number | null;
}
