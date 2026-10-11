import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moneyFromMinor, type RegionComparison } from '@ps-price-compare/shared';
import { applyIsraelComparison } from '../src/services/priceComparison.js';
import { setPref } from '../src/db/repositories/catalog.js';

function openTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const migDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
  for (const file of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migDir, file), 'utf8'));
  }
  return db;
}

function region(partial: Partial<RegionComparison> & Pick<RegionComparison, 'region'>): RegionComparison {
  return {
    available: true,
    product: null,
    matchConfidence: 'exact',
    matchReason: '',
    nativePrice: null,
    originalNativePrice: null,
    discountPercent: null,
    isDiscounted: false,
    directIls: null,
    giftCardEstimateIls: null,
    fundingStrategy: null,
    truePurchaseCost: null,
    savingsVsIsrael: null,
    worthSwitching: null,
    coverUrl: null,
    title: null,
    freshness: {
      status: 'fresh',
      lastSuccessAt: null,
      lastAttemptAt: null,
      label: '',
      ageMs: 0,
    },
    ...partial,
  };
}

describe('savings vs Israel', () => {
  it('classifies a small true-cost saving without hiding the numbers', () => {
    const db = openTestDb();
    setPref(db as never, 'minSavingsIlsMinor', 3000);
    setPref(db as never, 'minSavingsPct', 10);
    const regions = [
      region({
        region: 'IL',
        directIls: moneyFromMinor(29900, 'ILS'),
        truePurchaseCost: {
          directIls: moneyFromMinor(29900, 'ILS'),
          wallet: moneyFromMinor(0, 'ILS'),
          additionalRequired: moneyFromMinor(29900, 'ILS'),
          funding: null,
          actualSpendIls: moneyFromMinor(29900, 'ILS'),
          remainingCredit: moneyFromMinor(0, 'ILS'),
          trueCostIls: moneyFromMinor(29900, 'ILS'),
          confidence: 'complete',
          note: null,
        },
      }),
      region({
        region: 'JP',
        directIls: moneyFromMinor(18700, 'ILS'),
        truePurchaseCost: {
          directIls: moneyFromMinor(18700, 'ILS'),
          wallet: moneyFromMinor(0, 'JPY'),
          additionalRequired: moneyFromMinor(8000, 'JPY'),
          funding: null,
          actualSpendIls: moneyFromMinor(28700, 'ILS'),
          remainingCredit: moneyFromMinor(0, 'JPY'),
          trueCostIls: moneyFromMinor(28700, 'ILS'),
          confidence: 'complete',
          note: null,
        },
      }),
    ];
    applyIsraelComparison(regions, db as never);
    const jp = regions[1]!;
    expect(jp.savingsVsIsrael?.trueSavingsIls?.amountMinor).toBe(1200);
    expect(jp.savingsVsIsrael?.directSavingsIls?.amountMinor).toBe(11200);
    expect(jp.worthSwitching?.label).toBe('small');
    expect(jp.worthSwitching?.detail).toContain('Only');
    expect(jp.worthSwitching?.detail).toContain('₪12.00');
  });
});
