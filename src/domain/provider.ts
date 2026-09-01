import type { ContentItem } from "./content-item.js";
import type { JsonObject } from "./json.js";

/**
 * Stable identifier for a configured provider instance, e.g. `rss:openai`,
 * `hacker-news`. Each configured RSS feed is its own provider id
 * even though they share one implementation.
 */
export type ProviderId = string;

/**
 * Opaque, JSON-compatible cursor a provider uses to remember where its
 * previous fetch stopped. The MCP server persists this; only the provider
 * interprets its shape.
 */
export type ProviderState = JsonObject;

export interface ProviderFetchResult {
  items: ContentItem[];
  nextState: ProviderState;
}

/**
 * Primary extension point for external sources. A provider only translates
 * an external source into normalized `ContentItem`s — it must never touch
 * SQLite, decide relevance, summarize, rank, or call an LLM.
 */
export interface ContentProvider {
  readonly id: ProviderId;
  readonly name: string;

  fetchNew(state: ProviderState | null): Promise<ProviderFetchResult>;
}
