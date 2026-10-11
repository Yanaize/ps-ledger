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
  upsertConcept,
} from '../db/repositories/games.js';
import { getFetchLog } from '../db/repositories/meta.js';
import { getPref } from '../db/repositories/catalog.js';
import { listGiftCards } from '../db/repositories/giftcards.js';
import { PRICE_REGIONS, REGIONS } from '../config/regions.js';
import type { RefreshConfig } from '../config/refresh.js';
import type { GameSearchService } from './gameSearch.js';
import type { ExchangeService } from './exchangeService.js';
import { matchEdition, pickPrimaryEdition } from './matching.js';
import { type CardOption } from './giftCardOptimizer.js';
import { PurchaseCostService } from './purchaseCostService.js';
import type { WalletService } from './walletService.js';
import type { ParsedEdition } from '../providers/playstation/storeWeb.js';
import { logger } from '../lib/logger.js';
import { preferLatinTitle } from '../lib/displayName.js';

export class PriceComparisonService {
  private readonly purchaseCost = new PurchaseCostService();

  constructor(
    private readonly db: Db,
    private readonly gameSearch: GameSearchService,
    private readonly exchange: ExchangeService,
    private readonly refreshConfig: RefreshConfig,
    private readonly wallets: WalletService,
  ) {}

  async compare(
    conceptId: string,
    opts: {
      useGiftCards?: boolean;
      baseProductId?: string;
      walletOverrides?: Record<string, number>;
    } = {},
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
    for (const preferred of ['IN', 'TR', 'JP', 'IL'] as PriceRegion[]) {
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
    const nameCandidates = [
      conceptRow?.canonical_title,
      ...conceptResults.flatMap((c) =>
        c.result ? [c.result.name, ...c.result.editions.map((e) => e.name)] : [],
      ),
      baseEdition?.name,
    ];
    let canonicalTitle = '';
    for (const name of nameCandidates) {
      canonicalTitle = preferLatinTitle(canonicalTitle, name);
    }
    if (!canonicalTitle) canonicalTitle = `Concept ${conceptId}`;
    const coverUrl =
      conceptRow?.cover_url ??
      conceptResults.find((c) => c.result?.coverUrl)?.result?.coverUrl ??
      null;
    if (conceptRow?.canonical_title !== canonicalTitle) {
      upsertConcept(this.db, conceptId, canonicalTitle, coverUrl);
    }

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
          truePurchaseCost: null,
          savingsVsIsrael: null,
          worthSwitching: null,
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
          truePurchaseCost: null,
          savingsVsIsrael: null,
          worthSwitching: null,
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

      const override = opts.walletOverrides?.[region];
      const walletMinor = override != null ? override : this.wallets.getMinor(region);
      const listed = REGIONS[region].giftCards
        ? listGiftCards(this.db, { region })
        : [];
      const cardOptions: CardOption[] = [];
      for (const c of listed) {
        const cardFresh = computeFreshness(
          c.last_success_at,
          c.last_checked_at,
          this.refreshConfig.ttl.giftcards,
          { isManual: Boolean(c.is_manual) },
        );
        const stale = cardFresh.status === 'stale' || cardFresh.status === 'unavailable';
        if (c.stock_status === 'out_of_stock' || stale) continue;
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
          stockStatus: c.stock_status === 'unknown' ? 'unknown' : 'in_stock',
        });
      }

      const truePurchaseCost = this.purchaseCost.quote({
        nativePrice,
        rates: rates.rates,
        walletMinor,
        cards: cardOptions,
        giftCardsAvailable: REGIONS[region].giftCards,
      });

      if (useGiftCards) {
        fundingStrategy = truePurchaseCost.funding;
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
        truePurchaseCost,
        savingsVsIsrael: null,
        worthSwitching: null,
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

    applyIsraelComparison(regionComparisons, this.db);

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
    truePurchaseCost: null,
    savingsVsIsrael: null,
    worthSwitching: null,
    coverUrl: null,
    title: null,
    freshness,
  };
}

function moneyDelta(
  baseline: { amountMinor: number } | null | undefined,
  other: { amountMinor: number } | null | undefined,
): { ils: ReturnType<typeof moneyFromMinor> | null; pct: number | null } {
  if (!baseline || !other) return { ils: null, pct: null };
  const minor = baseline.amountMinor - other.amountMinor;
  const pct = baseline.amountMinor > 0 ? (minor / baseline.amountMinor) * 100 : null;
  return { ils: moneyFromMinor(minor, 'ILS'), pct };
}

function shekel(minor: number): string {
  const sign = minor < 0 ? '−' : '';
  return `${sign}₪${(Math.abs(minor) / 100).toFixed(2)}`;
}

export function applyIsraelComparison(regions: RegionComparison[], db: Db): void {
  const minIls = Number(getPref(db, 'minSavingsIlsMinor') ?? 3000);
  const minPct = Number(getPref(db, 'minSavingsPct') ?? 10);
  const israel = regions.find((r) => r.region === 'IL' && r.available);
  for (const region of regions) {
    if (!israel || region.region === 'IL') {
      region.savingsVsIsrael = null;
      region.worthSwitching = null;
      continue;
    }
    const direct = moneyDelta(israel.directIls, region.directIls);
    const truth = moneyDelta(
      israel.truePurchaseCost?.trueCostIls,
      region.truePurchaseCost?.trueCostIls,
    );
    region.savingsVsIsrael = {
      directSavingsIls: direct.ils,
      directSavingsPct: direct.pct,
      trueSavingsIls: truth.ils,
      trueSavingsPct: truth.pct,
    };
    const save = truth.ils ?? direct.ils;
    const pct = truth.ils ? truth.pct : direct.pct;
    if (!save) {
      region.worthSwitching = null;
      continue;
    }
    const usingTrue = Boolean(truth.ils);
    const basis = usingTrue ? 'True funding cost' : 'Direct conversion';
    if (save.amountMinor <= 0) {
      region.worthSwitching = {
        label: 'not_cheaper',
        title: 'Not cheaper',
        detail: `${basis} is ${shekel(save.amountMinor)} versus Israel.`,
      };
      continue;
    }
    const meetsIls = save.amountMinor >= minIls;
    const meetsPct = pct != null && pct >= minPct;
    const label = meetsIls && meetsPct ? 'excellent' : meetsIls || meetsPct ? 'good' : 'small';
    const title =
      label === 'excellent' ? 'Excellent savings' : label === 'good' ? 'Good savings' : 'Small savings';
    const amountText = `${shekel(save.amountMinor)}${pct != null ? ` (${pct.toFixed(0)}%)` : ''}`;
    const detail =
      label === 'small'
        ? `Only ${amountText} cheaper than Israel.`
        : `${basis} saves ${amountText} versus Israel.`;
    const extra = usingTrue && direct.ils
      ? ` Direct conversion ${direct.ils.amountMinor >= 0 ? 'saves' : 'is'} ${shekel(direct.ils.amountMinor)}.`
      : usingTrue
        ? ''
        : ' True funding cost is unavailable, so this uses direct conversion.';
    region.worthSwitching = { label, title, detail: `${detail}${extra}` };
  }
}
