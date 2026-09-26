export type PriceRegion = 'JP' | 'IN' | 'TR';
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
