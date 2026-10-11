export type PriceRegion = 'JP' | 'IN' | 'TR' | 'IL';
export type CatalogRegion = 'JP' | 'IN' | 'TR' | 'IL';
export type Region = PriceRegion | CatalogRegion;

export type CurrencyCode = 'JPY' | 'INR' | 'TRY' | 'ILS' | 'USD' | 'EUR';

export type FreshnessStatus =
  | 'fresh'
  | 'cached'
  | 'stale'
  | 'unavailable'
  | 'manual';

export type StockStatus = 'in_stock' | 'out_of_stock' | 'unknown';

export type MatchConfidence = 'exact' | 'high' | 'medium' | 'low' | 'none' | 'manual';

export type EditionType = 'STANDARD' | 'PREMIUM' | 'UNKNOWN';

export type StoreClassification =
  | 'FULL_GAME'
  | 'GAME_BUNDLE'
  | 'PREMIUM_EDITION'
  | 'ADD_ON_PACK'
  | 'COSTUME'
  | 'OTHER';

export type Platform = 'PS4' | 'PS5';

export interface Money {
  /** Amount in minor units when currency has decimals (agorot, paise, kuruş).
   * For JPY, minor units = yen (no subdivision). */
  amountMinor: number;
  currency: CurrencyCode;
}

export interface Freshness {
  status: FreshnessStatus;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  label: string;
  ageMs: number | null;
}

export interface SearchResultItem {
  productId: string;
  conceptId: string | null;
  name: string;
  platforms: Platform[];
  classification: StoreClassification;
  coverUrl: string | null;
  region: Region;
  basePriceFormatted: string | null;
  discountedPriceFormatted: string | null;
  discountText: string | null;
}

export interface ProductEdition {
  productId: string;
  conceptId: string;
  region: Region;
  name: string;
  platforms: Platform[];
  editionType: EditionType;
  editionName: string | null;
  classification: StoreClassification;
  skuSuffix: string | null;
  coverUrl: string | null;
  releaseDate: string | null;
  price: RegionalPrice | null;
}

export interface RegionalPrice {
  region: Region;
  currency: CurrencyCode;
  base: Money;
  discounted: Money;
  discountPercent: number | null;
  isDiscounted: boolean;
  isFree: boolean;
  saleEndAt: string | null;
  inPlusCatalog: boolean;
  fetchedAt: string;
  freshness: Freshness;
}

export interface RegionComparison {
  region: PriceRegion;
  available: boolean;
  product: ProductEdition | null;
  matchConfidence: MatchConfidence;
  matchReason: string;
  nativePrice: Money | null;
  originalNativePrice: Money | null;
  discountPercent: number | null;
  isDiscounted: boolean;
  directIls: Money | null;
  giftCardEstimateIls: Money | null;
  fundingStrategy: FundingStrategyResult | null;
  truePurchaseCost: TruePurchaseCost | null;
  savingsVsIsrael: {
    directSavingsIls: Money | null;
    directSavingsPct: number | null;
    trueSavingsIls: Money | null;
    trueSavingsPct: number | null;
  } | null;
  worthSwitching: {
    label: 'excellent' | 'good' | 'small' | 'not_cheaper';
    title: string;
    detail: string;
  } | null;
  coverUrl: string | null;
  title: string | null;
  freshness: Freshness;
}

export interface GameComparison {
  conceptId: string;
  canonicalTitle: string;
  coverUrl: string | null;
  useGiftCards: boolean;
  regions: RegionComparison[];
  cheapestByExchange: PriceRegion | null;
  cheapestByGiftCard: PriceRegion | null;
  exchangeRatesUpdatedAt: string | null;
  exchangeRatesCached: boolean;
  ratesFreshness: Freshness;
}

export interface GiftCardListing {
  id: string;
  provider: string;
  providerDisplayName: string;
  region: PriceRegion;
  denomination: Money;
  sellerName: string;
  productKey: string;
  productUrl: string;
  price: Money;
  stockStatus: StockStatus;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  isManual: boolean;
  freshness: Freshness;
  theoreticalIls: Money | null;
  markupPercent: number | null;
  effectiveRatePer1000: number | null;
}

export interface GiftCardRegionSummary {
  region: PriceRegion;
  currency: CurrencyCode;
  bestAvailableIlsPer1000: number | null;
  bestListingId: string | null;
  marketRateIlsPer1000: number | null;
  freshness: Freshness;
}

export interface FundingStrategyResult {
  cards: Array<{ denomination: Money; listingId: string; price: Money }>;
  creditPurchased: Money;
  creditRemaining: Money;
  actualSpendIls: Money;
  effectiveGameCostIls: Money;
  isEstimate: true;
  /** Native credit already in the wallet that is applied to this purchase. */
  walletApplied: Money;
  /** Native credit still needed after the wallet. */
  additionalRequired: Money;
  /** Unknown-stock denominations that were not used. */
  unknownStockExcluded: number;
}

export type CostConfidence = 'complete' | 'partial' | 'unavailable';

export interface TruePurchaseCost {
  directIls: Money | null;
  wallet: Money;
  additionalRequired: Money;
  funding: FundingStrategyResult | null;
  actualSpendIls: Money | null;
  remainingCredit: Money | null;
  trueCostIls: Money | null;
  confidence: CostConfidence;
  note: string | null;
}

export interface CatalogGameRow {
  conceptId: string;
  name: string;
  nameEn: string | null;
  imageUrl: string | null;
  devices: Platform[];
  genres: string[];
  availability: Record<CatalogRegion, boolean>;
  regionCount: number;
  isPopular: boolean;
  isStarred: boolean;
}

export interface CatalogResponse {
  games: CatalogGameRow[];
  regions: CatalogRegion[];
  lastUpdated: Record<CatalogRegion, Freshness>;
  totalCount: number;
  popularMethod: string;
}

export interface ExchangeRatesSnapshot {
  base: 'ILS';
  rates: Record<string, number>;
  provider: string;
  asOf: string;
  fetchedAt: string;
  fromCache: boolean;
  freshness: Freshness;
}

export interface AppStatus {
  serverTime: string;
  bindHost: string;
  port: number;
  lanUrls: string[];
  datasets: Record<
    string,
    {
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      status: string;
      message: string | null;
    }
  >;
  searchDegraded: boolean;
  searchDegradedReason: string | null;
  enebaEnabled: boolean;
  autoRefreshStaleHours?: number;
  autoRefreshCheckMinutes?: number;
}

export interface RefreshResult {
  dataset: string;
  ok: boolean;
  throttled: boolean;
  throttledUntil: string | null;
  message: string;
  details?: Record<string, unknown>;
}

export type HistoryRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';
export type HistoryMode = 'native' | 'ils';

export interface PriceHistoryPoint {
  at: string;
  priceMinor: number;
  currency: string;
  /** Shekel amount stored with this observation. Null when no FX was stored. */
  ilsMinor: number | null;
  isOnSale: boolean;
  segmentId: number;
}

export interface PriceHistorySeries {
  region: string;
  productId: string;
  points: PriceHistoryPoint[];
  ilsConversion: {
    method: 'historical_stored' | 'mixed' | 'unavailable';
    label: string;
  } | null;
}

export interface PriceHistoryChartResponse {
  conceptId: string;
  range: HistoryRange;
  mode: HistoryMode;
  since: string | null;
  trackingStartedAt: string | null;
  observationCount: number;
  series: PriceHistorySeries[];
}

export interface PriceHistorySummary {
  productId: string;
  region: PriceRegion;
  currency?: CurrencyCode;
  observationCount: number;
  current: { minor: number; currency: string; observedAt: string; lastSeenAt: string } | null;
  lowest: { minor: number; currency: string; observedAt: string; lastSeenAt: string } | null;
  highest: { minor: number; currency: string; observedAt: string; lastSeenAt: string } | null;
  regular: { minor: number; currency: string } | null;
  currentDiscountPct: number | null;
  isOnSale?: boolean;
  isLowestRecorded: boolean;
  lastChangeAt: string | null;
  trackingSince: string | null;
  salePeriods: Array<{
    startAt: string;
    endAt: string;
    currentMinor: number;
    baseMinor: number;
    discountPct: number | null;
    currency: string;
  }>;
}

export interface TrackedGame {
  concept_id: string;
  preferred_product_id: string | null;
  title: string;
  cover_url: string | null;
  tracked_at: string;
  active: number;
  last_collected_at: string | null;
  last_collect_ok: number | null;
  last_collect_message: string | null;
}

export interface TrackingStatus {
  trackedActive: number;
  trackedTotal: number;
  lastCollectionAt: string | null;
  lastCollectionSuccessAt: string | null;
  nextScheduledAt: string | null;
  intervalMs: number;
  lastResult: { successful: number; failed: number; checked: number } | null;
}

export interface WatchlistEntry {
  conceptId: string;
  title: string;
  coverUrl: string | null;
  addedAt: string;
  tracked: boolean;
  currentBest: Money | null;
  cheapestRegion: PriceRegion | null;
  discountPct: number | null;
  lowestRecorded: Money | null;
  /** Current best ILS minus lowest recorded ILS. Positive means above the recorded low. */
  deltaFromLowestIls: Money | null;
  atLowestRecorded: boolean;
  psPlusRegions: CatalogRegion[];
  lastPriceChangeAt: string | null;
  lastCheckedAt: string | null;
}

export type AlertKind = 'below_ils' | 'discount_pct' | 'lowest_recorded' | 'sale_started';

export interface AlertRule {
  id: number;
  concept_id: string;
  kind: AlertKind;
  threshold_minor: number | null;
  threshold_pct: number | null;
  enabled: number;
  created_at: string;
}

export interface AlertEvent {
  id: number;
  rule_id: number;
  concept_id: string;
  product_id: string;
  region: string;
  trigger_kind: AlertKind;
  old_minor: number | null;
  old_currency: string | null;
  new_minor: number;
  new_currency: string;
  new_ils_minor: number | null;
  discount_pct: number | null;
  fingerprint: string;
  created_at: string;
  viewed_at: string | null;
  title?: string | null;
}

