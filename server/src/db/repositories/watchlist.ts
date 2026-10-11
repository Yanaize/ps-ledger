import type { Db } from '../sqlite.js';

export interface WatchlistRow {
  concept_id: string;
  added_at: string;
  notes: string | null;
}

const LEGACY_OWNER = '';
const CLAIM_FLAG = 'watchlist_legacy_claimed';

/** Give this browser the watchlist that existed before lists were per person. Only the first caller receives it. */
export function claimLegacyWatchlist(db: Db, ownerId: string): void {
  const existing = db
    .prepare(`SELECT value FROM app_flags WHERE key = ?`)
    .get(CLAIM_FLAG) as { value: string } | undefined;
  if (existing) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    const again = db
      .prepare(`SELECT value FROM app_flags WHERE key = ?`)
      .get(CLAIM_FLAG) as { value: string } | undefined;
    if (!again) {
      db.prepare(`UPDATE watchlist_members SET owner_id = ? WHERE owner_id = ?`).run(
        ownerId,
        LEGACY_OWNER,
      );
      db.prepare(`INSERT INTO app_flags (key, value) VALUES (?, ?)`).run(CLAIM_FLAG, ownerId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function upsertWatchlistItem(
  db: Db,
  ownerId: string,
  conceptId: string,
  notes?: string | null,
): void {
  const now = new Date().toISOString();
  const existing = getWatchlistItem(db, ownerId, conceptId);
  if (existing) {
    if (notes !== undefined) {
      db.prepare(
        `UPDATE watchlist_members SET notes = ? WHERE owner_id = ? AND concept_id = ?`,
      ).run(notes, ownerId, conceptId);
    }
    return;
  }
  db.prepare(
    `INSERT INTO watchlist_members (owner_id, concept_id, added_at, notes) VALUES (?, ?, ?, ?)`,
  ).run(ownerId, conceptId, now, notes ?? null);
}

export function deleteWatchlistItem(db: Db, ownerId: string, conceptId: string): void {
  db.prepare(`DELETE FROM watchlist_members WHERE owner_id = ? AND concept_id = ?`).run(
    ownerId,
    conceptId,
  );
}

export function getWatchlistItem(
  db: Db,
  ownerId: string,
  conceptId: string,
): WatchlistRow | undefined {
  return db
    .prepare(
      `SELECT concept_id, added_at, notes FROM watchlist_members WHERE owner_id = ? AND concept_id = ?`,
    )
    .get(ownerId, conceptId) as WatchlistRow | undefined;
}

export function listWatchlistItems(db: Db, ownerId: string): WatchlistRow[] {
  return db
    .prepare(
      `SELECT concept_id, added_at, notes FROM watchlist_members WHERE owner_id = ? ORDER BY added_at DESC`,
    )
    .all(ownerId) as unknown as WatchlistRow[];
}
