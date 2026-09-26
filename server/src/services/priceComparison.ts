import {
  computeFreshness,
  convertToIls,
  moneyFromMinor,
  type CurrencyCode,
  type GameComparison,
  type PriceRegion,
  type RegionComparison,
} from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import {
  getConcept,
  getManualMatch,
  getPrice,
  getProductsForConcept,
} from '../db/repositories/games.js';
import { getFetchLog } from '../db/repositories/meta.js';
import { listGiftCards } from '../db/repositories/giftcards.js';
import { PRICE_REGIONS, REGIONS } from '../config/regions.js';
import type { RefreshConfig } from '../config/refresh.js';
import type { GameSearchService } from './gameSearch.js';
import type { ExchangeService } from './exchangeService.js';
import { matchEdition, pickPrimaryEdition } from './matching.js';
import {
  MinSpendFundingStrategy,
  type CardOption,
} from './giftCardOptimizer.js';
import type { ParsedEdition } from '../providers/playstation/storeWeb.js';
import { logger } from '../lib/logger.js';

export class PriceComparisonService {
  private readonly optimizer = new MinSpendFundingStrategy();

  constructor(
    private readonly db: Db,
    private readonly gameSearch: GameSearchService,
    private readonly exchange: ExchangeService,
    private readonly refreshConfig: RefreshConfig,
  ) {}

  async compare(
    conceptId: string,
    opts: { useGiftCards?: boolean; baseProductId?: string } = {},
  ): Promise<GameComparison> {
    const useGiftCards = Boolean(opts.useGiftCards);
    const rates = await this.exchange.getSnapshot();

    // Load concept for all price regions in parallel
    const conceptResults = await Promise.all(
      PRICE_REGIONS.map(async (region) => {
        try {
          const result = await this.gameSearch.loadAndCacheConcept(region, conceptId);
          return { region, result, error: null as string | null };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ region, conceptId, err: msg }, 'Concept load failed');
          return { region, result: null, error: msg };
        }
      }),
    );

    const byRegion = new Map(
      conceptResults.map((c) => [c.region, c] as const),
    );

    // Choose base edition: prefer IN (search region), then any available
    let baseEdition: ParsedEdition | null = null;
    let baseRegion: PriceRegion | null = null;
    for (const preferred of ['IN', 'TR', 'JP'] as PriceRegion[]) {
      const cr = byRegion.get(preferred)?.result;
      if (!cr) continue;
      const primary = opts.baseProductId
        ? cr.editions.find((e) => e.productId === opts.baseProductId) ??
          pickPrimaryEdition(cr.editions)
        : pickPrimaryEdition(cr.editions);
      if (primary) {
        baseEdition = primary;
        baseRegion = preferred;
        break;
      }
    }

    const conceptRow = getConcept(this.db, conceptId);
    const canonicalTitle =
      conceptRow?.canonical_title ??
      baseEdition?.name ??
      conceptResults.find((c) => c.result)?.result?.name ??
      `Concept ${conceptId}`;
    const coverUrl =
      conceptRow?.cover_url ??
      conceptResults.find((c) => c.result?.coverUrl)?.result?.coverUrl ??
      null;

    const regionComparisons: RegionComparison[] = [];

    for (const region of PRICE_REGIONS) {
      const cr = byRegion.get(region);
      const fetchLog = getFetchLog(this.db, 'concept', `${region}:${conceptId}`);
      const freshness = computeFreshness(
        fetchLog?.last_success_at ?? null,
        fetchLog?.last_attempt_at ?? null,
        this.refreshConfig.ttl.prices,
      );

      if (!cr?.result || !baseEdition) {
        // Try DB cache
        const cachedProducts = getProductsForConcept(this.db, conceptId, region);
        if (cachedProducts.length === 0) {
          regionComparisons.push(emptyRegion(region, freshness, cr?.error));
          continue;
        }
      }

      const editions: ParsedEdition[] =
        cr?.result?.editions ??
        getProductsForConcept(this.db, conceptId, region).map((p) => {
          const price = getPrice(this.db, p.product_id, region);
          return {
            productId: p.product_id,
            conceptId: p.concept_id,
            region,
            name: p.name,
            platforms: JSON.parse(p.platforms_json),
            editionType: p.edition_type as ParsedEdition['editionType'],
            editionName: p.edition_name,
            classification: p.classification as ParsedEdition['classification'],
            skuSuffix: p.sku_suffix,
            coverUrl: p.cover_url,
            releaseDate: p.release_date,
            price: price
              ? {
                  currency: price.currency,
                  baseMinor: price.base_minor,
                  discountedMinor: price.discounted_minor,
                  discountPercent: price.discount_pct,
                  isFree: Boolean(price.is_free),
                  saleEndAt: price.sale_end_at,
                  inPlusCatalog: Boolean(price.in_plus_catalog),
                  formattedBase: null,
                  formattedDiscounted: null,
                }
              : null,
          };
        });

      const manual = baseEdition
        ? getManualMatch(this.db, conceptId, region, baseEdition.productId)
        : undefined;

      const match = baseEdition
        ? matchEdition(
            baseEdition,
            editions,
            manual?.matched_product_id,
          )
        : { edition: pickPrimaryEdition(editions), confidence: 'none' as const, reason: 'No base edition' };

      // Same-region base: treat as exact
      const confidence =
        region === baseRegion && match.edition
          ? 'exact'
          : match.confidence;
      const reason =
        region === baseRegion && match.edition
          ? 'Base region edition'
          : match.reason;

      if (!match.edition || !match.edition.price) {
        regionComparisons.push({
          region,
          available: false,
          product: null,
          matchConfidence: confidence,
          matchReason: reason,
          nativePrice: null,
          originalNativePrice: null,
          discountPercent: null,
          isDiscounted: false,
          directIls: null,
          giftCardEstimateIls: null,
          fundingStrategy: null,
          coverUrl: null,
          title: null,
          freshness,
        });
        continue;
      }

      const ed = match.edition;
      const priceInfo = ed.price;
      if (!priceInfo) {
        regionComparisons.push({
          region,
          available: false,
          product: null,
          matchConfidence: confidence,
          matchReason: reason,
          nativePrice: null,
          originalNativePrice: null,
          discountPercent: null,
          isDiscounted: false,
          directIls: null,
          giftCardEstimateIls: null,
          fundingStrategy: null,
          coverUrl: null,
          title: ed.name,
          freshness,
        });
        continue;
      }

      const currency = (priceInfo.currency as CurrencyCode) || REGIONS[region].currency;
      const nativePrice = moneyFromMinor(priceInfo.discountedMinor, currency);
      const originalNativePrice = moneyFromMinor(priceInfo.baseMinor, currency);
      const isDiscounted = priceInfo.discountedMinor < priceInfo.baseMinor;
      const directIls = convertToIls(nativePrice, rates.rates);

      let giftCardEstimateIls = null;
      let fundingStrategy = null;

      if (useGiftCards && directIls) {
        const cards = listGiftCards(this.db, { region, inStockOnly: true });
        const cardOptions: CardOption[] = [];
        for (const c of cards) {
          // Only use fresh/cached in-stock cards for estimates
          const cardFresh = computeFreshness(
            c.last_success_at,
            c.last_checked_at,
            this.refreshConfig.ttl.giftcards,
            { isManual: Boolean(c.is_manual) },
          );
          if (
            c.stock_status !== 'in_stock' ||
            cardFresh.status === 'stale' ||
            cardFresh.status === 'unavailable'
          ) {
            continue;
          }
          const priceIls =
            c.price_currency === 'ILS'
              ? moneyFromMinor(c.price_minor, 'ILS')
              : convertToIls(
                  moneyFromMinor(c.price_minor, c.price_currency as CurrencyCode),
                  rates.rates,
                );
          if (!priceIls) continue;
          cardOptions.push({
            listingId: c.id,
            denomination: moneyFromMinor(c.denom_minor, c.denom_currency as CurrencyCode),
            priceIls,
          });
        }
        fundingStrategy = this.optimizer.plan(nativePrice, cardOptions);
        giftCardEstimateIls = fundingStrategy?.effectiveGameCostIls ?? null;
      }

      regionComparisons.push({
        region,
        available: true,
        product: {
          productId: ed.productId,
          conceptId,
          region,
          name: ed.name,
          platforms: ed.platforms,
          editionType: ed.editionType,
          editionName: ed.editionName,
          classification: ed.classification,
          skuSuffix: ed.skuSuffix,
          coverUrl: ed.coverUrl,
          releaseDate: ed.releaseDate,
          price: {
            region,
            currency,
            base: originalNativePrice,
            discounted: nativePrice,
            discountPercent: priceInfo.discountPercent,
            isDiscounted,
            isFree: priceInfo.isFree,
            saleEndAt: priceInfo.saleEndAt,
            inPlusCatalog: priceInfo.inPlusCatalog,
            fetchedAt: new Date().toISOString(),
            freshness,
          },
        },
        matchConfidence: confidence,
        matchReason: reason,
        nativePrice,
        originalNativePrice,
        discountPercent: priceInfo.discountPercent,
        isDiscounted,
        directIls,
        giftCardEstimateIls,
        fundingStrategy,
        coverUrl: ed.coverUrl,
        title: ed.name,
        freshness,
      });
    }

    // Sort by ILS (gift card if enabled and available, else direct)
    const sortKey = (r: RegionComparison) => {
      if (!r.available) return Number.POSITIVE_INFINITY;
      if (useGiftCards && r.giftCardEstimateIls) {
        return r.giftCardEstimateIls.amountMinor;
      }
      return r.directIls?.amountMinor ?? Number.POSITIVE_INFINITY;
    };
    regionComparisons.sort((a, b) => sortKey(a) - sortKey(b));

    let cheapestByExchange: PriceRegion | null = null;
    let cheapestByGiftCard: PriceRegion | null = null;
    let bestEx = Infinity;
    let bestGc = Infinity;
    for (const r of regionComparisons) {
      if (r.available && r.directIls && r.directIls.amountMinor < bestEx) {
        bestEx = r.directIls.amountMinor;
        cheapestByExchange = r.region;
      }
      if (
        r.available &&
        r.giftCardEstimateIls &&
        r.giftCardEstimateIls.amountMinor < bestGc
      ) {
        bestGc = r.giftCardEstimateIls.amountMinor;
        cheapestByGiftCard = r.region;
      }
    }

    return {
      conceptId,
      canonicalTitle,
      coverUrl,
      useGiftCards,
      regions: regionComparisons,
      cheapestByExchange,
      cheapestByGiftCard,
      exchangeRatesUpdatedAt: rates.asOf,
      exchangeRatesCached: rates.fromCache,
      ratesFreshness: rates.freshness,
    };
  }
}

function emptyRegion(
  region: PriceRegion,
  freshness: RegionComparison['freshness'],
  error: string | null | undefined,
): RegionComparison {
  return {
    region,
    available: false,
    product: null,
    matchConfidence: 'none',
    matchReason: error ? `Unavailable (${error})` : 'Not available / not found',
    nativePrice: null,
    originalNativePrice: null,
    discountPercent: null,
    isDiscounted: false,
    directIls: null,
    giftCardEstimateIls: null,
    fundingStrategy: null,
    coverUrl: null,
    title: null,
    freshness,
  };
}
