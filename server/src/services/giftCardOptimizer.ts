import type { FundingStrategyResult, Money } from '@ps-price-compare/shared';
import { moneyFromMinor, toMajor } from '@ps-price-compare/shared';

export interface CardOption {
  listingId: string;
  denomination: Money;
  priceIls: Money;
}

export interface FundingStrategy {
  plan(
    gamePrice: Money,
    cards: CardOption[],
  ): FundingStrategyResult | null;
}

/**
 * Bounded coin-change DP: minimize ILS spend subject to credit >= game price.
 * Cap at maxCards cards. Tie-break: least leftover, then fewest cards.
 */
export class MinSpendFundingStrategy implements FundingStrategy {
  constructor(private readonly maxCards = 6) {}

  plan(gamePrice: Money, cards: CardOption[]): FundingStrategyResult | null {
    if (cards.length === 0) return null;
    const need = gamePrice.amountMinor;
    if (need <= 0) return null;

    // Deduplicate by denomination keeping cheapest ILS price
    const byDenom = new Map<number, CardOption>();
    for (const c of cards) {
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

    let best: State | null = null;

    function consider(state: State) {
      if (state.credit < need) return;
      if (
        !best ||
        state.spend < best.spend ||
        (state.spend === best.spend && state.credit - need < best.credit - need) ||
        (state.spend === best.spend &&
          state.credit === best.credit &&
          state.cards.length < best.cards.length)
      ) {
        best = { ...state, cards: [...state.cards] };
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
        if (best && next.spend > best.spend && next.credit >= need) continue;
        // Prune runaway credit (more than 3x need with enough cards)
        if (next.credit > need * 3 && next.cards.length > 1) continue;
        dfs(i, next); // allow repeats of same denom
      }
    }

    const thisMax = this.maxCards;
    dfs(0, { spend: 0, credit: 0, cards: [] });

    const winner = best;
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
    };
  }
}

export function formatStrategySummary(s: FundingStrategyResult): string {
  const parts = s.cards.map(
    (c) => `${toMajor(c.denomination)} ${c.denomination.currency}`,
  );
  return parts.join(' + ');
}
