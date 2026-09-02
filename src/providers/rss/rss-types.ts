import type { ContentKind } from "../../domain/content-item.js";
import type { ProviderId } from "../../domain/provider.js";

/**
 * Persisted cursor for an RSS/Atom feed poll: conditional-GET cache
 * validators plus the newest `publishedAt` seen so far (the high-water mark
 * used to filter already-seen items on the next poll).
 */
export interface RssProviderState {
  etag?: string;
  lastModified?: string;
  latestPublishedAt?: string;
}

export interface RssContentProviderOptions {
  id: ProviderId;
  name: string;
  url: string;
  /** Defaults to 20000ms. */
  fetchTimeoutMs?: number;
  /** Kind tagged on every item this feed produces. Defaults to "article". */
  kind?: ContentKind;
}
