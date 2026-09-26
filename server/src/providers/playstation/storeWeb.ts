import type {
  CatalogRegion,
  Platform,
  PriceRegion,
  Region,
  SearchResultItem,
  StoreClassification,
} from '@ps-price-compare/shared';
import { detectEditionType, extractSkuSuffix } from '@ps-price-compare/shared';
import { REGIONS } from '../../config/regions.js';
import { ProviderError } from '../../lib/errors.js';
import {
  extractEnvCaches,
  extractNextData,
  HttpClient,
} from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

export interface ParsedPrice {
  currency: string;
  baseMinor: number;
  discountedMinor: number;
  discountPercent: number | null;
  isFree: boolean;
  saleEndAt: string | null;
  inPlusCatalog: boolean;
  formattedBase: string | null;
  formattedDiscounted: string | null;
}

export interface ParsedEdition {
  productId: string;
  conceptId: string;
  region: Region;
  name: string;
  platforms: Platform[];
  editionType: 'STANDARD' | 'PREMIUM' | 'UNKNOWN';
  editionName: string | null;
  classification: StoreClassification;
  skuSuffix: string | null;
  coverUrl: string | null;
  releaseDate: string | null;
  price: ParsedPrice | null;
}

export interface ConceptResult {
  conceptId: string;
  name: string;
  coverUrl: string | null;
  editions: ParsedEdition[];
}

export interface CatalogGame {
  conceptId: string;
  name: string;
  nameEn: string | null;
  devices: Platform[];
  genres: string[];
  imageUrl: string | null;
  productId: string | null;
}

export interface PlayStationDataProvider {
  searchGames(region: Region, query: string): Promise<SearchResultItem[]>;
  getConcept(region: Region, conceptId: string): Promise<ConceptResult | null>;
  getExtraCatalog(region: CatalogRegion): Promise<CatalogGame[]>;
  isSearchDegraded(): { degraded: boolean; reason: string | null };
}

const COMPARABLE_CLASSIFICATIONS = new Set<StoreClassification>([
  'FULL_GAME',
  'GAME_BUNDLE',
  'PREMIUM_EDITION',
]);

export function isComparableClassification(c: StoreClassification): boolean {
  return COMPARABLE_CLASSIFICATIONS.has(c);
}

function mapClassification(raw: string | null | undefined): StoreClassification {
  const v = (raw ?? 'OTHER').toUpperCase();
  if (
    v === 'FULL_GAME' ||
    v === 'GAME_BUNDLE' ||
    v === 'PREMIUM_EDITION' ||
    v === 'ADD_ON_PACK' ||
    v === 'COSTUME'
  ) {
    return v;
  }
  return 'OTHER';
}

function mapPlatforms(raw: unknown): Platform[] {
  if (!Array.isArray(raw)) return [];
  const out: Platform[] = [];
  for (const p of raw) {
    const s = String(p).toUpperCase();
    if (s === 'PS5' || s.includes('PS5')) out.push('PS5');
    else if (s === 'PS4' || s.includes('PS4')) out.push('PS4');
  }
  return [...new Set(out)];
}

function coverFromMedia(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  const master = media.find(
    (m: { role?: string }) => m?.role === 'MASTER' || m?.role === 'GAMEHUB_COVER_ART',
  ) as { url?: string } | undefined;
  if (master?.url) return master.url;
  const first = media[0] as { url?: string } | undefined;
  return first?.url ?? null;
}

function parseDiscountPercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*%/);
  return m ? Number(m[1]) : null;
}

/** Convert major display value to minor units given ISO currency. */
export function toMinorUnits(value: number, currency: string): number {
  if (currency === 'JPY') return Math.round(value);
  return Math.round(value * 100);
}

/**
 * PlayStation CTA `basePriceValue` / `discountedValue`:
 * - JPY / INR: major units (yen, rupees)
 * - TRY: already minor units (kuruş) — do not multiply again
 * Prefer formatted strings when available for safety.
 */
export function psPriceToMinor(
  value: number | undefined,
  formatted: string | null | undefined,
  currency: string,
): number {
  const parsed = parseFormattedMajor(formatted, currency);
  if (parsed != null) return toMinorUnits(parsed, currency);

  const v = value ?? 0;
  if (currency === 'TRY') return Math.round(v);
  return toMinorUnits(v, currency);
}

/** Parse "Rs 4,999", "¥8,980", "2.799,00 TL", "₪319.00", etc. → major units */
export function parseFormattedMajor(
  formatted: string | null | undefined,
  currency: string,
): number | null {
  if (!formatted) return null;
  let s = formatted.replace(/[^\d.,]/g, '').trim();
  if (!s) return null;

  // European format: 2.799,00 or 1.399,50
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',') && s.includes('.')) {
    // 4,999.00 US style
    s = s.replace(/,/g, '');
  } else if (s.includes(',') && !s.includes('.')) {
    // Could be 4,999 (thousands) or 2,50 (decimal)
    const parts = s.split(',');
    if (parts[1]?.length === 3 && currency !== 'EUR' && currency !== 'TRY') {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  } else {
    s = s.replace(/,/g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export class PlayStationStoreWebProvider implements PlayStationDataProvider {
  private searchDegraded = false;
  private searchDegradedReason: string | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly searchHash: string,
  ) {}

  isSearchDegraded() {
    return { degraded: this.searchDegraded, reason: this.searchDegradedReason };
  }

  async searchGames(region: Region, query: string): Promise<SearchResultItem[]> {
    const cfg = REGIONS[region];
    const variables = {
      countryCode: cfg.countryCode,
      languageCode: cfg.languageCode,
      nextCursor: '',
      pageOffset: 0,
      pageSize: 24,
      searchTerm: query,
    };
    const url =
      `https://web.np.playstation.com/api/graphql/v1/op` +
      `?operationName=getSearchResults` +
      `&variables=${encodeURIComponent(JSON.stringify(variables))}` +
      `&extensions=${encodeURIComponent(
        JSON.stringify({
          persistedQuery: { version: 1, sha256Hash: this.searchHash },
        }),
      )}`;

    const res = await this.http.get(url, {
      headers: {
        origin: 'https://store.playstation.com',
        referer: `https://store.playstation.com/${cfg.locale}/`,
        'content-type': 'application/json',
        'x-psn-store-locale-override': `${cfg.languageCode}-${cfg.countryCode}`,
      },
    });

    if (!res.ok) {
      if (res.text.includes('PersistedQueryNotFound') || res.text.includes('not whitelisted')) {
        this.searchDegraded = true;
        this.searchDegradedReason =
          'PlayStation search persisted-query hash is invalid. Recapture PS_SEARCH_HASH from store.playstation.com DevTools.';
      }
      throw new ProviderError('playstation-search', `HTTP ${res.status}`, {
        body: res.text.slice(0, 300),
      });
    }

    let json: {
      errors?: Array<{ message?: string; extensions?: { code?: string } }>;
      data?: {
        universalSearch?: {
          results?: Array<Record<string, unknown>>;
        };
      };
    };
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new ProviderError('playstation-search', 'Invalid JSON response');
    }

    if (json.errors?.length) {
      const code = json.errors[0]?.extensions?.code ?? '';
      const msg = json.errors[0]?.message ?? 'GraphQL error';
      if (
        code.includes('PERSISTED') ||
        msg.toLowerCase().includes('persisted') ||
        msg.toLowerCase().includes('whitelist')
      ) {
        this.searchDegraded = true;
        this.searchDegradedReason =
          'PlayStation search persisted-query hash rejected. Update PS_SEARCH_HASH.';
      }
      throw new ProviderError('playstation-search', msg);
    }

    this.searchDegraded = false;
    this.searchDegradedReason = null;

    const results = json.data?.universalSearch?.results ?? [];
    const items: SearchResultItem[] = [];

    for (const r of results) {
      const typename = String(r.__typename ?? 'Product');
      const id = String(r.id ?? '');
      if (!id) continue;
      const name = String(r.name ?? '');
      const platforms = mapPlatforms(r.platforms);
      const classification = mapClassification(
        String(r.storeDisplayClassification ?? r.localizedStoreDisplayClassification ?? ''),
      );
      const price = r.price as
        | {
            basePrice?: string;
            discountedPrice?: string;
            discountText?: string;
          }
        | undefined;

      let conceptId: string | null = null;
      if (typename === 'Concept') {
        conceptId = id;
      } else if (Array.isArray(r.products) && r.products[0]) {
        // Concept wrapped — ignore
      }

      // Product results don't include conceptId in search; leave null for later resolution
      items.push({
        productId: typename === 'Concept' ? String((r.products as Array<{ id: string }>)?.[0]?.id ?? id) : id,
        conceptId: typename === 'Concept' ? id : conceptId,
        name,
        platforms,
        classification,
        coverUrl: coverFromMedia(r.media),
        region,
        basePriceFormatted: price?.basePrice ?? null,
        discountedPriceFormatted: price?.discountedPrice ?? null,
        discountText: price?.discountText ?? null,
      });
    }

    return items;
  }

  async getConcept(region: Region, conceptId: string): Promise<ConceptResult | null> {
    const cfg = REGIONS[region];
    const url = `https://store.playstation.com/${cfg.locale}/concept/${conceptId}`;
    const res = await this.http.get(url, {
      headers: {
        referer: `https://store.playstation.com/${cfg.locale}/`,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ProviderError('playstation-concept', `HTTP ${res.status} for ${url}`);
    }

    const nextData = extractNextData(res.text) as {
      props?: {
        pageProps?: {
          batarangs?: Record<string, { text?: string }>;
          statusCode?: number;
        };
      };
    } | null;

    if (!nextData?.props?.pageProps) {
      throw new ProviderError('playstation-concept', 'Missing __NEXT_DATA__');
    }
    if (nextData.props.pageProps.statusCode === 404) return null;

    const batarangs = nextData.props.pageProps.batarangs ?? {};
    const editions = new Map<string, ParsedEdition>();
    let conceptName = '';
    let coverUrl: string | null = null;
    let inPlus = false;

    for (const key of ['cta', 'upsells', 'game-title', 'info', 'media-carousel']) {
      const text = batarangs[key]?.text;
      if (!text) continue;
      for (const env of extractEnvCaches(text)) {
        const cache = (env as { cache?: Record<string, Record<string, unknown>> }).cache;
        if (!cache) continue;

        for (const [cacheKey, node] of Object.entries(cache)) {
          if (cacheKey.startsWith('Concept:')) {
            if (typeof node.name === 'string' && node.name) conceptName = node.name;
          }
          if (cacheKey.startsWith('Product:')) {
            const productId = cacheKey.slice('Product:'.length);
            const name = String(node.name ?? conceptName ?? productId);
            const platforms = mapPlatforms(node.platforms);
            const editionObj = node.edition as
              | { type?: string; name?: string }
              | undefined;
            const classification = mapClassification(
              String(node.storeDisplayClassification ?? ''),
            );
            const existing = editions.get(productId);
            editions.set(productId, {
              productId,
              conceptId,
              region,
              name: name || existing?.name || productId,
              platforms: platforms.length ? platforms : existing?.platforms ?? [],
              editionType: detectEditionType(name, editionObj?.type ?? null),
              editionName: editionObj?.name ?? existing?.editionName ?? null,
              classification:
                classification !== 'OTHER'
                  ? classification
                  : existing?.classification ?? 'OTHER',
              skuSuffix: extractSkuSuffix(productId),
              coverUrl: existing?.coverUrl ?? null,
              releaseDate:
                typeof node.releaseDate === 'string'
                  ? node.releaseDate
                  : existing?.releaseDate ?? null,
              price: existing?.price ?? null,
            });
          }
          if (cacheKey.startsWith('GameCTA:')) {
            const type = String(node.type ?? '');
            if (type === 'UPSELL_PS_PLUS_GAME_CATALOG') {
              inPlus = true;
            }
            if (type === 'ADD_TO_CART' || cacheKey.includes(':OUTRIGHT')) {
              const price = node.price as
                | {
                    basePriceValue?: number;
                    discountedValue?: number;
                    currencyCode?: string;
                    endTime?: number | null;
                    isFree?: boolean;
                    basePrice?: string;
                    discountedPrice?: string;
                  }
                | undefined;
              const local = node.local as { discountBadgeText?: string } | undefined;
              const action = node.action as
                | { param?: Array<{ name?: string; value?: string }> }
                | undefined;
              const skuParam = action?.param?.find((p) => p.name === 'skuId');
              // skuId looks like PRODUCTID-E004 — strip trailing SKU variant
              let productId = skuParam?.value ?? '';
              if (productId.includes('-') && /-[A-Z]\d{3}$/.test(productId)) {
                productId = productId.replace(/-[A-Z]\d{3}$/, '');
              }
              // Prefer extracting from GameCTA id
              const idMatch = cacheKey.match(
                /GameCTA:ADD_TO_CART:ADD_TO_CART:([A-Z0-9]+-[A-Z]{4}\d+_00-[A-Z0-9_]+)-[A-Z]\d{3}:/,
              );
              if (idMatch) productId = idMatch[1];

              if (productId && price && typeof price.basePriceValue === 'number') {
                const currency = String(price.currencyCode ?? REGIONS[region].currency);
                const baseVal = price.basePriceValue;
                const discVal =
                  typeof price.discountedValue === 'number'
                    ? price.discountedValue
                    : baseVal;
                const parsed: ParsedPrice = {
                  currency,
                  baseMinor: psPriceToMinor(
                    baseVal,
                    price.basePrice ?? null,
                    currency,
                  ),
                  discountedMinor: psPriceToMinor(
                    discVal,
                    price.discountedPrice ?? null,
                    currency,
                  ),
                  discountPercent: parseDiscountPercent(local?.discountBadgeText),
                  isFree: Boolean(price.isFree) && discVal === 0,
                  saleEndAt:
                    typeof price.endTime === 'number'
                      ? new Date(price.endTime).toISOString()
                      : null,
                  inPlusCatalog: inPlus,
                  formattedBase: price.basePrice ?? null,
                  formattedDiscounted: price.discountedPrice ?? null,
                };
                if (!parsed.discountPercent && baseVal > 0 && discVal < baseVal) {
                  parsed.discountPercent = Math.round(
                    ((baseVal - discVal) / baseVal) * 100,
                  );
                }
                const existing = editions.get(productId);
                editions.set(productId, {
                  productId,
                  conceptId,
                  region,
                  name: existing?.name ?? productId,
                  platforms: existing?.platforms ?? [],
                  editionType: existing?.editionType ?? 'UNKNOWN',
                  editionName: existing?.editionName ?? null,
                  classification: existing?.classification ?? 'FULL_GAME',
                  skuSuffix: extractSkuSuffix(productId),
                  coverUrl: existing?.coverUrl ?? null,
                  releaseDate: existing?.releaseDate ?? null,
                  price: parsed,
                });
              }
            }
          }
        }
      }
    }

    // Cover from media-carousel if present
    const mediaText = batarangs['media-carousel']?.text ?? batarangs['background-image']?.text;
    if (mediaText) {
      const urlMatch = mediaText.match(
        /https:\/\/image\.api\.playstation\.com\/[^"\\\s]+/,
      );
      if (urlMatch) coverUrl = urlMatch[0].replace(/\\u002F/g, '/');
    }

    const editionList = [...editions.values()].filter((e) =>
      isComparableClassification(e.classification) || e.price != null,
    );

    // Propagate inPlus to all prices
    if (inPlus) {
      for (const e of editionList) {
        if (e.price) e.price.inPlusCatalog = true;
      }
    }

    if (!conceptName && editionList[0]) conceptName = editionList[0].name;

    logger.debug(
      { region, conceptId, editions: editionList.length },
      'Parsed concept page',
    );

    return {
      conceptId,
      name: conceptName || `Concept ${conceptId}`,
      coverUrl,
      editions: editionList,
    };
  }

  async getExtraCatalog(region: CatalogRegion): Promise<CatalogGame[]> {
    // Delegated to PsPlusGamesListProvider — kept for interface completeness
    const provider = new PsPlusGamesListProvider(this.http);
    return provider.getExtraCatalog(region);
  }

  /** Resolve conceptId from a product page when search didn't include it. */
  async resolveConceptIdFromProduct(
    region: Region,
    productId: string,
  ): Promise<string | null> {
    const cfg = REGIONS[region];
    const url = `https://store.playstation.com/${cfg.locale}/product/${productId}`;
    const res = await this.http.get(url, {
      headers: { referer: `https://store.playstation.com/${cfg.locale}/` },
    });
    if (!res.ok) return null;
    const m = res.text.match(/Concept:(\d+)/);
    return m ? m[1] : null;
  }
}

export class PsPlusGamesListProvider {
  constructor(private readonly http: HttpClient) {}

  async getExtraCatalog(region: CatalogRegion): Promise<CatalogGame[]> {
    const locale = REGIONS[region].locale;
    const url = `https://www.playstation.com/bin/imagic/gameslist?locale=${locale}&categoryList=plus-games-list`;
    const res = await this.http.get(url, {
      headers: {
        referer: `https://www.playstation.com/${locale}/ps-plus/games/`,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new ProviderError('ps-plus-catalog', `HTTP ${res.status}`, {
        region,
        body: res.text.slice(0, 200),
      });
    }

    let data: Array<{
      catalogKey?: string;
      games?: Array<{
        conceptId: number | string;
        name: string;
        nameEn?: string;
        device?: string[];
        genre?: string[];
        imageUrl?: string;
        productId?: string;
      }>;
    }>;
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new ProviderError('ps-plus-catalog', 'Invalid JSON');
    }

    if (!Array.isArray(data)) {
      throw new ProviderError('ps-plus-catalog', 'Unexpected response shape');
    }

    const byConcept = new Map<string, CatalogGame>();
    for (const bucket of data) {
      for (const g of bucket.games ?? []) {
        const conceptId = String(g.conceptId);
        if (!conceptId || conceptId === 'undefined') continue;
        const devices = mapPlatforms(g.device);
        const nameEn = g.nameEn?.trim() || null;
        // Prefer English label when the locale payload includes nameEn (esp. ja-jp)
        const name =
          nameEn && /[A-Za-z]/.test(nameEn) ? nameEn : String(g.name ?? '').trim();
        byConcept.set(conceptId, {
          conceptId,
          name: name || String(g.name ?? conceptId),
          nameEn,
          devices,
          genres: Array.isArray(g.genre) ? g.genre.map(String) : [],
          imageUrl: g.imageUrl ?? null,
          productId: g.productId ?? null,
        });
      }
    }
    return [...byConcept.values()];
  }
}

export type { PriceRegion };
