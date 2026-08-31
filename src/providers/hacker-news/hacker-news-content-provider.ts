import type { ContentItem } from "../../domain/content-item.js";
import type { ContentProvider, ProviderFetchResult, ProviderId, ProviderState } from "../../domain/provider.js";
import type { HackerNewsContentProviderOptions, HackerNewsHit, HackerNewsProviderState } from "./hacker-news-types.js";

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";

export class HackerNewsContentProvider implements ContentProvider {
  readonly id: ProviderId;
  readonly name: string;
  private readonly query: string;
  private readonly fetchTimeoutMs: number;

  constructor(options: HackerNewsContentProviderOptions) {
    this.id = options.id;
    this.name = options.name;
    this.query = options.query;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  async fetchNew(state: ProviderState | null): Promise<ProviderFetchResult> {
    const hnState = state as HackerNewsProviderState | null;

    const params = new URLSearchParams({ query: this.query, tags: "story", hitsPerPage: "100" });
    if (hnState?.latestCreatedAt !== undefined) {
      params.set("numericFilters", `created_at_i>${String(hnState.latestCreatedAt)}`);
    }

    const response = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Hacker News provider "${this.id}" failed to fetch: ${String(response.status)} ${response.statusText}`,
      );
    }

    const body: unknown = await response.json();
    const hits = isHitsResponse(body) ? body.hits : [];

    const items: ContentItem[] = [];
    // High-water mark must never regress: start from the previous cursor and
    // only move forward, even if this response has zero valid hits.
    let latestCreatedAt = hnState?.latestCreatedAt;

    for (const hit of hits) {
      if (hit.created_at_i !== undefined && (latestCreatedAt === undefined || hit.created_at_i > latestCreatedAt)) {
        latestCreatedAt = hit.created_at_i;
      }

      const item = mapHit(this.id, hit);
      if (item) items.push(item);
    }

    const nextState: HackerNewsProviderState = { ...(latestCreatedAt !== undefined && { latestCreatedAt }) };

    return { items, nextState: nextState as ProviderState };
  }
}

function isHitsResponse(body: unknown): body is { hits: HackerNewsHit[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { hits?: unknown }).hits);
}

/** Maps one Algolia hit to a ContentItem, or undefined if it can't be safely mapped. */
function mapHit(providerId: ProviderId, hit: HackerNewsHit): ContentItem | undefined {
  if (!hit.objectID || hit.created_at_i === undefined) return undefined;

  const hnDiscussionUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;

  return {
    providerId,
    externalId: hit.objectID,
    // HN discussion threads are community/technical signal about a topic,
    // not the underlying article content — "discussion", not "article".
    kind: "discussion",
    title: hit.title ?? "(untitled)",
    url: hit.url ?? hnDiscussionUrl,
    publishedAt: new Date(hit.created_at_i * 1000),
    ...(hit.author && { authors: [hit.author] }),
    metadata: {
      points: hit.points ?? null,
      numComments: hit.num_comments ?? null,
      hnDiscussionUrl,
    },
  };
}
