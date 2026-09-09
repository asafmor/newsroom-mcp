# SQLite Schema

Uses Node's built-in `node:sqlite` (`DatabaseSync`) — no `better-sqlite3`
dependency. `src/sqlite/sqlite-database.ts` opens the database with:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
```

and runs every `*.sql` file in `src/sqlite/migrations/` (in filename order)
that isn't already recorded in `schema_migrations`. There is no rollback
mechanism by design — this is a single-file database; "rollback" means
restoring a file backup, not running down-migrations.

## Tables

### `content_items`

One row per normalized item from any provider.

- `UNIQUE (provider_id, external_id)` — the exact-duplicate guard; enforced
  by SQLite, not application code.
- `processing_status` — `pending | linked | ignored`, driving the periodic
  agent workflow.
- `idx_content_items_pending` — a partial index on `discovered_at` where
  `processing_status = 'pending'`, the primary lookup for
  `get-unprocessed-items` (oldest-first FIFO).
- `authors_json`/`metadata_json` — `TEXT` columns holding `JSON.stringify`'d
  arrays/objects; SQLite has no native array/object type.

### `stories`

One row per curated real-world event. `first_seen_at`,
`last_item_attached_at`, and `last_meaningful_update_at` are three distinct
timestamps — see [architecture.md](./architecture.md) and the
`lastMeaningfulUpdateAt` business rule in `StoryService`/`SqliteStoryRepository`:
only a `meaningful-update` attachment bumps `last_meaningful_update_at`; a
`supporting` or `background` attachment bumps only `last_item_attached_at`.
`idx_stories_status` and `idx_stories_last_meaningful_update_at` back both
`findActive()` and `archiveStale()`'s bulk `UPDATE ... WHERE status =
'active' AND last_meaningful_update_at < ?` — no migration was needed to add
archival, it's a query against existing columns/indexes.

### `story_items`

The many-to-many link between stories and content items, carrying the
`contribution` (`supporting | meaningful-update | background`) and an
optional AI-supplied `reason`. `UNIQUE (story_id, content_item_id)` — a
content item can be attached to a given story at most once; a repeat
attempt is a caller bug, not a race to swallow silently.

### `provider_state`

One row per configured provider, storing its opaque `state_json` cursor
(see [providers.md](./providers.md)) and when it was last updated.

### `podcast_episodes`

One row per weekly podcast digest episode — added by migration
`003_podcast_episodes.sql`. See [mcp-tools.md](./mcp-tools.md) for the
full business rule.

- `id` — `podcast-<iso_week>`, e.g. `podcast-2026-W37`; the same identifier
  used for the `podcast.json` entry and the GitHub Release tag.
- `iso_week` — `UNIQUE (iso_week)` is the real storage-layer enforcement of
  "one episode per ISO week" — mirrors `content_items`' `UNIQUE
  (provider_id, external_id)`. A second `INSERT` for a week that already
  has one throws here; `SqlitePodcastRepository.create()` catches that and
  re-throws a `PodcastWeekConflictError` naming the existing episode.
- `segments_json` — `TEXT` holding `JSON.stringify`'d ordered transcript
  segments (same pattern as `content_items.authors_json`).
- `voice`/`instructions` — the TTS voice and tone/instructions text
  submitted with the script; Phase 2 resends both, verbatim, on every
  synthesis chunk of the episode.
- `audio_state`/`audio_url`/`audio_duration_seconds`/`audio_size_bytes`/
  `audio_mime_type`/`failure_reason` — present for forward-compatibility
  with the persisted-record shape, but this PR never writes anything but
  the `audio_state` insert default (`'pending'`) into them: Phase 2
  (mechanical TTS synthesis) writes audio state only into the published
  `podcast.json` snapshot, never back into this table. Reading a row back
  always reports `audio_state = 'pending'` in this PR, however
  `podcast.json` (published separately) may already show it as `ready` or
  `failed` — the database is the source of truth for script content, the
  published file is the source of truth for audio state.
- `findByIsoWeek()`/`findRecent()`'s `ORDER BY iso_week DESC` use the
  implicit index the `UNIQUE (iso_week)` constraint already creates — no
  separate index needed for those. `idx_podcast_episodes_submitted_at`
  exists for forward-compatibility with a future submitted-at-ordered query.

## Dates

Every timestamp is stored as an ISO 8601 UTC `TEXT` string. SQLite has no
native date type, and ISO 8601 strings sort correctly under plain string
comparison — no custom collation needed.
