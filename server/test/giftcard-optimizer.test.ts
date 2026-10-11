import { describe, expect, it } from 'vitest';
import { moneyFromMinor } from '@ps-price-compare/shared';
import { MinSpendFundingStrategy, type CardOption } from '../src/services/giftCardOptimizer.js';

const yen = (n: number) => moneyFromMinor(n, 'JPY');
const ils = (n: number) => moneyFromMinor(n, 'ILS');

function card(denom: number, priceAgorot: number, stock: CardOption['stockStatus'] = 'in_stock'): CardOption {
  return {
    listingId: `c-${denom}-${stock}`,
    denomination: yen(denom),
    priceIls: ils(priceAgorot),
    stockStatus: stock,
  };
}

describe('gift card optimizer', () => {
  const strategy = new MinSpendFundingStrategy();

  it('buys the cheapest combination that covers the shortfall after wallet credit', () => {
    const plan = strategy.plan(yen(8500), [card(1000, 3000), card(3000, 8000), card(5000, 12000), card(10000, 30000)], 1200);
    expect(plan).toBeTruthy();
    const denoms = plan!.cards.map((c) => c.denomination.amountMinor).sort((a, b) => a - b);
    expect(denoms).toEqual([3000, 5000]);
    expect(plan!.additionalRequired.amountMinor).toBe(7300);
    expect(plan!.walletApplied.amountMinor).toBe(1200);
    expect(plan!.creditPurchased.amountMinor).toBe(8000);
    expect(plan!.creditRemaining.amountMinor).toBe(700);
    expect(plan!.actualSpendIls.amountMinor).toBe(20000);
  });

  it('spends nothing when the wallet already covers the game', () => {
    const plan = strategy.plan(yen(1000), [card(5000, 12000)], 1500);
    expect(plan!.cards).toHaveLength(0);
    expect(plan!.actualSpendIls.amountMinor).toBe(0);
    expect(plan!.creditRemaining.amountMinor).toBe(500);
  });

  it('never uses out-of-stock cards and reports unknown stock', () => {
    const plan = strategy.plan(
      yen(3000),
      [card(3000, 9000, 'out_of_stock'), card(5000, 20000, 'unknown'), card(5000, 14000, 'in_stock')],
      0,
    );
    expect(plan!.cards.map((c) => c.listingId)).toEqual(['c-5000-in_stock']);
    expect(plan!.unknownStockExcluded).toBe(1);
  });

  it('prefers a larger denomination when it costs less in ILS', () => {
    const plan = strategy.plan(yen(4000), [card(3000, 9000), card(5000, 8000)], 0);
    expect(plan!.cards.map((c) => c.denomination.amountMinor)).toEqual([5000]);
    expect(plan!.actualSpendIls.amountMinor).toBe(8000);
  });
});
