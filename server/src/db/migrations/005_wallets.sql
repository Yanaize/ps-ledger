-- Explicit PSN wallet balances. Nothing else may change these rows.

CREATE TABLE IF NOT EXISTS wallet_balances (
  region TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  balance_minor INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
