-- Adds agent-assigned story topic tags: a closed vocabulary of at most 3
-- values, stored as a JSON array (same pattern as content_items.authors_json).
-- NULL for every pre-existing row; the repository reads that back as [].

ALTER TABLE stories ADD COLUMN tags_json TEXT;
