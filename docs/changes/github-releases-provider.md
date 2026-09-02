# GitHub releases provider

**Status:** shipped · **Branch:** `dev/github-releases-provider`

## What it is and why

Before this change, every content item came from articles written about AI
news — RSS feeds and Hacker News. Nothing ingested the primary event itself:
an actual software release. `IDEA.md`'s "Future Sources" section already
named GitHub, and `ContentKind` in `src/domain/content-item.ts` had reserved
the value `"release"` since the start with no producer ever setting it. This
change fills that gap: it polls each tracked repo's public release feed, so
the curating agent gets a primary-source anchor it can build a story on and
attach later press coverage to, instead of waiting for someone else to write
about a release first.

## What it was required to do

- Produce one `"release"`-kind content item per release entry, per tracked
  repo, per ingestion run.
- Give each item a title that identifies both the project and the version —
  GitHub's raw entry titles are bare strings like `v3.7.0`, meaningless
  without the repo name attached.
- Point the item's URL at the specific release page, not the repo root.
- Fall back to the feed's `<updated>` timestamp for `publishedAt`, since
  GitHub release entries carry no `<published>` — using the existing generic
  fallback, not a repo-specific special case.
- Carry the release notes into the item's content verbatim, with nothing
  fabricated or summarized.
- Apply no filtering or downranking by title, content, author, or perceived
  significance — pre-releases, patch releases, and dependency-bump releases
  all pass through the same as a major release. Judging relevance stays the
  curating agent's job.
- Dedup and incremental fetch on repeat runs exactly like existing sources:
  no re-surfaced release, no missed new one.
- Isolate failures per repo, so one repo's feed breaking doesn't block any
  other source in the same run.
- Keep the tracked-repo list a plain, editable list — adding, removing, or
  reordering repos should be a data change, not a logic change.
- Ship with 5 starter repos, vetted for a followable release cadence
  (roughly <=2-3/week): `openai/openai-python`,
  `anthropics/anthropic-sdk-python`, `huggingface/transformers`,
  `ollama/ollama`, `vllm-project/vllm`. Dropped `ggml-org/llama.cpp` and
  `langchain-ai/langchain` for releasing near-daily (would flood the feed),
  and `microsoft/autogen` for having no release in a year.
- Require no authentication, API token, or credential.
- Leave every existing tool's shape, the tool count, and `feed.json`/the
  public site untouched.

## How it was implemented

GitHub exposes `https://github.com/<owner>/<repo>/releases.atom` as plain
Atom 1.0, so this reuses the existing `RssContentProvider` instead of adding
a new provider class:

- `src/providers/rss/rss-types.ts` — `RssContentProviderOptions` gains an
  optional `kind?: ContentKind`, documented as defaulting to `"article"`.
- `src/providers/rss/rss-content-provider.ts` — stores
  `this.kind = options.kind ?? "article"`. `mapItem` now takes
  `(providerId, name, kind, item)`, tags each item with the configured kind,
  and composes a release item's title as `` `${name} ${rawTitle}` `` to turn
  a bare `v3.7.0` into something identifiable. The skip conditions (missing
  id/link, unparseable date) are unchanged and apply the same way regardless
  of kind, which is what keeps release items free of any kind-specific
  filtering.
- `src/config/providers.ts` — a new `GITHUB_RELEASE_REPOS` array holds the 8
  slugs `as const`. `buildProviderRegistry` maps each slug to an
  `RssContentProvider` configured with `id: "github-release:<slug>"`,
  `name` set to the repo segment of the slug, `url` set to that repo's
  `releases.atom`, and `kind: "release"`. Provider count went from 21 to 29.
- `docs/providers.md` was updated by the developer as part of this change to
  document the `kind` option and the GitHub-release usage.

Nothing else needed to change:

- No SQLite migration — `content_items.kind` is plain `TEXT` with no `CHECK`
  constraint, so it already accepted `"release"`.
- No `ProviderId` type change — it was already an open `string` alias.
- No new fallback logic for the missing `<published>` field — `rss-parser`
  already falls back to `<updated>`, confirmed by the reviewer against real
  `rss-parser` behavior rather than a fixture.

### Tests

73 tests passing (up from 65):

- 8 new cases in `test/unit/rss-content-provider.test.ts` cover the release
  kind tag, the composed title, the permalink URL, the `<updated>`-only
  timestamp fallback, verbatim release notes, pre-release/patch passthrough,
  and a two-poll dedup run with real state carryover.
- `test/mcp-server.test.ts` and `test/live/live-sanity.test.ts` had their
  provider-count assertions bumped to 29, and the protocol test's fetch stub
  now includes `github.com`.

Verified on the committed tree: `npm run verify` (lint, 73 tests, typecheck)
and `npm run build` both pass; startup logs `providers: 29`.

### Known limitation (pre-existing, not introduced here)

`RssContentProvider`'s incremental fetch filters on strict `>` against the
stored latest timestamp. A genuinely new release sharing the exact same
`<updated>` second as the current high-water mark would be filtered out.
This applies to every RSS-backed source today, not just GitHub releases.
Over-inclusion elsewhere is harmlessly caught by the database's
`INSERT OR IGNORE` on `(provider_id, external_id)`; this exact-tie
under-inclusion case is the one theoretical gap that constraint can't fix,
since the item is never fetched in the first place.

### Deliberately out of scope

Hugging Face's new-model API (a separate future unit of work), a pluggable
release-source abstraction, auth/token support, server-side filtering of
patch or dependency-bump releases, and content-length truncation.
