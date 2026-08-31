import type { ContentItem } from "../../domain/content-item.js";
import type { JsonObject } from "../../domain/json.js";
import type { ContentProvider, ProviderFetchResult, ProviderId, ProviderState } from "../../domain/provider.js";
import type { GdeltContentProviderOptions, GdeltProviderState, GdeltRawArticle } from "./gdelt-types.js";

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

// GDELT DOC 2.0 has no stable pagination cursor, so instead of paging we
// always re-request a fixed recent window and rely on the high-water mark
// (state.latestSeenAt) to filter out articles we've already returned.
const TIMESPAN = "1d";

export class GdeltContentProvider implements ContentProvider {
  readonly id: ProviderId;
  readonly name: string;
  private readonly query: string;
  private readonly fetchTimeoutMs: number;

  constructor(options: GdeltContentProviderOptions) {
    this.id = options.id;
    this.name = options.name;
    this.query = options.query;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  async fetchNew(state: ProviderState | null): Promise<ProviderFetchResult> {
    const gdeltState = state as GdeltProviderState | null;
    const previousLatest = gdeltState?.latestSeenAt ? new Date(gdeltState.latestSeenAt) : undefined;

    const params = new URLSearchParams({
      query: this.query,
      mode: "artlist",
      format: "json",
      maxrecords: "250",
      sort: "datedesc",
      timespan: TIMESPAN,
    });

    const response = await fetch(`${BASE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `GDELT provider "${this.id}" failed to fetch: ${String(response.status)} ${response.statusText}`,
      );
    }

    const rawBody: unknown = await response.json();
    if (!rawBody || typeof rawBody !== "object") {
      throw new Error(`GDELT provider "${this.id}" returned an unexpected response body`);
    }
    const body = rawBody as { error?: unknown; articles?: unknown };

    if (typeof body.error === "string") {
      throw new Error(`GDELT provider "${this.id}" returned an error: ${body.error}`);
    }

    const rawArticles: unknown = body.articles;
    const articles: GdeltRawArticle[] = Array.isArray(rawArticles) ? (rawArticles as GdeltRawArticle[]) : [];

    const parsedItems: ContentItem[] = [];
    let latestSeenAt = previousLatest;

    for (const article of articles) {
      const contentItem = mapArticle(this.id, article);
      if (!contentItem) continue; // no url or unparseable seendate — skip, keep the rest of the fetch

      if (!latestSeenAt || contentItem.publishedAt > latestSeenAt) {
        latestSeenAt = contentItem.publishedAt;
      }
      parsedItems.push(contentItem);
    }

    const newItems =
      previousLatest === undefined
        ? parsedItems
        : parsedItems.filter((item) => item.publishedAt > previousLatest);

    const nextState: GdeltProviderState = {
      // Never regress: keep the previous max even if this poll returned nothing new.
      ...(latestSeenAt && { latestSeenAt: latestSeenAt.toISOString() }),
    };

    return { items: newItems, nextState: nextState as ProviderState };
  }
}

/**
 * Parses GDELT's compact `seendate` format (`YYYYMMDDTHHMMSSZ`, always UTC)
 * into a Date. `new Date()` cannot parse this compact form directly, so we
 * split it into ISO 8601 fields ourselves.
 */
function parseSeenDate(seendate: string): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const isoDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(isoDate.getTime()) ? undefined : isoDate;
}

/**
 * Maps one raw GDELT article to a ContentItem, or undefined if it can't be
 * safely mapped (no url, or no parseable seendate). Skipping (rather than
 * throwing) keeps one bad article from losing an otherwise-good fetch.
 */
function mapArticle(providerId: ProviderId, article: GdeltRawArticle): ContentItem | undefined {
  // GDELT gives no stable article id; the article URL is the closest thing
  // to one, and it's exactly what the (provider_id, external_id) uniqueness
  // constraint needs to prevent duplicate ingestion across polls.
  const url = article.url;
  if (!url) return undefined;

  if (!article.seendate) return undefined;
  const publishedAt = parseSeenDate(article.seendate);
  if (!publishedAt) return undefined;

  const metadata: JsonObject = {
    ...(typeof article.domain === "string" && { domain: article.domain }),
    ...(typeof article.sourcecountry === "string" && { sourceCountry: article.sourcecountry }),
    ...(typeof article.language === "string" && { language: article.language }),
  };

  return {
    providerId,
    externalId: url,
    kind: "article",
    title: article.title ?? "(untitled)",
    url,
    publishedAt,
    metadata,
  };
}
