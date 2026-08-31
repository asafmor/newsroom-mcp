-- Initial schema: content items, stories, story/item links, provider cursors.
-- Timestamps are stored as ISO 8601 UTC strings (TEXT) for readability and
-- because SQLite has no native date type; string comparison sorts correctly.

CREATE TABLE content_items (
  id                 TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL,
  external_id        TEXT NOT NULL,
  kind               TEXT NOT NULL,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  published_at       TEXT NOT NULL,
  authors_json       TEXT,
  description        TEXT,
  content            TEXT,
  metadata_json      TEXT,
  discovered_at      TEXT NOT NULL,
  processing_status  TEXT NOT NULL DEFAULT 'pending'
                       CHECK (processing_status IN ('pending', 'linked', 'ignored')),
  UNIQUE (provider_id, external_id)
);

-- The primary lookup for the periodic agent workflow: "give me pending work".
CREATE INDEX idx_content_items_pending
  ON content_items (discovered_at)
  WHERE processing_status = 'pending';

CREATE TABLE stories (
  id                         TEXT PRIMARY KEY,
  title                      TEXT NOT NULL,
  summary                    TEXT NOT NULL,
  relevance_score            REAL NOT NULL,
  importance_score           REAL NOT NULL,
  first_seen_at              TEXT NOT NULL,
  last_item_attached_at      TEXT NOT NULL,
  last_meaningful_update_at  TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'archived')),
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);

CREATE INDEX idx_stories_status ON stories (status);
CREATE INDEX idx_stories_last_meaningful_update_at ON stories (last_meaningful_update_at);
CREATE INDEX idx_stories_importance_score ON stories (importance_score);

CREATE TABLE story_items (
  story_id          TEXT NOT NULL REFERENCES stories (id),
  content_item_id   TEXT NOT NULL REFERENCES content_items (id),
  contribution      TEXT NOT NULL
                      CHECK (contribution IN ('supporting', 'meaningful-update', 'background')),
  reason            TEXT,
  attached_at       TEXT NOT NULL,
  UNIQUE (story_id, content_item_id)
);

CREATE INDEX idx_story_items_story_id ON story_items (story_id);

CREATE TABLE provider_state (
  provider_id  TEXT PRIMARY KEY,
  state_json   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
