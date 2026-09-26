import type { Db } from '../sqlite.js';

export function upsertRates(
  db: Db,
  base: string,
  rates: Record<string, number>,
  provider: string,
  asOf: string,
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO exchange_rates (base, quote, rate, provider, as_of, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(base, quote) DO UPDATE SET
       rate = excluded.rate,
       provider = excluded.provider,
       as_of = excluded.as_of,
       fetched_at = excluded.fetched_at`,
  );
  for (const [quote, rate] of Object.entries(rates)) {
    stmt.run(base, quote, rate, provider, asOf, now);
  }
}

export function getRates(db: Db, base: string) {
  const rows = db
    .prepare(
      'SELECT quote, rate, provider, as_of, fetched_at FROM exchange_rates WHERE base = ?',
    )
    .all(base) as Array<{
    quote: string;
    rate: number;
    provider: string;
    as_of: string;
    fetched_at: string;
  }>;
  if (rows.length === 0) return null;
  const rates: Record<string, number> = {};
  for (const r of rows) rates[r.quote] = r.rate;
  return {
    base,
    rates,
    provider: rows[0].provider,
    asOf: rows[0].as_of,
    fetchedAt: rows[0].fetched_at,
  };
}
