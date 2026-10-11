import type { FundingStrategyResult, Money } from '@ps-price-compare/shared';
import { moneyFromMinor, toMajor } from '@ps-price-compare/shared';

export interface CardOption {
  listingId: string;
  denomination: Money;
  priceIls: Money;
  /** Out of stock is never used. Unknown is excluded and reported. */
  stockStatus?: 'in_stock' | 'unknown' | 'out_of_stock';
}

export interface FundingStrategy {
  plan(
    gamePrice: Money,
    cards: CardOption[],
    walletMinor?: number,
  ): FundingStrategyResult | null;
}

/**
 * Bounded coin-change DP: minimize ILS spend subject to credit >= game price.
 * Cap at maxCards cards. Tie-break: least leftover, then fewest cards.
 */
export class MinSpendFundingStrategy implements FundingStrategy {
  constructor(private readonly maxCards = 6) {}

  plan(gamePrice: Money, cards: CardOption[], walletMinor = 0): FundingStrategyResult | null {
    const priceMinor = gamePrice.amountMinor;
    if (priceMinor <= 0) return null;
    const wallet = Math.max(0, Math.round(walletMinor));
    const walletApplied = moneyFromMinor(Math.min(wallet, priceMinor), gamePrice.currency);
    const additional = priceMinor - walletApplied.amountMinor;

    const unknownStockExcluded = cards.filter((c) => c.stockStatus === 'unknown').length;
    const usable = cards.filter((c) => c.stockStatus !== 'out_of_stock' && c.stockStatus !== 'unknown');

    if (additional <= 0) {
      return {
        cards: [],
        creditPurchased: moneyFromMinor(0, gamePrice.currency),
        creditRemaining: moneyFromMinor(wallet - priceMinor, gamePrice.currency),
        actualSpendIls: moneyFromMinor(0, 'ILS'),
        effectiveGameCostIls: moneyFromMinor(0, 'ILS'),
        isEstimate: true,
        walletApplied,
        additionalRequired: moneyFromMinor(0, gamePrice.currency),
        unknownStockExcluded,
      };
    }

    if (usable.length === 0) return null;
    const need = additional;

    // Deduplicate by denomination keeping cheapest ILS price
    const byDenom = new Map<number, CardOption>();
    for (const c of usable) {
      if (c.denomination.currency !== gamePrice.currency) continue;
      const existing = byDenom.get(c.denomination.amountMinor);
      if (!existing || c.priceIls.amountMinor < existing.priceIls.amountMinor) {
        byDenom.set(c.denomination.amountMinor, c);
      }
    }
    const options = [...byDenom.values()].sort(
      (a, b) => a.denomination.amountMinor - b.denomination.amountMinor,
    );
    if (options.length === 0) return null;

    type State = {
      spend: number;
      credit: number;
      cards: number[]; // indices into options, counts via multiset of indices
    };

    const box: { best: State | null } = { best: null };

    function consider(state: State) {
      if (state.credit < need) return;
      const best = box.best;
      if (
        !best ||
        state.spend < best.spend ||
        (state.spend === best.spend && state.credit - need < best.credit - need) ||
        (state.spend === best.spend &&
          state.credit === best.credit &&
          state.cards.length < best.cards.length)
      ) {
        box.best = { ...state, cards: [...state.cards] };
      }
    }

    // DFS with pruning
    function dfs(startIdx: number, state: State) {
      consider(state);
      if (state.cards.length >= thisMax) return;
      for (let i = startIdx; i < options.length; i++) {
        const opt = options[i];
        const next: State = {
          spend: state.spend + opt.priceIls.amountMinor,
          credit: state.credit + opt.denomination.amountMinor,
          cards: [...state.cards, i],
        };
        // Prune if spend already worse than best and we already meet need
        if (box.best && next.spend > box.best.spend && next.credit >= need) continue;
        // Prune runaway credit (more than 3x need with enough cards)
        if (next.credit > need * 3 && next.cards.length > 1) continue;
        dfs(i, next); // allow repeats of same denom
      }
    }

    const thisMax = this.maxCards;
    dfs(0, { spend: 0, credit: 0, cards: [] });

    const winner = box.best;
    if (!winner || winner.cards.length === 0) return null;

    const chosen = winner.cards.map((i: number) => options[i]);
    const creditPurchased = moneyFromMinor(
      chosen.reduce((s: number, c) => s + c.denomination.amountMinor, 0),
      gamePrice.currency,
    );
    const creditRemaining = moneyFromMinor(
      creditPurchased.amountMinor - need,
      gamePrice.currency,
    );
    const actualSpendIls = moneyFromMinor(
      chosen.reduce((s: number, c) => s + c.priceIls.amountMinor, 0),
      'ILS',
    );
    // Proportional effective cost
    const ratio = need / creditPurchased.amountMinor;
    const effectiveGameCostIls = moneyFromMinor(
      Math.round(actualSpendIls.amountMinor * ratio),
      'ILS',
    );

    return {
      cards: chosen.map((c) => ({
        denomination: c.denomination,
        listingId: c.listingId,
        price: c.priceIls,
      })),
      creditPurchased,
      creditRemaining,
      actualSpendIls,
      effectiveGameCostIls,
      isEstimate: true,
      walletApplied,
      additionalRequired: moneyFromMinor(need, gamePrice.currency),
      unknownStockExcluded,
    };
  }
}

export function formatStrategySummary(s: FundingStrategyResult): string {
  const parts = s.cards.map(
    (c) => `${toMajor(c.denomination)} ${c.denomination.currency}`,
  );
  return parts.join(' + ');
}
