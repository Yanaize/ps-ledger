-- Watchlist membership is separate from price history and tracked_games.
-- Removing a game from the watchlist must not delete historical prices.

CREATE TABLE IF NOT EXISTS watchlist_items (
  concept_id TEXT PRIMARY KEY,
  added_at TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_watchlist_added ON watchlist_items(added_at);
