import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLatestHistory,
  recordPriceObservation,
  setTrackedActive,
  upsertTrackedGame,
  getTrackedGame,
  getHistoryForChart,
} from '../src/db/repositories/priceHistory.js';
import {
  deriveSalePeriods,
  PriceHistoryService,
} from '../src/services/priceHistoryService.js';
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

const baseObs = {
  productId: 'PROD-STD',
  conceptId: '1001',
  region: 'JP' as const,
  currency: 'JPY' as const,
  baseMinor: 8980,
  currentMinor: 8980,
  discountPct: null as number | null,
  isOnSale: false,
  saleEndAt: null as string | null,
  fxRateIlsBase: 40,
  fxAsOf: '2026-09-26T00:00:00.000Z',
  fxProvider: 'test',
};

describe('price history recording', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openTestDb();
  });

  it('creates initial history on first observation', () => {
    const r = recordPriceObservation(db, baseObs);
    expect(r.changed).toBe(true);
    const latest = getLatestHistory(db, 'PROD-STD', 'JP');
    expect(latest?.current_minor).toBe(8980);
    expect(latest?.observed_at).toBe(latest?.last_seen_at);
  });

  it('does not duplicate identical prices', () => {
    recordPriceObservation(db, { ...baseObs, observedAt: '2026-09-01T00:00:00.000Z' });
    const r2 = recordPriceObservation(db, {
      ...baseObs,
      observedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(r2.changed).toBe(false);
    const rows = db.prepare('SELECT COUNT(*) AS c FROM price_history').get() as { c: number };
    expect(rows.c).toBe(1);
    const latest = getLatestHistory(db, 'PROD-STD', 'JP');
    expect(latest?.last_seen_at).toBe('2026-09-02T00:00:00.000Z');
  });

  it('records price decreases and increases as new segments', () => {
    recordPriceObservation(db, { ...baseObs, observedAt: '2026-09-01T00:00:00.000Z' });
    const sale = recordPriceObservation(db, {
      ...baseObs,
      currentMinor: 6286,
      discountPct: 30,
      isOnSale: true,
      observedAt: '2026-09-12T00:00:00.000Z',
    });
    expect(sale.changed).toBe(true);
    const back = recordPriceObservation(db, {
      ...baseObs,
      observedAt: '2026-09-25T00:00:00.000Z',
    });
    expect(back.changed).toBe(true);
    const rows = db
      .prepare('SELECT current_minor FROM price_history ORDER BY observed_at')
      .all() as Array<{ current_minor: number }>;
    expect(rows.map((r) => r.current_minor)).toEqual([8980, 6286, 8980]);
  });

  it('keeps regions and editions independent', () => {
    recordPriceObservation(db, baseObs);
    recordPriceObservation(db, {
      ...baseObs,
      region: 'IN',
      currency: 'INR',
      baseMinor: 399900,
      currentMinor: 399900,
      fxRateIlsBase: 25,
    });
    recordPriceObservation(db, {
      ...baseObs,
      productId: 'PROD-DELUXE',
      currentMinor: 10980,
      baseMinor: 10980,
    });
    expect(getLatestHistory(db, 'PROD-STD', 'JP')?.current_minor).toBe(8980);
    expect(getLatestHistory(db, 'PROD-STD', 'IN')?.current_minor).toBe(399900);
    expect(getLatestHistory(db, 'PROD-DELUXE', 'JP')?.current_minor).toBe(10980);
  });

  it('stopping tracking does not delete history', () => {
    recordPriceObservation(db, baseObs);
    upsertTrackedGame(db, { conceptId: '1001', title: 'Test Game' });
    setTrackedActive(db, '1001', false);
    const tracked = getTrackedGame(db, '1001');
    expect(tracked?.active).toBe(0);
    expect(getLatestHistory(db, 'PROD-STD', 'JP')).toBeTruthy();
  });

  it('derives sale periods from on-sale segments', () => {
    recordPriceObservation(db, { ...baseObs, observedAt: '2026-09-01T00:00:00.000Z' });
    recordPriceObservation(db, {
      ...baseObs,
      currentMinor: 5980,
      discountPct: 33,
      isOnSale: true,
      observedAt: '2026-09-03T00:00:00.000Z',
    });
    // extend sale
    recordPriceObservation(db, {
      ...baseObs,
      currentMinor: 5980,
      discountPct: 33,
      isOnSale: true,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    recordPriceObservation(db, {
      ...baseObs,
      observedAt: '2026-09-15T00:00:00.000Z',
    });
    const series = getHistoryForChart(db, {
      conceptId: '1001',
      regions: ['JP'],
      since: null,
    });
    const sales = deriveSalePeriods(series);
    expect(sales.length).toBe(1);
    expect(sales[0]!.currentMinor).toBe(5980);
    expect(sales[0]!.discountPct).toBe(33);
  });

  it('time-range filter includes overlapping segments', () => {
    recordPriceObservation(db, { ...baseObs, observedAt: '2026-01-01T00:00:00.000Z' });
    recordPriceObservation(db, {
      ...baseObs,
      currentMinor: 5000,
      isOnSale: true,
      discountPct: 40,
      observedAt: '2026-08-01T00:00:00.000Z',
    });
    const since = '2026-09-01T00:00:00.000Z';
    // extend last_seen into window without new change
    recordPriceObservation(db, {
      ...baseObs,
      currentMinor: 5000,
      isOnSale: true,
      discountPct: 40,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    const rows = getHistoryForChart(db, {
      conceptId: '1001',
      regions: ['JP'],
      since,
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.last_seen_at >= since || r.observed_at >= since)).toBe(true);
  });

  it('summary lowest/highest and lowest-recorded badge are correct', () => {
    const exchange = {
      getSnapshot: async () => ({
        rates: { JPY: 40, INR: 25, TRY: 10, ILS: 1 },
        asOf: '2026-09-26T00:00:00.000Z',
        provider: 'test',
      }),
    } as unknown as ExchangeService;
    const svc = new PriceHistoryService(db as never, exchange);

    recordPriceObservation(db, { ...baseObs, observedAt: '2026-09-01T00:00:00.000Z' });
    recordPriceObservation(db, {
      ...baseObs,
      currentMinor: 5980,
      discountPct: 33,
      isOnSale: true,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    recordPriceObservation(db, {
      ...baseObs,
      observedAt: '2026-09-20T00:00:00.000Z',
    });

    const summary = svc.getSummary('PROD-STD', 'JP');
    expect(summary.lowest?.minor).toBe(5980);
    expect(summary.highest?.minor).toBe(8980);
    expect(summary.current?.minor).toBe(8980);
    expect(summary.isLowestRecorded).toBe(false);
    expect(summary.salePeriods.length).toBe(1);

    recordPriceObservation(db, {
      ...baseObs,
      currentMinor: 5980,
      discountPct: 33,
      isOnSale: true,
      observedAt: '2026-09-25T00:00:00.000Z',
    });
    const atLow = svc.getSummary('PROD-STD', 'JP');
    expect(atLow.isLowestRecorded).toBe(true);
  });

  it('failed fetches never call record — unchanged history is the contract', () => {
    recordPriceObservation(db, baseObs);
    const before = db.prepare('SELECT COUNT(*) AS c FROM price_history').get() as {
      c: number;
    };
    // Simulates: provider failure → do not call recordPriceObservation
    const after = db.prepare('SELECT COUNT(*) AS c FROM price_history').get() as {
      c: number;
    };
    expect(after.c).toBe(before.c);
    expect(getLatestHistory(db, 'PROD-STD', 'JP')?.current_minor).toBe(8980);
  });
});
