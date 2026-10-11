import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PriceHistoryService } from '../src/services/priceHistoryService.js';
import { AlertService } from '../src/services/alertService.js';
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

const exchange = {
  getSnapshot: async () => ({
    rates: { JPY: 40 },
    asOf: '2026-09-26T00:00:00.000Z',
    provider: 'test',
  }),
} as unknown as ExchangeService;

describe('price alerts', () => {
  let db: DatabaseSync;
  let history: PriceHistoryService;
  let alerts: AlertService;

  beforeEach(() => {
    db = openTestDb();
    history = new PriceHistoryService(db as never, exchange);
    alerts = new AlertService(db as never);
    history.setOnPriceChanged((event) => alerts.evaluate(event));
  });

  async function observe(currentMinor: number, extra?: { discountPct?: number | null; baseMinor?: number }) {
    const baseMinor = extra?.baseMinor ?? 8000;
    return history.recordSuccessfulPrice({
      productId: 'P1',
      conceptId: '1001',
      region: 'JP',
      currency: 'JPY',
      baseMinor,
      discountedMinor: currentMinor,
      discountPct: extra?.discountPct ?? (currentMinor < baseMinor ? 50 : null),
      saleEndAt: null,
    });
  }

  it('does not alert on the first price or an unchanged check', async () => {
    alerts.saveRules('1001', {
      belowIlsMinor: 10000,
      discountPct: 40,
      lowestRecorded: true,
      saleStarted: true,
    });
    await observe(8000, { discountPct: null, baseMinor: 8000 });
    const again = await observe(8000, { discountPct: null, baseMinor: 8000 });
    expect(again.changed).toBe(false);
    expect(alerts.list()).toHaveLength(0);
  });

  it('fires once when price crosses below an ILS threshold', async () => {
    alerts.saveRules('1001', {
      belowIlsMinor: 10000,
      discountPct: null,
      lowestRecorded: false,
      saleStarted: false,
    });
    // ¥8000 / 40 = ₪200
    await observe(8000, { discountPct: null, baseMinor: 8000 });
    // ¥2000 / 40 = ₪50
    await observe(2000, { discountPct: 75, baseMinor: 8000 });
    expect(alerts.list()).toHaveLength(1);
    expect(alerts.list()[0]!.trigger_kind).toBe('below_ils');
    // still below — no second alert
    await observe(1000, { discountPct: 87, baseMinor: 8000 });
    expect(alerts.list().filter((e) => e.trigger_kind === 'below_ils')).toHaveLength(1);
  });

  it('fires when a sale starts and not while the sale continues', async () => {
    alerts.saveRules('1001', {
      belowIlsMinor: null,
      discountPct: null,
      lowestRecorded: false,
      saleStarted: true,
    });
    await observe(8000, { discountPct: null, baseMinor: 8000 });
    await observe(5000, { discountPct: 37, baseMinor: 8000 });
    expect(alerts.list().map((e) => e.trigger_kind)).toEqual(['sale_started']);
    await observe(4500, { discountPct: 44, baseMinor: 8000 });
    expect(alerts.list().filter((e) => e.trigger_kind === 'sale_started')).toHaveLength(1);
  });

  it('fires on a new recorded low, not the opening price', async () => {
    alerts.saveRules('1001', {
      belowIlsMinor: null,
      discountPct: null,
      lowestRecorded: true,
      saleStarted: false,
    });
    await observe(8000, { discountPct: null, baseMinor: 8000 });
    expect(alerts.list()).toHaveLength(0);
    await observe(5000, { discountPct: 37, baseMinor: 8000 });
    expect(alerts.list().some((e) => e.trigger_kind === 'lowest_recorded')).toBe(true);
    await observe(7000, { discountPct: 12, baseMinor: 8000 });
    const lows = alerts.list().filter((e) => e.trigger_kind === 'lowest_recorded');
    expect(lows).toHaveLength(1);
  });

  it('does not duplicate an event for the same transition', async () => {
    alerts.saveRules('1001', {
      belowIlsMinor: 10000,
      discountPct: null,
      lowestRecorded: false,
      saleStarted: false,
    });
    await observe(8000, { discountPct: null, baseMinor: 8000 });
    await observe(2000, { discountPct: 75, baseMinor: 8000 });
    const rows = db
      .prepare('SELECT * FROM price_history ORDER BY id ASC')
      .all() as unknown[];
    alerts.evaluate({ previous: rows[0] as never, current: rows[1] as never });
    expect(alerts.unreadCount()).toBe(1);
  });
});
