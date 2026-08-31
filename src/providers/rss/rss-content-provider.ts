import Parser from "rss-parser";
import type { ContentItem } from "../../domain/content-item.js";
import type { ContentProvider, ProviderFetchResult, ProviderId, ProviderState } from "../../domain/provider.js";
import type { RssContentProviderOptions, RssProviderState } from "./rss-types.js";

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export class RssContentProvider implements ContentProvider {
  readonly id: ProviderId;
  readonly name: string;
  private readonly url: string;
  private readonly fetchTimeoutMs: number;

  constructor(options: RssContentProviderOptions) {
    this.id = options.id;
    this.name = options.name;
    this.url = options.url;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  async fetchNew(state: ProviderState | null): Promise<ProviderFetchResult> {
    const rssState = state as RssProviderState | null;

    const headers: Record<string, string> = {};
    if (rssState?.etag) headers["If-None-Match"] = rssState.etag;
    if (rssState?.lastModified) headers["If-Modified-Since"] = rssState.lastModified;

    const response = await fetch(this.url, {
      headers,
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    });

    // Cheap re-poll: server confirms nothing changed since our cached validators.
    if (response.status === 304) {
      return { items: [], nextState: (rssState ?? {}) as ProviderState };
    }

    if (!response.ok) {
      throw new Error(
        `RSS provider "${this.id}" failed to fetch "${this.url}": ${String(response.status)} ${response.statusText}`,
      );
    }

    const text = await response.text();
    const feed = await new Parser().parseString(text);

    const previousLatest = rssState?.latestPublishedAt ? new Date(rssState.latestPublishedAt) : undefined;

    const parsedItems: { item: ContentItem }[] = [];
    let latestPublishedAt = previousLatest;

    for (const rawItem of feed.items) {
      const contentItem = mapItem(this.id, rawItem);
      if (!contentItem) continue; // unparseable date or no id/url — skip, keep the rest of the fetch

      if (!latestPublishedAt || contentItem.publishedAt > latestPublishedAt) {
        latestPublishedAt = contentItem.publishedAt;
      }
      parsedItems.push({ item: contentItem });
    }

    const newItems =
      previousLatest === undefined
        ? parsedItems.map((p) => p.item)
        : parsedItems.filter((p) => p.item.publishedAt > previousLatest).map((p) => p.item);

    const responseEtag = response.headers.get("etag");
    const responseLastModified = response.headers.get("last-modified");

    const nextState: RssProviderState = {
      ...(rssState?.etag !== undefined && { etag: rssState.etag }),
      ...(rssState?.lastModified !== undefined && { lastModified: rssState.lastModified }),
      ...(responseEtag && { etag: responseEtag }),
      ...(responseLastModified && { lastModified: responseLastModified }),
      // Never regress: keep the max seen even if this poll returned nothing new.
      ...(latestPublishedAt && { latestPublishedAt: latestPublishedAt.toISOString() }),
    };

    return { items: newItems, nextState: nextState as ProviderState };
  }
}

/**
 * Maps one rss-parser item to a ContentItem, or returns undefined if it
 * can't be safely mapped (no guid/link, or no parseable publish date).
 * Skipping (rather than throwing) keeps one bad item from losing an
 * otherwise-good fetch.
 */
function mapItem(providerId: ProviderId, item: Parser.Item): ContentItem | undefined {
  const externalId = item.guid ?? item.link;
  if (!externalId) return undefined;

  const url = item.link ?? externalId;

  const rawDate = item.isoDate ?? item.pubDate;
  if (!rawDate) return undefined;
  const publishedAt = new Date(rawDate);
  if (Number.isNaN(publishedAt.getTime())) return undefined;

  return {
    providerId,
    externalId,
    kind: "article",
    title: item.title ?? "(untitled)",
    url,
    publishedAt,
    ...(item.creator && { authors: [item.creator] }),
    ...((item.contentSnippet ?? item.summary) && { description: item.contentSnippet ?? item.summary }),
    ...(item.content && { content: item.content }),
    metadata: item.categories ? { categories: item.categories } : {},
  };
}
