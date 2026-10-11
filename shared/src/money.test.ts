import { describe, expect, it } from 'vitest';
import {
  convertToIls,
  effectiveRatePer1000,
  formatMoney,
  markupPercent,
  moneyFromMajor,
} from './money.js';
import { extractSkuSuffix, normalizeTitle, titleSimilarity } from './normalize.js';
import { computeFreshness, stockLabel } from './freshness.js';

describe('money', () => {
  it('converts foreign to ILS using ILS-base rates', () => {
    // 1 ILS = 50 JPY => ¥5000 = ₪100
    const rates = { JPY: 50, INR: 30, TRY: 10 };
    const ils = convertToIls(moneyFromMajor(5000, 'JPY'), rates);
    expect(ils?.amountMinor).toBe(10000); // 100.00 ILS in agorot
  });

  it('computes markup and effective rate', () => {
    const theoretical = moneyFromMajor(100, 'ILS');
    const actual = moneyFromMajor(120, 'ILS');
    expect(markupPercent(theoretical, actual)).toBeCloseTo(20);
    expect(
      effectiveRatePer1000(moneyFromMajor(10000, 'JPY'), moneyFromMajor(200, 'ILS')),
    ).toBeCloseTo(20);
  });

  it('formats currencies', () => {
    expect(formatMoney(moneyFromMajor(8980, 'JPY'))).toContain('8,980');
    expect(formatMoney(moneyFromMajor(12.5, 'ILS'))).toContain('12.50');
  });
});

describe('normalize', () => {
  it('strips edition keywords', () => {
    expect(normalizeTitle("Marvel's Spider-Man 2 Digital Deluxe Edition")).toBe(
      'marvels spider man 2',
    );
  });

  it('extracts sku suffix', () => {
    expect(extractSkuSuffix('JP9000-PPSA08339_00-MARVELSPIDERMAN2')).toBe(
      'MARVELSPIDERMAN2',
    );
  });

  it('scores similar titles', () => {
    expect(
      titleSimilarity('Spider-Man 2', "Marvel's Spider-Man 2"),
    ).toBeGreaterThan(0.4);
  });
});

describe('freshness', () => {
  it('marks fresh and stale correctly', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const fresh = computeFreshness(
      '2026-09-23T11:50:00Z',
      '2026-09-23T11:50:00Z',
      6 * 3600_000,
      { now },
    );
    expect(fresh.status).toBe('fresh');

    const stale = computeFreshness(
      '2026-09-20T12:00:00Z',
      '2026-09-23T11:00:00Z',
      6 * 3600_000,
      { now },
    );
    expect(stale.status).toBe('stale');
  });

  it('does not claim in-stock when stale', () => {
    const freshness = computeFreshness(
      '2026-09-20T12:00:00Z',
      '2026-09-23T11:00:00Z',
      6 * 3600_000,
      { now: new Date('2026-09-23T12:00:00Z') },
    );
    expect(stockLabel('in_stock', freshness)).toMatch(/Previously in stock/);
  });
});
