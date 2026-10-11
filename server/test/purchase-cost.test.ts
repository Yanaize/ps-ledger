import { describe, expect, it } from 'vitest';
import { moneyFromMinor } from '@ps-price-compare/shared';
import { PurchaseCostService } from '../src/services/purchaseCostService.js';
import type { CardOption } from '../src/services/giftCardOptimizer.js';

const card = (denom: number, agorot: number): CardOption => ({
  listingId: String(denom),
  denomination: moneyFromMinor(denom, 'JPY'),
  priceIls: moneyFromMinor(agorot, 'ILS'),
  stockStatus: 'in_stock',
});

describe('true purchase cost', () => {
  const svc = new PurchaseCostService();

  it('subtracts wallet credit and charges only the gift cards still required', () => {
    const cost = svc.quote({
      nativePrice: moneyFromMinor(8500, 'JPY'),
      rates: { JPY: 40 },
      walletMinor: 1200,
      cards: [card(5000, 12000), card(3000, 8000), card(10000, 40000)],
      giftCardsAvailable: true,
    });
    expect(cost.directIls?.amountMinor).toBe(21250);
    expect(cost.additionalRequired.amountMinor).toBe(7300);
    expect(cost.trueCostIls?.amountMinor).toBe(20000);
    expect(cost.remainingCredit?.amountMinor).toBe(700);
    expect(cost.confidence).toBe('complete');
  });

  it('does not invent a cost when only unknown stock exists', () => {
    const cost = svc.quote({
      nativePrice: moneyFromMinor(5000, 'JPY'),
      rates: { JPY: 40 },
      walletMinor: 0,
      cards: [{ ...card(5000, 10000), stockStatus: 'unknown' }],
      giftCardsAvailable: true,
    });
    expect(cost.trueCostIls).toBeNull();
    expect(cost.confidence).toBe('partial');
  });

  it('treats an ILS store price as the amount still due after the Israel wallet', () => {
    const cost = svc.quote({
      nativePrice: moneyFromMinor(29900, 'ILS'),
      rates: {},
      walletMinor: 4000,
      cards: [],
      giftCardsAvailable: false,
    });
    expect(cost.trueCostIls?.amountMinor).toBe(25900);
    expect(cost.remainingCredit?.amountMinor).toBe(0);
    expect(cost.confidence).toBe('complete');
  });
});
