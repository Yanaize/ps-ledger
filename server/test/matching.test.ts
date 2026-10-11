import { describe, expect, it } from 'vitest';
import { matchEdition, pickPrimaryEdition } from '../src/services/matching.js';
import type { ParsedEdition } from '../src/providers/playstation/storeWeb.js';
import { MinSpendFundingStrategy } from '../src/services/giftCardOptimizer.js';
import { moneyFromMajor } from '@ps-price-compare/shared';

function ed(partial: Partial<ParsedEdition> & Pick<ParsedEdition, 'productId'>): ParsedEdition {
  return {
    conceptId: '10002456',
    region: 'IN',
    name: "Marvel's Spider-Man 2",
    platforms: ['PS5'],
    editionType: 'STANDARD',
    editionName: 'Standard',
    classification: 'FULL_GAME',
    skuSuffix: 'MARVELSPIDERMAN2',
    coverUrl: null,
    releaseDate: null,
    price: {
      currency: 'INR',
      baseMinor: 499900,
      discountedMinor: 249900,
      discountPercent: 50,
      isFree: false,
      saleEndAt: null,
      inPlusCatalog: false,
      formattedBase: null,
      formattedDiscounted: null,
    },
    ...partial,
  };
}

describe('matching', () => {
  it('matches by identical product id', () => {
    const base = ed({ productId: 'EP9000-PPSA08338_00-MARVELSPIDERMAN2', region: 'IN' });
    const cand = ed({ productId: 'EP9000-PPSA08338_00-MARVELSPIDERMAN2', region: 'TR' });
    const m = matchEdition(base, [cand]);
    expect(m.confidence).toBe('exact');
  });

  it('matches JP by sku suffix', () => {
    const base = ed({
      productId: 'EP9000-PPSA08338_00-MARVELSPIDERMAN2',
      skuSuffix: 'MARVELSPIDERMAN2',
      region: 'IN',
    });
    const jp = ed({
      productId: 'JP9000-PPSA08339_00-MARVELSPIDERMAN2',
      skuSuffix: 'MARVELSPIDERMAN2',
      region: 'JP',
      name: "Marvel's Spider-Man 2",
    });
    const deluxe = ed({
      productId: 'JP9000-PPSA08339_00-MSM2DDE000000000',
      skuSuffix: 'MSM2DDE000000000',
      region: 'JP',
      name: 'Deluxe',
      editionType: 'PREMIUM',
      classification: 'GAME_BUNDLE',
    });
    const m = matchEdition(base, [deluxe, jp]);
    expect(m.confidence).toBe('high');
    expect(m.edition?.productId).toBe(jp.productId);
  });

  it('does not mix deluxe with standard via high confidence', () => {
    const base = ed({
      productId: 'EP9000-PPSA08338_00-MARVELSPIDERMAN2',
      skuSuffix: 'MARVELSPIDERMAN2',
      editionType: 'STANDARD',
    });
    const deluxe = ed({
      productId: 'EP9000-PPSA08338_00-MSM2DDE000000000',
      skuSuffix: 'MSM2DDE000000000',
      editionType: 'PREMIUM',
      classification: 'GAME_BUNDLE',
      name: 'Digital Deluxe Edition',
    });
    const m = matchEdition(base, [deluxe]);
    expect(m.edition?.productId).not.toBe(base.productId);
    // May be low/none — must not be exact/high with wrong suffix
    expect(m.confidence === 'exact' || m.confidence === 'high').toBe(false);
  });

  it('picks standard PS5 primary edition', () => {
    const editions = [
      ed({
        productId: 'A-DELUXE',
        name: 'Deluxe',
        editionType: 'PREMIUM',
        classification: 'GAME_BUNDLE',
        skuSuffix: 'DDE',
      }),
      ed({
        productId: 'A-STD',
        name: 'Standard',
        editionType: 'STANDARD',
        classification: 'FULL_GAME',
        platforms: ['PS5'],
        skuSuffix: 'STD',
      }),
    ];
    expect(pickPrimaryEdition(editions)?.productId).toBe('A-STD');
  });
});

describe('gift card optimizer', () => {
  it('buys enough credit with minimal spend', () => {
    const strategy = new MinSpendFundingStrategy();
    const plan = strategy.plan(moneyFromMajor(8500, 'JPY'), [
      {
        listingId: '1k',
        denomination: moneyFromMajor(1000, 'JPY'),
        priceIls: moneyFromMajor(30, 'ILS'),
      },
      {
        listingId: '5k',
        denomination: moneyFromMajor(5000, 'JPY'),
        priceIls: moneyFromMajor(140, 'ILS'),
      },
      {
        listingId: '10k',
        denomination: moneyFromMajor(10000, 'JPY'),
        priceIls: moneyFromMajor(270, 'ILS'),
      },
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.creditPurchased.amountMinor).toBeGreaterThanOrEqual(8500);
    // Optimal: five ¥1,000 + one ¥5,000? or mix — must beat single ¥10,000 (₪270)
    // Best found: ¥5,000 + 4×¥1,000 = ¥9,000 for ₪260
    expect(plan!.actualSpendIls.amountMinor).toBeLessThanOrEqual(27000);
    expect(toMajor(plan!.actualSpendIls)).toBeLessThanOrEqual(270);
  });

  it('ignores out-of-currency cards', () => {
    const strategy = new MinSpendFundingStrategy();
    const plan = strategy.plan(moneyFromMajor(1000, 'JPY'), [
      {
        listingId: 'inr',
        denomination: moneyFromMajor(1000, 'INR'),
        priceIls: moneyFromMajor(50, 'ILS'),
      },
    ]);
    expect(plan).toBeNull();
  });
});

function toMajor(m: { amountMinor: number; currency: string }) {
  return m.currency === 'JPY' ? m.amountMinor : m.amountMinor / 100;
}
