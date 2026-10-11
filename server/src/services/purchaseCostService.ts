import {
  convertToIls,
  moneyFromMinor,
  type Money,
  type TruePurchaseCost,
} from '@ps-price-compare/shared';
import { MinSpendFundingStrategy, type CardOption } from './giftCardOptimizer.js';

export type { TruePurchaseCost };

/**
 * Direct FX vs what you actually spend to fund the purchase.
 * Israel (ILS) is paid from the store/wallet with no gift cards.
 * Other regions use in-stock gift cards after native wallet credit.
 */
export class PurchaseCostService {
  private readonly optimizer = new MinSpendFundingStrategy();

  quote(input: {
    nativePrice: Money;
    rates: Record<string, number>;
    walletMinor: number;
    cards: CardOption[];
    giftCardsAvailable: boolean;
  }): TruePurchaseCost {
    const native = input.nativePrice;
    const wallet = moneyFromMinor(Math.max(0, input.walletMinor), native.currency);
    const directIls =
      native.currency === 'ILS' ? native : convertToIls(native, input.rates);
    const unknownStockExcluded = input.cards.filter((c) => c.stockStatus === 'unknown').length;

    if (!input.giftCardsAvailable || native.currency === 'ILS') {
      const due = Math.max(0, native.amountMinor - wallet.amountMinor);
      const remaining = Math.max(0, wallet.amountMinor - native.amountMinor);
      return {
        directIls,
        wallet,
        additionalRequired: moneyFromMinor(due, native.currency),
        funding: null,
        actualSpendIls: native.currency === 'ILS' ? moneyFromMinor(due, 'ILS') : directIls,
        remainingCredit: moneyFromMinor(remaining, native.currency),
        trueCostIls: native.currency === 'ILS' ? moneyFromMinor(due, 'ILS') : directIls,
        confidence: directIls ? 'complete' : 'unavailable',
        note:
          native.currency === 'ILS'
            ? 'Israel price is paid in ₪. Gift cards are not applied.'
            : 'Gift-card funding is not available for this region. True cost is the direct conversion.',
      };
    }

    const funding = this.optimizer.plan(native, input.cards, wallet.amountMinor);
    const additionalRequired = moneyFromMinor(
      Math.max(0, native.amountMinor - wallet.amountMinor),
      native.currency,
    );

    if (wallet.amountMinor >= native.amountMinor) {
      return {
        directIls,
        wallet,
        additionalRequired: moneyFromMinor(0, native.currency),
        funding,
        actualSpendIls: moneyFromMinor(0, 'ILS'),
        remainingCredit: funding?.creditRemaining ?? moneyFromMinor(wallet.amountMinor - native.amountMinor, native.currency),
        trueCostIls: moneyFromMinor(0, 'ILS'),
        confidence: 'complete',
        note: 'Existing wallet credit covers this price.',
      };
    }

    if (!funding) {
      const unknownOnly = unknownStockExcluded > 0;
      return {
        directIls,
        wallet,
        additionalRequired,
        funding: null,
        actualSpendIls: null,
        remainingCredit: null,
        trueCostIls: null,
        confidence: unknownOnly ? 'partial' : 'unavailable',
        note: unknownOnly
          ? 'In-stock gift cards cannot cover this price. Unknown-stock listings were not used.'
          : 'No in-stock gift cards can fund this price.',
      };
    }

    const note =
      unknownStockExcluded > 0
        ? `${unknownStockExcluded} unknown-stock denomination${unknownStockExcluded === 1 ? '' : 's'} excluded.`
        : null;

    return {
      directIls,
      wallet,
      additionalRequired,
      funding,
      actualSpendIls: funding.actualSpendIls,
      remainingCredit: funding.creditRemaining,
      trueCostIls: funding.actualSpendIls,
      confidence: directIls ? 'complete' : 'partial',
      note: directIls ? note : 'Exchange rate missing — ILS gift-card spend is shown, direct conversion is not.',
    };
  }
}
