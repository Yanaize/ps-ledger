-- Price alert rules and fired events. History rows are never deleted from here.

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  threshold_minor INTEGER,
  threshold_pct REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(concept_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_concept ON alert_rules(concept_id, enabled);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  concept_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  region TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  old_minor INTEGER,
  old_currency TEXT,
  new_minor INTEGER NOT NULL,
  new_currency TEXT NOT NULL,
  new_ils_minor INTEGER,
  discount_pct REAL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  viewed_at TEXT,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_events_fingerprint
  ON alert_events(rule_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_alert_events_created
  ON alert_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_unviewed
  ON alert_events(viewed_at, created_at DESC);
