import type { Region, SearchResultItem } from '@ps-price-compare/shared';
import { normalizeTitle } from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import {
  getSearchCache,
  setSearchCache,
  upsertConcept,
  upsertProduct,
  upsertPrice,
} from '../db/repositories/games.js';
import { recordFetchAttempt } from '../db/repositories/meta.js';
import type { PlayStationStoreWebProvider } from '../providers/playstation/storeWeb.js';
import { isComparableClassification } from '../providers/playstation/storeWeb.js';
import { REGIONS } from '../config/regions.js';
import type { RefreshConfig } from '../config/refresh.js';
import type { CurrencyCode } from '@ps-price-compare/shared';
import { logger } from '../lib/logger.js';

/** Bump when search result shape/filter changes so old noisy caches are ignored. */
const SEARCH_CACHE_VERSION = 'v2';

export class GameSearchService {
  constructor(
    private readonly db: Db,
    private readonly ps: PlayStationStoreWebProvider,
    private readonly searchRegion: Region,
    private readonly refreshConfig: RefreshConfig,
  ) {}

  async search(query: string): Promise<{
    results: SearchResultItem[];
    fromCache: boolean;
    degraded: boolean;
    degradedReason: string | null;
  }> {
    const q = query.trim();
    if (q.length < 2) {
      return {
        results: [],
        fromCache: false,
        degraded: false,
        degradedReason: null,
      };
    }
    const norm = `${SEARCH_CACHE_VERSION}:${normalizeTitle(q)}`;
    const cached = getSearchCache(this.db, this.searchRegion, norm);
    const ttl = this.refreshConfig.ttl.prices;
    if (cached && Date.now() - new Date(cached.fetched_at).getTime() < ttl) {
      return {
        results: JSON.parse(cached.results_json) as SearchResultItem[],
        fromCache: true,
        degraded: this.ps.isSearchDegraded().degraded,
        degradedReason: this.ps.isSearchDegraded().reason,
      };
    }

    try {
      const raw = await this.ps.searchGames(this.searchRegion, q);
      const cleaned = cleanSearchResults(raw);
      setSearchCache(this.db, this.searchRegion, norm, cleaned);
      recordFetchAttempt(this.db, 'search', `${this.searchRegion}:${norm}`, true);
      return {
        results: cleaned,
        fromCache: false,
        degraded: this.ps.isSearchDegraded().degraded,
        degradedReason: this.ps.isSearchDegraded().reason,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordFetchAttempt(this.db, 'search', `${this.searchRegion}:${norm}`, false, msg);
      if (cached) {
        return {
          results: JSON.parse(cached.results_json) as SearchResultItem[],
          fromCache: true,
          degraded: true,
          degradedReason: msg,
        };
      }
      throw err;
    }
  }

  /** Resolve concept ID for a product (called when user selects a search hit). */
  async resolveConceptId(productId: string): Promise<string | null> {
    try {
      return await this.ps.resolveConceptIdFromProduct(this.searchRegion, productId);
    } catch (err) {
      logger.warn({ err, productId }, 'Failed to resolve concept id');
      return null;
    }
  }

  async loadAndCacheConcept(region: Region, conceptId: string) {
    const result = await this.ps.getConcept(region, conceptId);
    if (!result) {
      recordFetchAttempt(this.db, 'concept', `${region}:${conceptId}`, false, 'not found');
      return null;
    }
    upsertConcept(this.db, conceptId, result.name, result.coverUrl);
    for (const ed of result.editions) {
      upsertProduct(this.db, {
        productId: ed.productId,
        conceptId,
        region,
        name: ed.name,
        platforms: ed.platforms,
        editionType: ed.editionType,
        editionName: ed.editionName,
        classification: ed.classification,
        skuSuffix: ed.skuSuffix,
        releaseDate: ed.releaseDate,
        coverUrl: ed.coverUrl ?? result.coverUrl,
      });
      if (ed.price) {
        upsertPrice(this.db, {
          productId: ed.productId,
          region,
          currency: (ed.price.currency as CurrencyCode) || REGIONS[region].currency,
          baseMinor: ed.price.baseMinor,
          discountedMinor: ed.price.discountedMinor,
          discountPct: ed.price.discountPercent,
          saleEndAt: ed.price.saleEndAt,
          isFree: ed.price.isFree,
          inPlusCatalog: ed.price.inPlusCatalog,
        });
      }
    }
    recordFetchAttempt(this.db, 'concept', `${region}:${conceptId}`, true);
    return result;
  }
}

export function cleanSearchResults(raw: SearchResultItem[]): SearchResultItem[] {
  const filtered = raw.filter((r) => {
    if (!r.name?.trim()) return false;
    if (!isComparableClassification(r.classification)) return false;
    // Drop obvious non-game noise
    const n = r.name.toLowerCase();
    if (/\b(comic|soundtrack|avatar|theme|demo)\b/.test(n)) return false;
    return true;
  });

  // Prefer one row per concept when conceptId known; otherwise per productId
  const byKey = new Map<string, SearchResultItem>();
  for (const item of filtered) {
    const key = item.conceptId ? `c:${item.conceptId}` : `p:${item.productId}`;
    const existing = byKey.get(key);
    if (!existing || searchRank(item) < searchRank(existing)) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()]
    .map((item) => ({
      ...item,
      name: item.name.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => searchRank(a) - searchRank(b));
}

function searchRank(item: SearchResultItem): number {
  let score = 0;
  if (item.classification === 'FULL_GAME') score += 0;
  else if (item.classification === 'PREMIUM_EDITION') score += 1;
  else score += 2;
  if (item.platforms.includes('PS5') && !item.platforms.includes('PS4')) score += 0;
  else if (item.platforms.includes('PS5')) score += 1;
  else score += 2;
  if (/deluxe|ultimate|premium|complete|bundle/i.test(item.name)) score += 3;
  return score;
}
