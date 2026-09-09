-- Weekly podcast digest episodes: one immutable script per ISO calendar
-- week. UNIQUE(iso_week) is the real storage-layer enforcement of "one
-- episode per ISO week" (mirrors content_items' UNIQUE(provider_id,
-- external_id)) — a second submission for a week that already has one
-- fails here, not just in application code.
--
-- The audio_* / failure_reason columns exist for forward-compatibility with
-- the persisted-record shape described in the requirements, but nothing in
-- this PR ever updates them past their 'pending' insert default: Phase 2
-- (mechanical TTS synthesis) writes audio state only to the published
-- `podcast.json` snapshot, never back into this table — see
-- docs/mcp-tools.md and docs/sqlite-schema.md.
CREATE TABLE podcast_episodes (
  id                       TEXT PRIMARY KEY,
  iso_week                 TEXT NOT NULL,
  title                    TEXT NOT NULL,
  segments_json            TEXT NOT NULL,
  total_character_count    INTEGER NOT NULL,
  voice                    TEXT NOT NULL,
  instructions             TEXT NOT NULL,
  submitted_at             TEXT NOT NULL,
  audio_state              TEXT NOT NULL DEFAULT 'pending'
                             CHECK (audio_state IN ('pending', 'ready', 'failed')),
  audio_url                TEXT,
  audio_duration_seconds   INTEGER,
  audio_size_bytes         INTEGER,
  audio_mime_type          TEXT,
  failure_reason           TEXT,
  UNIQUE (iso_week)
);

CREATE INDEX idx_podcast_episodes_submitted_at ON podcast_episodes (submitted_at);
