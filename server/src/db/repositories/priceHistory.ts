import type { CurrencyCode, PriceRegion } from '@ps-price-compare/shared';
import type { Db } from '../sqlite.js';

export interface PriceHistoryRow {
  id: number;
  product_id: string;
  concept_id: string;
  region: string;
  currency: string;
  base_minor: number;
  current_minor: number;
  discount_pct: number | null;
  is_on_sale: number;
  sale_end_at: string | null;
  fx_rate_ils_base: number | null;
  fx_as_of: string | null;
  fx_provider: string | null;
  observed_at: string;
  last_seen_at: string;
}

export interface TrackedGameRow {
  concept_id: string;
  preferred_product_id: string | null;
  title: string;
  cover_url: string | null;
  tracked_at: string;
  active: number;
  last_collected_at: string | null;
  last_collect_ok: number | null;
  last_collect_message: string | null;
}

export type RecordObservationInput = {
  productId: string;
  conceptId: string;
  region: PriceRegion;
  currency: CurrencyCode;
  baseMinor: number;
  currentMinor: number;
  discountPct: number | null;
  isOnSale: boolean;
  saleEndAt: string | null;
  fxRateIlsBase: number | null;
  fxAsOf: string | null;
  fxProvider: string | null;
  observedAt?: string;
};

function samePriceState(
  prev: PriceHistoryRow,
  next: RecordObservationInput,
): boolean {
  return (
    prev.currency === next.currency &&
    prev.base_minor === next.baseMinor &&
    prev.current_minor === next.currentMinor &&
    (prev.discount_pct ?? null) === (next.discountPct ?? null) &&
    Boolean(prev.is_on_sale) === next.isOnSale
  );
}

/** Record a successful price observation. Failed fetches must not call this. */
export function recordPriceObservation(
  db: Db,
  input: RecordObservationInput,
): { changed: boolean; id: number; previous: PriceHistoryRow | null } {
  const now = input.observedAt ?? new Date().toISOString();
  const latest = getLatestHistory(db, input.productId, input.region);

  if (latest && samePriceState(latest, input)) {
    db.prepare(
      `UPDATE price_history SET last_seen_at = ? WHERE id = ?`,
    ).run(now, latest.id);
    return { changed: false, id: latest.id, previous: null as PriceHistoryRow | null };
  }

  const result = db
    .prepare(
      `INSERT INTO price_history (
         product_id, concept_id, region, currency, base_minor, current_minor,
         discount_pct, is_on_sale, sale_end_at,
         fx_rate_ils_base, fx_as_of, fx_provider,
         observed_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.productId,
      input.conceptId,
      input.region,
      input.currency,
      input.baseMinor,
      input.currentMinor,
      input.discountPct,
      input.isOnSale ? 1 : 0,
      input.saleEndAt,
      input.fxRateIlsBase,
      input.fxAsOf,
      input.fxProvider,
      now,
      now,
    );

  return { changed: true, id: Number(result.lastInsertRowid), previous: latest ?? null };
}

export function getLatestHistory(
  db: Db,
  productId: string,
  region: string,
): PriceHistoryRow | undefined {
  return db
    .prepare(
      `SELECT * FROM price_history
       WHERE product_id = ? AND region = ?
       ORDER BY observed_at DESC, id DESC
       LIMIT 1`,
    )
    .get(productId, region) as PriceHistoryRow | undefined;
}

export function getHistorySeries(
  db: Db,
  opts: {
    productId?: string;
    conceptId?: string;
    region?: string;
    regions?: string[];
    since?: string | null;
  },
): PriceHistoryRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.productId) {
    clauses.push('product_id = ?');
    params.push(opts.productId);
  }
  if (opts.conceptId) {
    clauses.push('concept_id = ?');
    params.push(opts.conceptId);
  }
  if (opts.region) {
    clauses.push('region = ?');
    params.push(opts.region);
  }
  if (opts.regions?.length) {
    clauses.push(`region IN (${opts.regions.map(() => '?').join(',')})`);
    params.push(...opts.regions);
  }
  if (opts.since) {
    clauses.push('last_seen_at >= ?');
    params.push(opts.since);
    // Also include segments that started before but were still active in range
    // by using OR observed_at >= since — covered if we also want segments overlapping:
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT * FROM price_history ${where} ORDER BY observed_at ASC, id ASC`,
    )
    .all(...(params as never[])) as unknown as PriceHistoryRow[];
}

/** Segments overlapping [since, now] for charting (step series). */
export function getHistoryForChart(
  db: Db,
  opts: {
    conceptId: string;
    productIds?: string[];
    regions: string[];
    since: string | null;
  },
): PriceHistoryRow[] {
  const clauses = ['concept_id = ?'];
  const params: unknown[] = [opts.conceptId];

  if (opts.productIds?.length) {
    clauses.push(`product_id IN (${opts.productIds.map(() => '?').join(',')})`);
    params.push(...opts.productIds);
  }
  if (opts.regions.length) {
    clauses.push(`region IN (${opts.regions.map(() => '?').join(',')})`);
    params.push(...opts.regions);
  }
  if (opts.since) {
    // Include open-ended segments that started before the window but were still active
    clauses.push('(last_seen_at >= ? OR observed_at >= ?)');
    params.push(opts.since, opts.since);
  }

  return db
    .prepare(
      `SELECT * FROM price_history
       WHERE ${clauses.join(' AND ')}
       ORDER BY region ASC, product_id ASC, observed_at ASC, id ASC`,
    )
    .all(...(params as never[])) as unknown as PriceHistoryRow[];
}

export function upsertTrackedGame(
  db: Db,
  input: {
    conceptId: string;
    title: string;
    coverUrl?: string | null;
    preferredProductId?: string | null;
  },
): void {
  const now = new Date().toISOString();
  const existing = getTrackedGame(db, input.conceptId);
  if (existing) {
    db.prepare(
      `UPDATE tracked_games SET
         active = 1,
         title = ?,
         cover_url = COALESCE(?, cover_url),
         preferred_product_id = COALESCE(?, preferred_product_id),
         tracked_at = CASE WHEN active = 0 THEN ? ELSE tracked_at END
       WHERE concept_id = ?`,
    ).run(
      input.title,
      input.coverUrl ?? null,
      input.preferredProductId ?? null,
      now,
      input.conceptId,
    );
    return;
  }
  db.prepare(
    `INSERT INTO tracked_games (
       concept_id, preferred_product_id, title, cover_url, tracked_at, active
     ) VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(
    input.conceptId,
    input.preferredProductId ?? null,
    input.title,
    input.coverUrl ?? null,
    now,
  );
}

export function setTrackedActive(db: Db, conceptId: string, active: boolean): void {
  db.prepare(`UPDATE tracked_games SET active = ? WHERE concept_id = ?`).run(
    active ? 1 : 0,
    conceptId,
  );
}

export function getTrackedGame(db: Db, conceptId: string): TrackedGameRow | undefined {
  return db
    .prepare(`SELECT * FROM tracked_games WHERE concept_id = ?`)
    .get(conceptId) as TrackedGameRow | undefined;
}

export function listTrackedGames(db: Db, opts?: { activeOnly?: boolean }): TrackedGameRow[] {
  if (opts?.activeOnly) {
    return db
      .prepare(`SELECT * FROM tracked_games WHERE active = 1 ORDER BY tracked_at DESC`)
      .all() as unknown as TrackedGameRow[];
  }
  return db
    .prepare(`SELECT * FROM tracked_games ORDER BY active DESC, tracked_at DESC`)
    .all() as unknown as TrackedGameRow[];
}

export function updateTrackedCollectionResult(
  db: Db,
  conceptId: string,
  ok: boolean,
  message: string,
): void {
  db.prepare(
    `UPDATE tracked_games SET
       last_collected_at = ?,
       last_collect_ok = ?,
       last_collect_message = ?
     WHERE concept_id = ?`,
  ).run(new Date().toISOString(), ok ? 1 : 0, message, conceptId);
}

export function getCollectorState(db: Db): {
  last_run_at: string | null;
  last_success_at: string | null;
  last_result_json: string | null;
  next_run_at: string | null;
} {
  return (
    (db
      .prepare(
        `SELECT last_run_at, last_success_at, last_result_json, next_run_at
         FROM price_collector_state WHERE id = 1`,
      )
      .get() as {
      last_run_at: string | null;
      last_success_at: string | null;
      last_result_json: string | null;
      next_run_at: string | null;
    }) ?? {
      last_run_at: null,
      last_success_at: null,
      last_result_json: null,
      next_run_at: null,
    }
  );
}

export function setCollectorState(
  db: Db,
  patch: {
    lastRunAt?: string | null;
    lastSuccessAt?: string | null;
    lastResultJson?: string | null;
    nextRunAt?: string | null;
  },
): void {
  const cur = getCollectorState(db);
  db.prepare(
    `UPDATE price_collector_state SET
       last_run_at = ?,
       last_success_at = ?,
       last_result_json = ?,
       next_run_at = ?
     WHERE id = 1`,
  ).run(
    patch.lastRunAt !== undefined ? patch.lastRunAt : cur.last_run_at,
    patch.lastSuccessAt !== undefined ? patch.lastSuccessAt : cur.last_success_at,
    patch.lastResultJson !== undefined ? patch.lastResultJson : cur.last_result_json,
    patch.nextRunAt !== undefined ? patch.nextRunAt : cur.next_run_at,
  );
}

export function countTracked(db: Db): { active: number; total: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
         COUNT(*) AS total
       FROM tracked_games`,
    )
    .get() as { active: number | null; total: number };
  return { active: row.active ?? 0, total: row.total };
}
