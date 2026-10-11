-- Each browser keeps its own watchlist. Price history stays shared.
-- Existing rows are copied with an empty owner and claimed by the first browser that asks.

CREATE TABLE IF NOT EXISTS app_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_members (
  owner_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (owner_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_members_added
  ON watchlist_members(owner_id, added_at);

INSERT INTO watchlist_members (owner_id, concept_id, added_at, notes)
SELECT '', concept_id, added_at, notes
FROM watchlist_items;
