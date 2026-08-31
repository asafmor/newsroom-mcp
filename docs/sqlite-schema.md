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

## Dates

Every timestamp is stored as an ISO 8601 UTC `TEXT` string. SQLite has no
native date type, and ISO 8601 strings sort correctly under plain string
comparison — no custom collation needed.
