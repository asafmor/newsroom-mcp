# AI News Curator — Design

## 1. Overview

This project is a private AI news curation service.

Its goal is to collect AI-related content from multiple external sources, normalize it into a common format, and let an AI agent turn those raw items into a small set of meaningful **stories**.

The system is intentionally split into two parts:

1. **MCP server**

   * Owns external integrations.
   * Owns the SQLite database.
   * Exposes a small set of semantic tools.
   * Contains deterministic application logic.
   * Does not perform LLM reasoning itself.

2. **AI agent**

   * Runs periodically, initially around every 30 minutes.
   * Calls the MCP server.
   * Evaluates relevance.
   * Groups content into stories.
   * Detects meaningful updates.
   * Writes summaries.
   * Ranks stories.
   * Can request the current curated feed whenever needed.

The MCP server is the only component allowed to communicate directly with external content sources or SQLite.

---

# 2. Motivation

A normal news feed is article-oriented.

If ten publications cover the same OpenAI announcement, a conventional feed may show ten entries.

This project should instead be **story-oriented**.

For example:

```text
OpenAI releases a new model
├── OpenAI announcement
├── Reuters article
├── Hacker News discussion
├── TechCrunch article
└── another later article
```

The user should primarily see:

```text
OpenAI releases a new model

Summary:
OpenAI released ...

Sources:
OpenAI · Reuters · Hacker News · TechCrunch
```

The goal is therefore not merely:

```text
collect articles
```

but:

```text
collect signals
    ↓
understand what happened
    ↓
group related signals
    ↓
maintain a story over time
    ↓
present a concise curated feed
```

---

# 3. Initial Sources

The first version will support three source types.

## RSS / Atom

A manually curated collection of high-quality feeds.

Examples may include:

* AI companies
* research labs
* technology publications
* AI-focused publications
* individual researchers
* technical blogs

RSS should be the primary source of high-quality known content.

---

## Hacker News

Use the Hacker News Algolia API.

HN adds a different signal from publications:

* technical community interest
* discussion volume
* points
* comments
* emerging developer topics

A Hacker News item should normalize into the same `ContentItem` model used by every other provider.

---

## GDELT

GDELT provides broad news discovery.

Its main role is finding relevant reporting outside the manually curated RSS collection.

This complements RSS:

```text
RSS
→ known trusted sources

GDELT
→ broader discovery

Hacker News
→ technical/community signal
```

---

# 4. Future Sources

The architecture must make adding more provider implementations easy.

Likely future providers include:

* arXiv
* Semantic Scholar
* GitHub
* Hugging Face
* YouTube
* Bluesky
* Mastodon
* Reddit
* Lobsters
* Google News discovery
* publisher-specific APIs
* newsletters
* custom crawlers

Some future content will not be conventional news.

Examples:

```text
arXiv
→ research paper

GitHub
→ software release

Hugging Face
→ model release

YouTube
→ video

Bluesky
→ social post
```

This is why the core abstraction is called `ContentProvider`, rather than `NewsProvider`.

---

# 5. High-Level Architecture

```text
                        Scheduled AI Agent
                                │
                                │ MCP
                                ▼
                    ┌───────────────────────┐
                    │    AI News MCP        │
                    │       Server          │
                    └───────────┬───────────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
               ▼                ▼                ▼
          RSS / Atom       Hacker News         GDELT
               │                │                │
               └────────────────┼────────────────┘
                                │
                                ▼
                         ContentProvider
                                │
                                ▼
                           ContentItem
                                │
                                ▼
                            SQLite
                                │
                                ▼
                             Stories
```

The agent never accesses these directly:

```text
SQLite
RSS
HN
GDELT
```

It only talks to the MCP server.

---

# 6. Responsibility Boundary

The boundary between the MCP server and the AI agent is important.

## MCP server responsibilities

The MCP server handles deterministic operations such as:

* fetching external sources
* normalizing external content
* URL normalization
* exact duplicate prevention
* persistence
* provider state
* retrieving unprocessed content
* retrieving active stories
* creating stories
* attaching items to stories
* enforcing timestamps
* managing story lifecycle
* retrieving the feed

The MCP server should expose semantic operations.

It should **not** expose arbitrary SQL.

---

## AI agent responsibilities

The AI agent performs decisions requiring semantic reasoning.

These include:

### Relevance

```text
Is this actually relevant to AI?
```

### Clustering

```text
Does this item belong to an existing story?
```

### Meaningful update detection

```text
Does this item contain a real new development,
or is it simply another report about the same event?
```

### Summarization

```text
What is the current concise summary of this story?
```

### Ranking

```text
How relevant and important is this story?
```

The AI agent therefore acts as the curation engine.

---

# 7. Periodic Agent Workflow

The AI agent may wake approximately every 30 minutes.

A typical run:

```text
fetch_new_items()
        │
        ▼
get_unprocessed_items()
        │
        ▼
get_active_stories()
        │
        ▼
Agent analyzes new content
        │
        ├── irrelevant
        │       ↓
        │   mark_item_processed()
        │
        ├── existing story
        │       ↓
        │   attach_item_to_story()
        │       ↓
        │   possibly update_story()
        │
        └── new story
                ↓
            create_story()
```

The agent does not need to process old archived content during every run.

---

# 8. Core Domain Model

The main flow of data is:

```text
ContentProvider
       ↓
ContentItem
       ↓
StoredContentItem
       ↓
Story
       ↓
FeedStory
```

---

# 9. ContentProvider

`ContentProvider` is the primary extension point for external sources.

```ts
export interface ContentProvider {
  readonly id: ProviderId;
  readonly name: string;

  fetchNew(
    state: ProviderState | null
  ): Promise<ProviderFetchResult>;
}
```

The interface intentionally knows nothing about:

* SQLite
* MCP
* stories
* LLMs
* ranking
* clustering

Its only responsibility is:

```text
external source
      ↓
normalized ContentItem[]
```

---

# 10. ProviderId

```ts
export type ProviderId = string;
```

Examples:

```text
rss:openai
rss:anthropic
rss:deepmind
rss:techcrunch-ai

hacker-news

gdelt:ai
```

Each configured RSS feed can be treated as its own provider even if all RSS providers share the same implementation.

Example:

```ts
new RssContentProvider({
  id: "rss:openai",
  name: "OpenAI",
  url: "..."
});

new RssContentProvider({
  id: "rss:anthropic",
  name: "Anthropic",
  url: "..."
});
```

---

# 11. ProviderState

Each provider needs a way to remember where the previous fetch stopped.

Different APIs require different state.

RSS might need:

```json
{
  "etag": "...",
  "lastModified": "...",
  "latestPublishedAt": "..."
}
```

Hacker News might need:

```json
{
  "latestCreatedAt": 1788192000
}
```

A future GitHub provider could use:

```json
{
  "lastCheckedAt": "...",
  "latestReleaseId": "..."
}
```

The generic type should therefore be JSON-compatible.

```ts
export type JsonPrimitive =
  | string
  | number
  | boolean
  | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ProviderState =
  Record<string, JsonValue>;
```

The MCP server persists this state.

The provider owns its interpretation.

---

# 12. ProviderFetchResult

```ts
export interface ProviderFetchResult {
  items: ContentItem[];
  nextState: ProviderState;
}
```

The contract is:

```text
old ProviderState
        ↓
provider.fetchNew()
        ↓
ContentItem[]
+
next ProviderState
```

A future version may support pagination:

```ts
export interface ProviderFetchResult {
  items: ContentItem[];
  nextState: ProviderState;
  hasMore?: boolean;
}
```

That should only be added when required.

---

# 13. ContentItem

`ContentItem` is the normalized representation returned by all providers.

```ts
export interface ContentItem {
  providerId: ProviderId;
  externalId: string;

  kind: ContentKind;

  title: string;
  url: string;

  publishedAt: Date;

  authors?: string[];
  description?: string;
  content?: string;

  metadata?: Record<string, JsonValue>;
}
```

Providers should preserve useful provider-specific information inside `metadata`.

But downstream code should not depend heavily on provider-specific metadata.

---

# 14. ContentKind

```ts
export type ContentKind =
  | "article"
  | "discussion"
  | "paper"
  | "release"
  | "model"
  | "video"
  | "social-post";
```

Examples:

```text
RSS article
→ article

Hacker News
→ discussion

arXiv
→ paper

GitHub
→ release

Hugging Face
→ model

YouTube
→ video

Bluesky
→ social-post
```

More kinds can be added later.

---

# 15. StoredContentItem

The object produced by a provider should be distinct from the stored database representation.

```ts
export interface StoredContentItem
  extends ContentItem {

  id: ContentItemId;

  discoveredAt: Date;

  processingStatus:
    ContentProcessingStatus;
}
```

```ts
export type ContentItemId = string;
```

---

# 16. ContentProcessingStatus

```ts
export type ContentProcessingStatus =
  | "pending"
  | "linked"
  | "ignored";
```

Meaning:

### `pending`

The AI agent has not evaluated the item.

### `linked`

The item has been attached to a story.

### `ignored`

The agent determined that the item should not become part of the curated news set.

For example:

* irrelevant
* low quality
* unrelated despite keyword match

Exact duplicates should normally never reach this state because they should be prevented during ingestion.

---

# 17. Story

A `Story` represents a distinct real-world event or development.

This is the primary curated object.

```ts
export interface Story {
  id: StoryId;

  title: string;
  summary: string;

  relevanceScore: number;
  importanceScore: number;

  firstSeenAt: Date;
  lastItemAttachedAt: Date;
  lastMeaningfulUpdateAt: Date;

  status: StoryStatus;
}
```

```ts
export type StoryId = string;
```

---

# 18. StoryStatus

Initially:

```ts
export type StoryStatus =
  | "active"
  | "archived";
```

Additional states should not be added unless they solve an actual product requirement.

---

# 19. Story Timestamps

Three timestamps represent different concepts.

## firstSeenAt

When the system first discovered the story.

Example:

```text
09:10
OpenAI announcement discovered
```

---

## lastItemAttachedAt

The latest time another content item was associated with the story.

For example:

```text
09:10 OpenAI announcement
09:25 Reuters article
10:40 Hacker News thread
13:15 TechCrunch article
```

`lastItemAttachedAt` becomes:

```text
13:15
```

---

## lastMeaningfulUpdateAt

The most recent time the story itself materially changed.

This is different.

Example:

```text
09:10
OpenAI releases Model X

09:25
Reuters reports the same release
→ not meaningful

10:40
HN discusses the same release
→ not meaningful

13:15
OpenAI announces Model X is also available through API
→ meaningful update
```

The story should remain fresh because the event changed, not because another publication repeated it.

This prevents the story lifetime from being extended forever by duplicates.

---

# 20. StoryItem

Stories and content items have a many-to-one relationship.

That relationship should be explicit.

```ts
export interface StoryItem {
  storyId: StoryId;
  contentItemId: ContentItemId;

  contribution: StoryContribution;

  reason?: string;

  attachedAt: Date;
}
```

---

# 21. StoryContribution

Instead of using:

```ts
meaningfulUpdate: boolean
```

use:

```ts
export type StoryContribution =
  | "supporting"
  | "meaningful-update"
  | "background";
```

### supporting

Another source reporting substantially the same event.

Example:

```text
OpenAI announces Model X
Reuters reports Model X
```

Reuters is supporting evidence.

---

### meaningful-update

The item introduces a new development.

Example:

```text
Model X launched yesterday.

Today OpenAI announces:
Model X is now available via API.
```

The second item changes the story.

---

### background

The item primarily contributes context.

Example:

```text
An article explains the history
of the technology behind Model X.
```

Useful, but not a new development.

---

# 22. Story Lifecycle

Stories should not remain active merely because new duplicate articles continue arriving.

A likely lifecycle:

```text
story created
      ↓
active
      ↓
meaningful updates may refresh it
      ↓
no meaningful updates for some period
      ↓
archived
```

The exact active window can be decided later.

The important rule is:

```text
lastItemAttachedAt
does NOT determine story freshness
```

Instead:

```text
lastMeaningfulUpdateAt
determines story freshness
```

A late supporting article should therefore not reset the story lifetime.

---

# 23. Provider Implementations

Initial implementations:

```ts
export class RssContentProvider
  implements ContentProvider {
}

export class HackerNewsContentProvider
  implements ContentProvider {
}

export class GdeltContentProvider
  implements ContentProvider {
}
```

Future:

```ts
export class ArxivContentProvider
  implements ContentProvider {
}

export class GitHubContentProvider
  implements ContentProvider {
}

export class HuggingFaceContentProvider
  implements ContentProvider {
}

export class YouTubeContentProvider
  implements ContentProvider {
}

export class BlueskyContentProvider
  implements ContentProvider {
}

export class MastodonContentProvider
  implements ContentProvider {
}
```

Adding a new provider should ideally require almost no changes outside its provider directory.

---

# 24. ContentProviderRegistry

The application needs a registry of configured providers.

```ts
export class ContentProviderRegistry {
  constructor(
    private readonly providers:
      ContentProvider[]
  ) {}

  getAll():
    readonly ContentProvider[] {
    return this.providers;
  }

  get(
    id: ProviderId
  ): ContentProvider | undefined {
    return this.providers.find(
      provider => provider.id === id
    );
  }
}
```

Example:

```ts
const providers =
  new ContentProviderRegistry([
    new RssContentProvider({
      id: "rss:openai",
      name: "OpenAI",
      url: "..."
    }),

    new RssContentProvider({
      id: "rss:anthropic",
      name: "Anthropic",
      url: "..."
    }),

    new HackerNewsContentProvider({
      id: "hacker-news",
      name: "Hacker News"
    }),

    new GdeltContentProvider({
      id: "gdelt:ai",
      name: "GDELT AI",
      query: "..."
    })
  ]);
```

---

# 25. Repository Layer

All SQLite access should be hidden behind repositories.

The domain and services should not contain SQL.

Initial repositories:

```text
ContentItemRepository
StoryRepository
ProviderStateRepository
```

SQLite implementations:

```text
SqliteContentItemRepository
SqliteStoryRepository
SqliteProviderStateRepository
```

---

# 26. ContentItemRepository

```ts
export interface ContentItemRepository {

  insertMany(
    items: ContentItem[]
  ): Promise<InsertContentItemsResult>;

  findPending(
    limit: number
  ): Promise<StoredContentItem[]>;

  findById(
    id: ContentItemId
  ): Promise<StoredContentItem | null>;

  markLinked(
    id: ContentItemId
  ): Promise<void>;

  markIgnored(
    id: ContentItemId
  ): Promise<void>;
}
```

Result:

```ts
export interface InsertContentItemsResult {
  inserted: StoredContentItem[];
  duplicates: number;
}
```

---

# 27. Duplicate Handling

The system should distinguish between two concepts.

## Exact duplicate

The same external item was fetched again.

This should be handled deterministically.

Possible unique key:

```text
(provider_id, external_id)
```

URL normalization may provide additional duplicate protection.

The AI agent does not need to reason about these.

---

## Semantic duplicate

Two different articles describe the same real-world event.

Example:

```text
OpenAI blog article
Reuters article
TechCrunch article
HN submission
```

These are different `ContentItem`s.

But they belong to one `Story`.

Semantic duplication is therefore handled by story clustering, not ingestion deduplication.

---

# 28. StoryRepository

```ts
export interface StoryRepository {

  create(
    input: CreateStoryInput
  ): Promise<Story>;

  findById(
    id: StoryId
  ): Promise<Story | null>;

  findActive():
    Promise<Story[]>;

  update(
    id: StoryId,
    patch: UpdateStoryInput
  ): Promise<Story>;

  archive(
    id: StoryId
  ): Promise<void>;

  attachItem(
    link: StoryItem
  ): Promise<void>;
}
```

---

# 29. ProviderStateRepository

```ts
export interface ProviderStateRepository {

  get(
    providerId: ProviderId
  ): Promise<ProviderState | null>;

  set(
    providerId: ProviderId,
    state: ProviderState
  ): Promise<void>;
}
```

Conceptual SQLite table:

```text
provider_state
────────────────────
provider_id
state_json
updated_at
```

---

# 30. IngestionService

`IngestionService` coordinates providers and persistence.

```ts
export class IngestionService {

  constructor(
    private readonly providers:
      ContentProviderRegistry,

    private readonly items:
      ContentItemRepository,

    private readonly providerStates:
      ProviderStateRepository
  ) {}

  async fetchNewItems():
    Promise<IngestionResult> {
    // ...
  }
}
```

Its behavior:

```text
for each provider
        ↓
load provider state
        ↓
provider.fetchNew(state)
        ↓
normalize
        ↓
store new ContentItems
        ↓
persist next ProviderState
```

Result:

```ts
export interface IngestionResult {
  providersProcessed: number;
  itemsFetched: number;
  itemsInserted: number;
  duplicates: number;
}
```

---

# 31. StoryService

All story mutations should go through `StoryService`.

```ts
export class StoryService {

  constructor(
    private readonly stories:
      StoryRepository,

    private readonly items:
      ContentItemRepository
  ) {}

  createStory(
    input: CreateStoryInput
  ): Promise<Story>;

  attachItem(
    input: AttachItemInput
  ): Promise<Story>;

  updateStory(
    id: StoryId,
    input: UpdateStoryInput
  ): Promise<Story>;
}
```

This service protects business rules.

For example:

```text
attach meaningful-update
        ↓
set lastItemAttachedAt
        ↓
set lastMeaningfulUpdateAt
```

But:

```text
attach supporting
        ↓
set lastItemAttachedAt
        ↓
do NOT modify lastMeaningfulUpdateAt
```

The AI agent should express intent.

The service should enforce consequences.

---

# 32. CreateStoryInput

```ts
export interface CreateStoryInput {

  contentItemIds:
    ContentItemId[];

  title: string;
  summary: string;

  relevanceScore: number;
  importanceScore: number;
}
```

The server should set timestamps itself.

The AI agent should not supply them.

---

# 33. AttachItemInput

```ts
export interface AttachItemInput {

  storyId: StoryId;
  contentItemId: ContentItemId;

  contribution:
    StoryContribution;

  reason?: string;
}
```

The optional reason is useful for debugging AI behavior.

Example:

```text
"Same OpenAI model announcement,
but this source adds API availability."
```

This can later help inspect why the agent made particular decisions.

---

# 34. UpdateStoryInput

```ts
export interface UpdateStoryInput {

  title?: string;
  summary?: string;

  relevanceScore?: number;
  importanceScore?: number;
}
```

Again, timestamps should not be externally writable.

---

# 35. FeedService

Feed generation is a separate application concern.

```ts
export class FeedService {

  constructor(
    private readonly stories:
      StoryRepository
  ) {}

  getFeed(
    query: FeedQuery
  ): Promise<Feed>;
}
```

---

# 36. FeedQuery

Initially:

```ts
export interface FeedQuery {
  limit?: number;
  includeArchived?: boolean;
}
```

Possible future options:

```ts
export interface FeedQuery {
  limit?: number;

  includeArchived?: boolean;

  since?: Date;

  minimumImportance?: number;

  minimumRelevance?: number;
}
```

Do not add these until the product needs them.

---

# 37. Feed

```ts
export interface Feed {
  generatedAt: Date;
  stories: FeedStory[];
}
```

The feed is a view.

It should not expose raw database records directly.

---

# 38. FeedStory

```ts
export interface FeedStory {

  id: StoryId;

  title: string;
  summary: string;

  importanceScore: number;
  relevanceScore: number;

  firstSeenAt: Date;
  lastMeaningfulUpdateAt: Date;

  sources: FeedSource[];
}
```

---

# 39. FeedSource

```ts
export interface FeedSource {

  providerName: string;

  title: string;
  url: string;

  publishedAt: Date;
}
```

Possible future additions:

```ts
author?: string;
kind?: ContentKind;
```

---

# 40. MCP Server

The MCP server acts as the application API.

It should expose high-level tools rather than database primitives.

The tool surface should be small enough that an AI agent can reason about it reliably.

The agent should never need tools such as:

```text
execute_sql
update_row
insert_json
delete_record
```

Instead it should receive domain-specific operations.

---

# 41. MCP Tool: fetch_new_items

Purpose:

Fetch new data from every configured `ContentProvider`.

Conceptual input:

```json
{}
```

Conceptual output:

```json
{
  "providersProcessed": 34,
  "itemsFetched": 128,
  "itemsInserted": 42,
  "duplicates": 86
}
```

Internally this calls:

```text
IngestionService.fetchNewItems()
```

This tool performs no semantic AI decisions.

---

# 42. MCP Tool: get_unprocessed_items

Purpose:

Return content awaiting AI evaluation.

Example input:

```json
{
  "limit": 50
}
```

Output contains normalized content items.

The agent can then decide:

```text
relevant?
existing story?
new story?
```

The tool should provide enough text and metadata for semantic reasoning without requiring another DB query for every item.

---

# 43. MCP Tool: get_active_stories

Purpose:

Give the AI agent the candidate stories that new content may belong to.

Example:

```json
{
  "limit": 100
}
```

Each returned story should include:

* ID
* title
* summary
* relevance
* importance
* first seen
* last meaningful update
* recent attached items
* source names

The agent should not need the complete historical database.

Only stories still considered candidates for clustering need to be returned.

---

# 44. MCP Tool: create_story

Purpose:

Create a new curated story when an item does not belong to an existing one.

Conceptual input:

```json
{
  "contentItemIds": [
    "item-123"
  ],
  "title": "OpenAI releases Model X",
  "summary": "OpenAI released ...",
  "relevanceScore": 0.98,
  "importanceScore": 0.91
}
```

The MCP server sets:

* story ID
* creation time
* first-seen time
* meaningful-update time
* relationships to content items

---

# 45. MCP Tool: attach_item_to_story

Purpose:

Associate a new item with an existing story.

Example:

```json
{
  "storyId": "story-42",
  "contentItemId": "item-551",
  "contribution": "supporting",
  "reason": "Another report covering the same announcement."
}
```

Or:

```json
{
  "storyId": "story-42",
  "contentItemId": "item-601",
  "contribution": "meaningful-update",
  "reason": "This introduces newly announced API access."
}
```

This distinction is central to story freshness.

---

# 46. MCP Tool: update_story

Purpose:

Update the AI-maintained interpretation of a story.

Example:

```json
{
  "storyId": "story-42",
  "summary": "OpenAI released Model X and later announced API availability.",
  "importanceScore": 0.94
}
```

The agent may update the summary after meaningful new information arrives.

---

# 47. MCP Tool: mark_item_processed

Purpose:

Finalize an item that should not be linked to a story.

Example:

```json
{
  "contentItemId": "item-789",
  "status": "ignored",
  "reason": "Article mentions AI only incidentally."
}
```

This prevents the same irrelevant item from being reconsidered every 30 minutes.

---

# 48. MCP Tool: get_feed

Purpose:

Retrieve the current curated AI news feed.

Example:

```json
{
  "limit": 20
}
```

The tool should return stories rather than raw content items.

Example result:

```json
{
  "generatedAt": "...",
  "stories": [
    {
      "id": "story-42",
      "title": "OpenAI releases Model X",
      "summary": "...",
      "importanceScore": 0.94,
      "sources": [
        {
          "providerName": "OpenAI",
          "title": "...",
          "url": "..."
        },
        {
          "providerName": "Hacker News",
          "title": "...",
          "url": "..."
        }
      ]
    }
  ]
}
```

This allows an AI agent to answer questions such as:

```text
What's happening in AI?
```

```text
Show me today's important AI news.
```

```text
Anything interesting since this morning?
```

```text
What's new with coding agents?
```

without giving the agent direct database access.

---

# 49. Possible Additional MCP Tools

These should only be added once needed.

Possible future tools:

```text
get_story
search_stories
get_provider_status
retry_provider
list_providers
get_recent_items
archive_story
merge_stories
split_story
```

Of these, `merge_stories` may eventually become important.

The agent might initially create:

```text
Story A
OpenAI launches Model X

Story B
OpenAI launches Model X API
```

and later determine that these are really one evolving story.

That operation should eventually be supported explicitly rather than through database manipulation.

---

# 50. SQLite

SQLite is a good fit because:

* the service is private
* there is one logical writer
* the MCP server owns all database access
* the dataset is modest
* installation is trivial
* backup means copying one file
* no database server is required
* local scheduled agents can access it naturally

The design should still hide SQLite behind repositories.

This keeps replacing SQLite possible without changing the domain model.

---

# 51. Suggested SQLite Tables

A likely initial schema:

```text
content_items

stories

story_items

provider_state
```

Potentially later:

```text
provider_runs

story_history

agent_decisions
```

---

# 52. content_items

Conceptually:

```text
content_items
────────────────────────────
id
provider_id
external_id
kind
title
url
published_at
authors_json
description
content
metadata_json
discovered_at
processing_status
```

Recommended uniqueness:

```text
UNIQUE(provider_id, external_id)
```

Potential additional URL index:

```text
normalized_url
```

---

# 53. stories

```text
stories
────────────────────────────
id
title
summary
relevance_score
importance_score
first_seen_at
last_item_attached_at
last_meaningful_update_at
status
created_at
updated_at
```

Useful indexes:

```text
status

last_meaningful_update_at

importance_score
```

---

# 54. story_items

```text
story_items
────────────────────────────
story_id
content_item_id
contribution
reason
attached_at
```

Recommended uniqueness:

```text
UNIQUE(story_id, content_item_id)
```

A content item should normally belong to one story.

This can be enforced later if desired.

---

# 55. provider_state

```text
provider_state
────────────────────────────
provider_id
state_json
updated_at
```

`provider_id` should be unique.

---

# 56. Future Observability

Since the system depends heavily on agent decisions, observability will eventually matter.

Useful information to retain may include:

* why an item was ignored
* why an item matched a story
* why the agent created a new story
* why a story was considered meaningful
* previous summary
* updated summary
* previous importance score
* updated importance score

This suggests a possible future:

```text
agent_decisions
```

table.

But it is probably unnecessary for the first implementation.

The `reason` field on item/story operations gives us a lightweight starting point.

---

# 57. Failure Handling

Provider failures should be isolated.

If GDELT fails:

```text
RSS should still ingest
HN should still ingest
```

`IngestionService` should therefore process providers independently.

A provider failure should not invalidate successful results from other providers.

Example result could later include:

```json
{
  "providersProcessed": 34,
  "providersFailed": 1,
  "failures": [
    {
      "providerId": "gdelt:ai",
      "error": "HTTP 503"
    }
  ]
}
```

Provider state should only advance after successful storage of the fetched items.

This prevents lost content.

---

# 58. Idempotency

Periodic execution should be safe.

Calling:

```text
fetch_new_items()
```

twice should not create duplicate content.

Likewise:

```text
attach_item_to_story()
```

should not accidentally create duplicate relationships.

Database constraints should enforce this where possible.

Do not depend only on application code for uniqueness.

---

# 59. Provider Design Rule

A provider must:

```text
fetch external data
normalize it
return ContentItem[]
return next ProviderState
```

A provider must not:

```text
write to SQLite

create stories

decide relevance

summarize content

rank content

call an LLM
```

This keeps providers small and easy to add.

---

# 60. Service Design Rule

Services own behavior.

Repositories own persistence.

Providers own external source translation.

MCP tools expose application operations.

The agent owns semantic reasoning.

Conceptually:

```text
External system
    ↓
Provider
    ↓
Service
    ↓
Repository
    ↓
SQLite
```

and:

```text
AI Agent
    ↓
MCP Tool
    ↓
Service
```

---

# 61. Proposed Project Structure

```text
src/
├── domain/
│   ├── content-item.ts
│   ├── story.ts
│   ├── feed.ts
│   ├── provider.ts
│   └── json.ts
│
├── providers/
│   ├── content-provider.ts
│   ├── content-provider-registry.ts
│   │
│   ├── rss/
│   │   ├── rss-content-provider.ts
│   │   └── rss-types.ts
│   │
│   ├── hacker-news/
│   │   ├── hacker-news-content-provider.ts
│   │   └── hacker-news-types.ts
│   │
│   └── gdelt/
│       ├── gdelt-content-provider.ts
│       └── gdelt-types.ts
│
├── repositories/
│   ├── content-item-repository.ts
│   ├── story-repository.ts
│   └── provider-state-repository.ts
│
├── sqlite/
│   ├── sqlite-database.ts
│   ├── sqlite-content-item-repository.ts
│   ├── sqlite-story-repository.ts
│   ├── sqlite-provider-state-repository.ts
│   │
│   └── migrations/
│       └── ...
│
├── services/
│   ├── ingestion-service.ts
│   ├── story-service.ts
│   └── feed-service.ts
│
├── mcp/
│   ├── server.ts
│   │
│   └── tools/
│       ├── fetch-new-items.ts
│       ├── get-unprocessed-items.ts
│       ├── get-active-stories.ts
│       ├── create-story.ts
│       ├── attach-item-to-story.ts
│       ├── update-story.ts
│       ├── mark-item-processed.ts
│       └── get-feed.ts
│
├── config/
│   └── providers.ts
│
└── index.ts
```

---

# 62. Naming Vocabulary

These names should be kept consistent throughout the project.

| Concept                      | Name                      |
| ---------------------------- | ------------------------- |
| External content integration | `ContentProvider`         |
| Provider identifier          | `ProviderId`              |
| Provider cursor/state        | `ProviderState`           |
| Fetch result                 | `ProviderFetchResult`     |
| Normalized external content  | `ContentItem`             |
| Stored content               | `StoredContentItem`       |
| Content category             | `ContentKind`             |
| Processing state             | `ContentProcessingStatus` |
| Curated event                | `Story`                   |
| Story identifier             | `StoryId`                 |
| Story/content relationship   | `StoryItem`               |
| Contribution type            | `StoryContribution`       |
| Provider collection          | `ContentProviderRegistry` |
| Fetch orchestration          | `IngestionService`        |
| Story operations             | `StoryService`            |
| Feed construction            | `FeedService`             |
| Persistence abstraction      | `*Repository`             |
| User-facing story            | `FeedStory`               |
| User-facing source           | `FeedSource`              |

---

# 63. Important Architectural Principle

The most important abstraction in the system is:

```text
Story ≠ ContentItem
```

A `ContentItem` is something somebody published.

A `Story` is something that happened.

Example:

```text
ContentItem:
OpenAI blog announcement

ContentItem:
Reuters report

ContentItem:
HN thread

ContentItem:
TechCrunch report
```

All may map to:

```text
Story:
OpenAI launches Model X
```

That distinction is the core reason this service can become more useful than an RSS reader.

---

# 64. Initial Product Behavior

The main product output is a curated list of story cards.

Conceptually:

```text
┌───────────────────────────────────────┐
│ OpenAI launches Model X               │
│                                       │
│ OpenAI released ...                   │
│                                       │
│ OpenAI · Reuters · Hacker News        │
│ Updated 42 minutes ago                │
└───────────────────────────────────────┘
```

Another card:

```text
┌───────────────────────────────────────┐
│ Anthropic updates Claude Code         │
│                                       │
│ Anthropic announced ...               │
│                                       │
│ Anthropic · HN                        │
│ Updated 2 hours ago                   │
└───────────────────────────────────────┘
```

The feed is story-oriented rather than source-oriented.

---

# 65. Feed Retrieval Without a Web App

The initial version does not require:

* hosting
* Vercel
* authentication
* Postgres
* a frontend
* a persistent backend process

The MCP server itself is the application interface.

The user can ask an AI agent:

```text
Show me my AI news feed.
```

The agent calls:

```text
get_feed
```

and renders the result conversationally.

Later, the same MCP server could support:

```text
web UI
mobile UI
CLI
daily digest
email
notifications
```

without changing the underlying data model.

---

# 66. Scheduled Execution

The MCP server does not need to run continuously.

A scheduled AI agent can wake periodically.

Example:

```text
every 30 minutes
        ↓
start/use MCP server
        ↓
fetch_new_items
        ↓
process pending content
        ↓
maintain stories
        ↓
finish
```

This eliminates the need for long-running cloud infrastructure.

The scheduler can come from whatever AI-agent environment is being used.

---

# 67. Why the Agent Should Perform Clustering

Clustering AI news is semantic.

Titles such as:

```text
OpenAI introduces GPT-X
```

and:

```text
Sam Altman's company launches its latest reasoning model
```

may describe the same event despite having little exact textual overlap.

Likewise:

```text
OpenAI launches GPT-X
```

and:

```text
GPT-X API becomes available
```

may be related but represent different stages of the same story.

An LLM is well suited to determining:

```text
same story?

related but separate?

meaningful update?

background?

irrelevant?
```

The database layer should not attempt to encode these decisions with brittle string rules.

---

# 68. Why the Agent Should Write Summaries

A story summary should represent the current state of the event rather than one article.

For example:

Initial story:

```text
OpenAI released Model X,
a new reasoning model.
```

Later meaningful update:

```text
OpenAI released Model X and has now
made it available through its API.
```

The summary evolves as the story evolves.

This is another reason summaries belong to `Story`, not `ContentItem`.

---

# 69. Ranking

Stories should eventually have at least:

```text
relevanceScore
importanceScore
```

These represent different ideas.

## relevanceScore

How strongly the story matches the user's definition of AI news.

Example:

```text
Major LLM release
→ very high relevance

General Microsoft earnings article
mentioning AI once
→ low relevance
```

---

## importanceScore

How much attention the story deserves.

Possible signals:

* source quality
* primary-source announcement
* number of independent sources
* HN activity
* novelty
* technical impact
* industry impact
* research impact
* regulatory significance
* company significance

The AI agent may use those signals rather than relying on a fixed mathematical formula.

---

# 70. Feed Ordering

The first implementation can order active stories primarily by:

```text
importanceScore
+
freshness
```

The exact ranking algorithm should remain outside provider logic.

Later it may incorporate:

* personal interests
* topics previously read
* story novelty
* meaningful update time
* source diversity

---

# 71. First Version Scope

The first implementation should focus on:

```text
ContentProvider abstraction

RSS provider

Hacker News provider

GDELT provider

SQLite persistence

provider state

exact deduplication

story storage

story/content relationships

MCP tools

scheduled-agent workflow

get_feed
```

Avoid initially adding:

```text
web frontend
authentication
user accounts
cloud hosting
notifications
embeddings
vector database
complex analytics
distributed workers
multiple database engines
```

Those can be introduced later if actual usage demands them.

---

# 72. Desired Extension Experience

A good test of the architecture is adding arXiv.

Ideally this should require:

```text
providers/arxiv/
    arxiv-content-provider.ts
```

which implements:

```ts
ContentProvider
```

and returns:

```ts
ContentItem[]
```

Nothing downstream should care whether the content originated from:

```text
RSS
HN
GDELT
arXiv
GitHub
Hugging Face
YouTube
```

That is the primary extensibility goal.

---

# 73. Design Summary

The service is built around four major domain concepts:

```text
Provider
    ↓
Content
    ↓
Story
    ↓
Feed
```

The infrastructure boundary is:

```text
AI Agent
    ↓
MCP Server
    ↓
Services
    ↓
Repositories
    ↓
SQLite
```

External content enters through:

```text
ContentProvider
```

All sources normalize into:

```text
ContentItem
```

The AI agent converts content into:

```text
Story
```

The user consumes:

```text
FeedStory
```

The central product idea is simple:

> Reduce a large stream of overlapping AI-related content into a small, evolving set of stories that represent what actually happened and what is worth knowing.

