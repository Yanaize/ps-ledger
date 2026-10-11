-- Core schema for PS Price Compare

CREATE TABLE IF NOT EXISTS concepts (
  concept_id TEXT PRIMARY KEY,
  canonical_title TEXT NOT NULL,
  cover_url TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL,
  region TEXT NOT NULL,
  name TEXT NOT NULL,
  platforms_json TEXT NOT NULL DEFAULT '[]',
  edition_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  edition_name TEXT,
  classification TEXT NOT NULL DEFAULT 'OTHER',
  sku_suffix TEXT,
  release_date TEXT,
  cover_url TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);

CREATE INDEX IF NOT EXISTS idx_products_concept_region ON products(concept_id, region);

CREATE TABLE IF NOT EXISTS product_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id TEXT NOT NULL,
  region TEXT NOT NULL,
  base_product_id TEXT NOT NULL,
  matched_product_id TEXT,
  confidence TEXT NOT NULL,
  reason TEXT NOT NULL,
  is_manual INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(concept_id, region, base_product_id)
);

CREATE TABLE IF NOT EXISTS prices (
  product_id TEXT NOT NULL,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  base_minor INTEGER NOT NULL,
  discounted_minor INTEGER NOT NULL,
  discount_pct REAL,
  sale_end_at TEXT,
  is_free INTEGER NOT NULL DEFAULT 0,
  in_plus_catalog INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (product_id, region)
);

CREATE TABLE IF NOT EXISTS fetch_log (
  dataset TEXT NOT NULL,
  key TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  error TEXT,
  PRIMARY KEY (dataset, key)
);

CREATE TABLE IF NOT EXISTS search_cache (
  region TEXT NOT NULL,
  query_norm TEXT NOT NULL,
  results_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (region, query_norm)
);

CREATE TABLE IF NOT EXISTS catalog_entries (
  concept_id TEXT NOT NULL,
  region TEXT NOT NULL,
  list_key TEXT NOT NULL DEFAULT 'plus-games-list',
  name TEXT NOT NULL,
  name_en TEXT,
  devices_json TEXT NOT NULL DEFAULT '[]',
  genres_json TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  product_id TEXT,
  present INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (concept_id, region, list_key)
);

CREATE TABLE IF NOT EXISTS catalog_snapshots (
  region TEXT NOT NULL,
  list_key TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  PRIMARY KEY (region, list_key)
);

CREATE TABLE IF NOT EXISTS gift_card_listings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  region TEXT NOT NULL,
  denom_minor INTEGER NOT NULL,
  denom_currency TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  product_key TEXT NOT NULL,
  product_url TEXT NOT NULL,
  price_minor INTEGER NOT NULL,
  price_currency TEXT NOT NULL,
  stock_status TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  is_manual INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_giftcards_region ON gift_card_listings(region, provider);

CREATE TABLE IF NOT EXISTS exchange_rates (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  provider TEXT NOT NULL,
  as_of TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (base, quote)
);

CREATE TABLE IF NOT EXISTS refresh_jobs (
  dataset TEXT PRIMARY KEY,
  last_attempt_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  message TEXT
);

CREATE TABLE IF NOT EXISTS user_prefs (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS popular_concepts (
  concept_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  added_at TEXT NOT NULL
);
