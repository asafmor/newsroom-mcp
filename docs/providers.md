# Content Providers

Every provider implements the same interface:

```ts
interface ContentProvider {
  readonly id: ProviderId;
  readonly name: string;
  fetchNew(state: ProviderState | null): Promise<ProviderFetchResult>;
}
```

`state` is an opaque, provider-owned JSON cursor persisted by
`ProviderStateRepository` between polls. Each provider's incremental-fetch
strategy differs because each upstream API differs — see below.

## RSS / Atom (`src/providers/rss/`)

- Fetches with native `fetch()` (not `rss-parser`'s own URL fetching) to
  retain response headers for conditional GET: `ETag`/`If-None-Match` and
  `Last-Modified`/`If-Modified-Since`. A `304 Not Modified` short-circuits to
  zero items.
- Parses the body with `rss-parser`.
- State: `{ etag?, lastModified?, latestPublishedAt? }`. Items are filtered
  to those newer than `latestPublishedAt`; the high-water mark is
  recomputed from every parseable item in the response (never regresses,
  even on a poll with nothing new).
- `externalId` prefers `guid`, falls back to `link`. An item with neither, or
  an unparseable `pubDate`/`isoDate`, is skipped — one bad item must not sink
  the whole feed's poll.
- Configured feeds live in `src/config/providers.ts`, each as its own
  `ProviderId` (`rss:openai`, `rss:deepmind`, ...) sharing one implementation.
- The `kind` tagged on every item defaults to `"article"` but is
  configurable per feed (`RssContentProviderOptions.kind`). GitHub's public
  per-repository release feed (`https://github.com/<owner>/<repo>/releases.atom`)
  is plain Atom, so it's just another `RssContentProvider` instance
  configured with `kind: "release"` — see `GITHUB_RELEASE_REPOS` in
  `src/config/providers.ts` for the tracked-repository list (edit that list
  only; no logic change needed to add/remove a repository). Because a
  release entry's raw title is a bare version string (e.g. `v3.7.0`), a
  `kind: "release"` item's title is composed as `"<name> <raw title>"` so it
  identifies the project, not just the version.

## Hacker News (`src/providers/hacker-news/`)

- Uses the Algolia `search_by_date` API
  (`https://hn.algolia.com/api/v1/search_by_date`), not the official
  Firebase API — it supports full-text search and a `numericFilters` cursor,
  which the Firebase API doesn't.
- State: `{ latestCreatedAt? }` (Unix seconds). Appends
  `numericFilters=created_at_i>N` to fetch only newer stories.
- Maps to `kind: "discussion"` (not `"article"`) — the value here is
  community/technical discussion signal, not the underlying article content.
  `metadata.points`/`numComments` preserve that signal; `url` falls back to
  the HN discussion page for text-only ("Ask HN") posts.

## Adding a new source

1. Add a `src/providers/<name>/` directory with a `-types.ts` (state +
   options interfaces) and a `-content-provider.ts` (the `ContentProvider`
   implementation).
2. Never let it touch SQLite or make relevance/ranking decisions — only
   normalize the external shape into `ContentItem[]`.
3. Wire it into `src/config/providers.ts`.
4. Add unit tests stubbing `global.fetch`, following the existing providers'
   pattern — no real network calls in unit tests.
