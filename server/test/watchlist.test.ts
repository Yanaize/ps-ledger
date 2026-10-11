import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertConcept, upsertProduct, upsertPrice } from '../src/db/repositories/games.js';
import { recordPriceObservation } from '../src/db/repositories/priceHistory.js';
import { getTrackedGame } from '../src/db/repositories/priceHistory.js';
import { PriceHistoryService } from '../src/services/priceHistoryService.js';
import { WatchlistService } from '../src/services/watchlistService.js';
import type { ExchangeService } from '../src/services/exchangeService.js';

function openTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const migDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/db/migrations',
  );
  for (const file of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migDir, file), 'utf8'));
  }
  return db;
}

describe('watchlist', () => {
  let db: DatabaseSync;
  let svc: WatchlistService;

  beforeEach(() => {
    db = openTestDb();
    const exchange = {
      getSnapshot: async () => ({
        rates: { JPY: 50, INR: 25, TRY: 10 },
        asOf: '2026-09-26T00:00:00.000Z',
        provider: 'test',
      }),
    } as unknown as ExchangeService;
    const history = new PriceHistoryService(db as never, exchange);
    svc = new WatchlistService(db as never, history, exchange);
  });

  it('adds a game and starts tracking', async () => {
    const item = await svc.add('user-a', { conceptId: '1001', title: 'Test Game' });
    expect(item.conceptId).toBe('1001');
    expect(item.tracked).toBe(true);
    expect(svc.has('user-a', '1001')).toBe(true);
    expect(getTrackedGame(db as never, '1001')?.active).toBe(1);
  });

  it('removing from the watchlist keeps tracking and history', async () => {
    await svc.add('user-a', { conceptId: '1001', title: 'Test Game' });
    recordPriceObservation(db as never, {
      productId: 'P1',
      conceptId: '1001',
      region: 'JP',
      currency: 'JPY',
      baseMinor: 8000,
      currentMinor: 8000,
      discountPct: null,
      isOnSale: false,
      saleEndAt: null,
      fxRateIlsBase: 50,
      fxAsOf: '2026-09-26T00:00:00.000Z',
      fxProvider: 'test',
    });
    svc.remove('user-a', '1001');
    expect(svc.has('user-a', '1001')).toBe(false);
    expect(getTrackedGame(db as never, '1001')?.active).toBe(1);
    const count = db.prepare('SELECT COUNT(*) AS c FROM price_history').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('lists cheapest region, discount, lowest, and PS Plus', async () => {
    upsertConcept(db as never, '1001', 'Test Game', null);
    upsertProduct(db as never, {
      productId: 'JP1',
      conceptId: '1001',
      region: 'JP',
      name: 'Game',
      platforms: ['PS5'],
      editionType: 'STANDARD',
      editionName: 'Standard',
      classification: 'FULL_GAME',
      skuSuffix: '00',
      releaseDate: null,
      coverUrl: null,
    });
    upsertProduct(db as never, {
      productId: 'IN1',
      conceptId: '1001',
      region: 'IN',
      name: 'Game',
      platforms: ['PS5'],
      editionType: 'STANDARD',
      editionName: 'Standard',
      classification: 'FULL_GAME',
      skuSuffix: '00',
      releaseDate: null,
      coverUrl: null,
    });
    upsertPrice(db as never, {
      productId: 'JP1',
      region: 'JP',
      currency: 'JPY',
      baseMinor: 8000,
      discountedMinor: 4000,
      discountPct: 50,
      saleEndAt: null,
      isFree: false,
      inPlusCatalog: false,
    });
    upsertPrice(db as never, {
      productId: 'IN1',
      region: 'IN',
      currency: 'INR',
      baseMinor: 400000,
      discountedMinor: 400000,
      discountPct: null,
      saleEndAt: null,
      isFree: false,
      inPlusCatalog: false,
    });
    recordPriceObservation(db as never, {
      productId: 'JP1',
      conceptId: '1001',
      region: 'JP',
      currency: 'JPY',
      baseMinor: 8000,
      currentMinor: 3500,
      discountPct: 56,
      isOnSale: true,
      saleEndAt: null,
      fxRateIlsBase: 50,
      fxAsOf: null,
      fxProvider: 'test',
    });
    recordPriceObservation(db as never, {
      productId: 'JP1',
      conceptId: '1001',
      region: 'JP',
      currency: 'JPY',
      baseMinor: 8000,
      currentMinor: 4000,
      discountPct: 50,
      isOnSale: true,
      saleEndAt: null,
      fxRateIlsBase: 50,
      fxAsOf: null,
      fxProvider: 'test',
    });
    db.prepare(
      `INSERT INTO catalog_entries (
         concept_id, region, list_key, name, devices_json, genres_json, present, last_seen_at
       ) VALUES ('1001', 'IL', 'plus-games-list', 'Game', '[]', '[]', 1, '2026-09-26T00:00:00.000Z')`,
    ).run();

    await svc.add('user-a', { conceptId: '1001', title: 'Test Game' });
    const [row] = await svc.list('user-a');
    // ¥4000 / 50 = ₪80; ₹4000 / 25 = ₪160 → Japan cheaper
    expect(row!.cheapestRegion).toBe('JP');
    expect(row!.currentBest?.amountMinor).toBe(8000);
    expect(row!.discountPct).toBe(50);
    // lowest native 3500 / 50 = ₪70
    expect(row!.lowestRecorded?.amountMinor).toBe(7000);
    expect(row!.atLowestRecorded).toBe(false);
    expect(row!.psPlusRegions).toContain('IL');
    expect(row!.deltaFromLowestIls?.amountMinor).toBe(1000);
  });

  it('keeps a separate list for each person', async () => {
    await svc.add('user-a', { conceptId: '1001', title: 'Game A' });
    await svc.add('user-b', { conceptId: '1002', title: 'Game B' });
    await svc.add('user-b', { conceptId: '1001', title: 'Game A' });

    expect((await svc.list('user-a')).map((item) => item.conceptId)).toEqual(['1001']);
    expect((await svc.list('user-b')).map((item) => item.conceptId).sort()).toEqual([
      '1001',
      '1002',
    ]);

    svc.remove('user-a', '1001');
    expect(svc.has('user-a', '1001')).toBe(false);
    expect(svc.has('user-b', '1001')).toBe(true);
    expect(getTrackedGame(db as never, '1001')?.active).toBe(1);
  });

  it('gives the previous shared list to the first person who opens it', async () => {
    db.prepare(
      `INSERT INTO watchlist_members (owner_id, concept_id, added_at, notes) VALUES ('', 'legacy', ?, NULL)`,
    ).run('2026-09-26T00:00:00.000Z');

    const claimed = await svc.list('user-a');
    expect(claimed.map((item) => item.conceptId)).toEqual(['legacy']);
    expect(await svc.list('user-b')).toEqual([]);
    expect(svc.has('user-b', 'legacy')).toBe(false);
  });
});
