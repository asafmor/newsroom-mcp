import type { ProviderId } from "../../domain/provider.js";

/**
 * Persisted cursor for a GDELT DOC 2.0 poll: the newest article `seendate`
 * seen so far (stored as standard ISO 8601, even though GDELT's own format
 * is the compact `YYYYMMDDTHHMMSSZ`), used as the high-water mark to filter
 * already-seen articles on the next poll.
 */
export interface GdeltProviderState {
  latestSeenAt?: string;
}

export interface GdeltContentProviderOptions {
  id: ProviderId;
  name: string;
  /** GDELT query syntax, passed through as given. */
  query: string;
  /** Defaults to 20000ms. */
  fetchTimeoutMs?: number;
}

/** Shape of one article as returned by the GDELT DOC 2.0 `artlist` API. */
export interface GdeltRawArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}
