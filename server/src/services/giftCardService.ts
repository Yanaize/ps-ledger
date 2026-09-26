import {
  computeFreshness,
  convertToIls,
  effectiveRatePer1000,
  markupPercent,
  moneyFromMinor,
  type CurrencyCode,
  type GiftCardListing,
  type GiftCardRegionSummary,
  type PriceRegion,
} from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import {
  deleteNonManualProviderListings,
  listGiftCards,
  upsertGiftCardListing,
} from '../db/repositories/giftcards.js';
import { GIFT_CARD_REGIONS, REGIONS } from '../config/regions.js';
import type { RefreshConfig } from '../config/refresh.js';
import type { GiftCardProvider } from '../providers/giftcards/registry.js';
import type { ExchangeService } from './exchangeService.js';
import { logger } from '../lib/logger.js';
import { createHash } from 'node:crypto';

export class GiftCardService {
  constructor(
    private readonly db: Db,
    private readonly providers: GiftCardProvider[],
    private readonly exchange: ExchangeService,
    private readonly refreshConfig: RefreshConfig,
  ) {}

  async refreshRegion(region: PriceRegion): Promise<{ ok: boolean; count: number; errors: string[] }> {
    const errors: string[] = [];
    let count = 0;
    for (const provider of this.providers) {
      if (provider.id === 'manual') continue;
      if (!provider.supportsRegion(region)) continue;
      try {
        const listings = await provider.fetchListings(region);
        deleteNonManualProviderListings(this.db, provider.id, region);
        for (const l of listings) {
          const id = listingId(provider.id, region, l.productKey, l.sellerName);
          upsertGiftCardListing(
            this.db,
            {
              id,
              provider: provider.id,
              region,
              denomMinor: l.denomination.amountMinor,
              denomCurrency: l.denomination.currency,
              sellerName: l.sellerName,
              productKey: l.productKey,
              productUrl: l.productUrl,
              priceMinor: l.price.amountMinor,
              priceCurrency: l.price.currency,
              stockStatus: l.stockStatus,
            },
            true,
          );
          count++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.id}: ${msg}`);
        logger.warn({ provider: provider.id, region, err: msg }, 'Gift card fetch failed');
        // Do not wipe existing rows on failure
      }
    }
    return { ok: errors.length === 0, count, errors };
  }

  async refreshAll() {
    const results: Record<string, { ok: boolean; count: number; errors: string[] }> = {};
    for (const region of GIFT_CARD_REGIONS) {
      results[region] = await this.refreshRegion(region);
    }
    return results;
  }

  async list(filters?: {
    region?: PriceRegion;
    provider?: string;
    inStockOnly?: boolean;
  }): Promise<GiftCardListing[]> {
    const rates = await this.exchange.getSnapshot();
    const rows = listGiftCards(this.db, filters);
    const providerNames = new Map(
      this.providers.map((p) => [p.id, p.displayName]),
    );

    return rows.map((r) => {
      const freshness = computeFreshness(
        r.last_success_at,
        r.last_checked_at,
        this.refreshConfig.ttl.giftcards,
        { isManual: Boolean(r.is_manual) },
      );
      const denomination = moneyFromMinor(
        r.denom_minor,
        r.denom_currency as CurrencyCode,
      );
      const price = moneyFromMinor(r.price_minor, r.price_currency as CurrencyCode);
      const priceIls =
        price.currency === 'ILS'
          ? price
          : convertToIls(price, rates.rates);
      const theoreticalIls = convertToIls(denomination, rates.rates);
      const markup =
        theoreticalIls && priceIls
          ? markupPercent(theoreticalIls, priceIls)
          : null;
      const eff =
        priceIls != null ? effectiveRatePer1000(denomination, priceIls) : null;

      return {
        id: r.id,
        provider: r.provider,
        providerDisplayName:
          r.is_manual
            ? 'Manual'
            : providerNames.get(r.provider) ?? r.provider,
        region: r.region as PriceRegion,
        denomination,
        sellerName: r.seller_name,
        productKey: r.product_key,
        productUrl: r.product_url,
        price,
        stockStatus: r.stock_status as GiftCardListing['stockStatus'],
        lastCheckedAt: r.last_checked_at,
        lastSuccessAt: r.last_success_at,
        isManual: Boolean(r.is_manual),
        freshness,
        theoreticalIls,
        markupPercent: markup,
        effectiveRatePer1000: eff,
      };
    });
  }

  async summaries(): Promise<GiftCardRegionSummary[]> {
    const all = await this.list();
    const rates = await this.exchange.getSnapshot();
    return GIFT_CARD_REGIONS.map((region) => {
      const currency = REGIONS[region].currency;
      const market = rates.rates[currency];
      const marketRateIlsPer1000 = market ? (1000 / market) : null;

      const eligible = all.filter(
        (l) =>
          l.region === region &&
          l.stockStatus === 'in_stock' &&
          (l.freshness.status === 'fresh' ||
            l.freshness.status === 'cached' ||
            l.freshness.status === 'manual') &&
          l.effectiveRatePer1000 != null,
      );
      eligible.sort(
        (a, b) => (a.effectiveRatePer1000 ?? Infinity) - (b.effectiveRatePer1000 ?? Infinity),
      );
      const best = eligible[0] ?? null;
      const freshness = best?.freshness ??
        computeFreshness(null, null, this.refreshConfig.ttl.giftcards);

      return {
        region,
        currency,
        bestAvailableIlsPer1000: best?.effectiveRatePer1000 ?? null,
        bestListingId: best?.id ?? null,
        marketRateIlsPer1000,
        freshness,
      };
    });
  }

  addManual(input: {
    region: PriceRegion;
    denomMajor: number;
    sellerName: string;
    productUrl: string;
    priceMajor: number;
    priceCurrency: CurrencyCode;
    stockStatus: 'in_stock' | 'out_of_stock' | 'unknown';
  }) {
    const currency = REGIONS[input.region].currency;
    const denom = moneyFromMinor(
      currency === 'JPY'
        ? Math.round(input.denomMajor)
        : Math.round(input.denomMajor * 100),
      currency,
    );
    const price = moneyFromMinor(
      input.priceCurrency === 'JPY'
        ? Math.round(input.priceMajor)
        : Math.round(input.priceMajor * 100),
      input.priceCurrency,
    );
    const productKey = input.productUrl;
    const id = listingId(
      'manual',
      input.region,
      productKey,
      input.sellerName + String(denom.amountMinor),
    );
    upsertGiftCardListing(
      this.db,
      {
        id,
        provider: 'manual',
        region: input.region,
        denomMinor: denom.amountMinor,
        denomCurrency: denom.currency,
        sellerName: input.sellerName,
        productKey,
        productUrl: input.productUrl,
        priceMinor: price.amountMinor,
        priceCurrency: price.currency,
        stockStatus: input.stockStatus,
        isManual: true,
      },
      true,
    );
    return id;
  }
}

function listingId(
  provider: string,
  region: string,
  productKey: string,
  seller: string,
): string {
  return createHash('sha256')
    .update(`${provider}|${region}|${productKey}|${seller}`)
    .digest('hex')
    .slice(0, 24);
}
