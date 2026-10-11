import { describe, expect, it } from 'vitest';
import type { SearchResultItem } from '@ps-price-compare/shared';
import { cleanSearchResults } from '../src/services/gameSearch.js';

function hit(partial: Partial<SearchResultItem> & Pick<SearchResultItem, 'productId' | 'name'>): SearchResultItem {
  return {
    conceptId: null,
    platforms: ['PS5'],
    classification: 'FULL_GAME',
    coverUrl: null,
    region: 'JP',
    basePriceFormatted: null,
    discountedPriceFormatted: null,
    discountText: null,
    ...partial,
  };
}

describe('cleanSearchResults', () => {
  it('drops add-ons and keeps full games', () => {
    const out = cleanSearchResults([
      hit({ productId: '1', name: 'Cool Game', classification: 'FULL_GAME' }),
      hit({ productId: '2', name: 'Cool Game Costume', classification: 'COSTUME' }),
      hit({ productId: '3', name: 'Cool Game Demo', classification: 'FULL_GAME' }),
    ]);
    expect(out.map((r) => r.productId)).toEqual(['1']);
  });

  it('dedupes by concept and prefers standard edition', () => {
    const out = cleanSearchResults([
      hit({
        productId: 'a',
        conceptId: '99',
        name: 'Cool Game Digital Deluxe',
        classification: 'PREMIUM_EDITION',
      }),
      hit({
        productId: 'b',
        conceptId: '99',
        name: 'Cool Game',
        classification: 'FULL_GAME',
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].productId).toBe('b');
  });
});
