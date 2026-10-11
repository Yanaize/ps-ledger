-- Price history + tracked games (change-based segments, soft tracking)

CREATE TABLE IF NOT EXISTS tracked_games (
  concept_id TEXT PRIMARY KEY,
  preferred_product_id TEXT,
  title TEXT NOT NULL,
  cover_url TEXT,
  tracked_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_collected_at TEXT,
  last_collect_ok INTEGER,
  last_collect_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracked_games_active ON tracked_games(active);

-- One row per contiguous price state (not per check).
-- Identical observations extend last_seen_at instead of inserting duplicates.
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  base_minor INTEGER NOT NULL,
  current_minor INTEGER NOT NULL,
  discount_pct REAL,
  is_on_sale INTEGER NOT NULL DEFAULT 0,
  sale_end_at TEXT,
  -- Frankfurter-style: units of native currency per 1 ILS (NULL if unknown)
  fx_rate_ils_base REAL,
  fx_as_of TEXT,
  fx_provider TEXT,
  observed_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_region_time
  ON price_history(product_id, region, observed_at);

CREATE INDEX IF NOT EXISTS idx_price_history_concept_region
  ON price_history(concept_id, region, observed_at);

CREATE TABLE IF NOT EXISTS price_collector_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run_at TEXT,
  last_success_at TEXT,
  last_result_json TEXT,
  next_run_at TEXT
);

INSERT OR IGNORE INTO price_collector_state (id) VALUES (1);
