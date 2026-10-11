import type { CatalogRegion, Platform } from '@ps-price-compare/shared';
import type { Db } from '../sqlite.js';

export function replaceCatalogSnapshot(
  db: Db,
  region: CatalogRegion,
  listKey: string,
  games: Array<{
    conceptId: string;
    name: string;
    nameEn: string | null;
    devices: Platform[];
    genres: string[];
    imageUrl: string | null;
    productId: string | null;
  }>,
): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    // Mark existing as not present, then upsert seen ones
    db.prepare(
      'UPDATE catalog_entries SET present = 0 WHERE region = ? AND list_key = ?',
    ).run(region, listKey);

    const upsert = db.prepare(
      `INSERT INTO catalog_entries (
         concept_id, region, list_key, name, name_en, devices_json, genres_json,
         image_url, product_id, present, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(concept_id, region, list_key) DO UPDATE SET
         name = excluded.name,
         name_en = excluded.name_en,
         devices_json = excluded.devices_json,
         genres_json = excluded.genres_json,
         image_url = excluded.image_url,
         product_id = excluded.product_id,
         present = 1,
         last_seen_at = excluded.last_seen_at`,
    );

    for (const g of games) {
      upsert.run(
        String(g.conceptId),
        region,
        listKey,
        g.name,
        g.nameEn,
        JSON.stringify(g.devices),
        JSON.stringify(g.genres),
        g.imageUrl,
        g.productId,
        now,
      );
    }

    db.prepare(
      `INSERT INTO catalog_snapshots (region, list_key, fetched_at, count, ok, error)
       VALUES (?, ?, ?, ?, 1, NULL)
       ON CONFLICT(region, list_key) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         count = excluded.count,
         ok = 1,
         error = NULL`,
    ).run(region, listKey, now, games.length);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function markCatalogSnapshotFailed(
  db: Db,
  region: CatalogRegion,
  listKey: string,
  error: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO catalog_snapshots (region, list_key, fetched_at, count, ok, error)
     VALUES (?, ?, ?, 0, 0, ?)
     ON CONFLICT(region, list_key) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       ok = 0,
       error = excluded.error`,
  ).run(region, listKey, now, error);
}

export function getCatalogEntries(db: Db, listKey = 'plus-games-list') {
  return db
    .prepare(
      `SELECT concept_id, region, name, name_en, devices_json, genres_json, image_url, product_id, present, last_seen_at
       FROM catalog_entries WHERE list_key = ? AND present = 1`,
    )
    .all(listKey) as Array<{
    concept_id: string;
    region: string;
    name: string;
    name_en: string | null;
    devices_json: string;
    genres_json: string;
    image_url: string | null;
    product_id: string | null;
    present: number;
    last_seen_at: string;
  }>;
}

export function getCatalogSnapshots(db: Db, listKey = 'plus-games-list') {
  return db
    .prepare(
      'SELECT region, list_key, fetched_at, count, ok, error FROM catalog_snapshots WHERE list_key = ?',
    )
    .all(listKey) as Array<{
    region: string;
    list_key: string;
    fetched_at: string;
    count: number;
    ok: number;
    error: string | null;
  }>;
}

export function setPopularConcept(db: Db, conceptId: string, reason: string): void {
  db.prepare(
    `INSERT INTO popular_concepts (concept_id, reason, added_at)
     VALUES (?, ?, ?)
     ON CONFLICT(concept_id) DO UPDATE SET reason = excluded.reason`,
  ).run(conceptId, reason, new Date().toISOString());
}

export function getPopularConceptIds(db: Db): Map<string, string> {
  const rows = db
    .prepare('SELECT concept_id, reason FROM popular_concepts')
    .all() as Array<{ concept_id: string; reason: string }>;
  return new Map(rows.map((r) => [r.concept_id, r.reason]));
}

export function getPref(db: Db, key: string): unknown {
  const row = db.prepare('SELECT value_json FROM user_prefs WHERE key = ?').get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

export function setPref(db: Db, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO user_prefs (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(key, JSON.stringify(value));
}
