import {
  computeFreshness,
  type CatalogGameRow,
  type CatalogRegion,
  type CatalogResponse,
  type Platform,
} from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import {
  getCatalogEntries,
  getCatalogSnapshots,
  getPopularConceptIds,
  getPref,
  markCatalogSnapshotFailed,
  replaceCatalogSnapshot,
  setPopularConcept,
} from '../db/repositories/catalog.js';
import { CATALOG_REGIONS } from '../config/regions.js';
import {
  englishDisplayFallback,
  matchCuratedPopular,
} from '../config/popularTitles.js';
import type { RefreshConfig } from '../config/refresh.js';
import type { PsPlusGamesListProvider } from '../providers/playstation/storeWeb.js';
import { logger } from '../lib/logger.js';

export const POPULAR_METHOD =
  'Popular ranking: (1) games you starred in Settings, (2) curated recognizable-title list ' +
  '(see server/src/config/popularTitles.ts), (3) listed in more regions, (4) A–Z. ' +
  'Not a live sales/popularity API — no invented numeric scores.';


/** Prefer Latin-script / English titles over CJK-only labels. */
export function preferDisplayName(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string {
  const cur = stripNoise((current ?? '').trim());
  const cand = stripNoise((candidate ?? '').trim());
  if (!cand) return cur;
  if (!cur) return cand;
  const curLatin = isMostlyLatin(cur);
  const candLatin = isMostlyLatin(cand);
  if (candLatin && !curLatin) return cand;
  if (curLatin && !candLatin) return cur;
  // Both same script family — prefer longer English-looking nameEn often wins
  if (candLatin && curLatin && cand.length > cur.length + 8) return cand;
  return cur;
}

function stripNoise(s: string): string {
  return s
    .replace(/[™®©]/g, '')
    // Drop trailing fullwidth/ASCII parentheticals that are CJK-only glosses
    .replace(/[（(][^）)]*[\u3040-\u9fff\uf900-\ufaff][^）)]*[）)]\s*$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMostlyLatin(s: string): boolean {
  const latin = (s.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length;
  const cjk = (s.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  if (latin === 0 && cjk === 0) return true; // symbols/numbers only
  return latin >= cjk;
}

function hasCjk(s: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(s);
}

export class CatalogService {
  constructor(
    private readonly db: Db,
    private readonly provider: PsPlusGamesListProvider,
    private readonly refreshConfig: RefreshConfig,
  ) {}

  async refreshRegion(region: CatalogRegion) {
    try {
      const games = await this.provider.getExtraCatalog(region);
      replaceCatalogSnapshot(this.db, region, 'plus-games-list', games);
      return { ok: true, count: games.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markCatalogSnapshotFailed(this.db, region, 'plus-games-list', msg);
      logger.warn({ region, err: msg }, 'Catalog refresh failed');
      return { ok: false, count: 0, error: msg };
    }
  }

  async refreshAll() {
    const results: Record<string, { ok: boolean; count: number; error?: string }> = {};
    for (const region of CATALOG_REGIONS) {
      results[region] = await this.refreshRegion(region);
    }
    this.reseedCuratedPopular();
    return results;
  }

  /** Match curated English title needles → popular_concepts after catalog sync. */
  reseedCuratedPopular(): number {
    const entries = getCatalogEntries(this.db);
    const bestName = new Map<string, { name: string; nameEn: string | null }>();
    for (const e of entries) {
      const prev = bestName.get(e.concept_id);
      const cand = { name: e.name, nameEn: e.name_en };
      if (!prev) {
        bestName.set(e.concept_id, cand);
        continue;
      }
      // Prefer rows that already look English
      const prevLabel = prev.nameEn || prev.name;
      const candLabel = cand.nameEn || cand.name;
      if (isMostlyLatin(candLabel) && !isMostlyLatin(prevLabel)) {
        bestName.set(e.concept_id, cand);
      } else if (cand.nameEn && !prev.nameEn) {
        bestName.set(e.concept_id, cand);
      }
    }

    let n = 0;
    for (const [conceptId, names] of bestName) {
      const needle = matchCuratedPopular(names.name, names.nameEn);
      if (!needle) continue;
      setPopularConcept(
        this.db,
        conceptId,
        `curated title match: "${needle}"`,
      );
      n++;
    }
    logger.info({ count: n }, 'Reseeded curated popular concepts');
    return n;
  }

  getMatrix(opts?: {
    view?: 'popular' | 'full' | 'differences' | 'all_regions' | CatalogRegion;
    search?: string;
    sort?: 'name' | 'regions' | 'popular';
  }): CatalogResponse {
    const entries = getCatalogEntries(this.db);
    const snapshots = getCatalogSnapshots(this.db);
    const popular = getPopularConceptIds(this.db);
    const starred = new Set<string>(
      (getPref(this.db, 'starredConcepts') as string[] | null) ?? [],
    );

    // Prefer English-locale rows when merging names (IN/TR/IL before JP)
    const regionPriority: Record<string, number> = {
      IN: 0,
      IL: 1,
      TR: 2,
      JP: 3,
    };
    const ordered = [...entries].sort(
      (a, b) =>
        (regionPriority[a.region] ?? 9) - (regionPriority[b.region] ?? 9),
    );

    type Acc = {
      conceptId: string;
      name: string;
      nameEn: string | null;
      imageUrl: string | null;
      devices: Platform[];
      genres: string[];
      availability: Record<CatalogRegion, boolean>;
    };

    const map = new Map<string, Acc>();
    for (const e of ordered) {
      const region = e.region as CatalogRegion;
      const candidate = e.name_en || e.name;
      let acc = map.get(e.concept_id);
      if (!acc) {
        acc = {
          conceptId: e.concept_id,
          name: candidate,
          nameEn: e.name_en,
          imageUrl: e.image_url,
          devices: JSON.parse(e.devices_json) as Platform[],
          genres: JSON.parse(e.genres_json) as string[],
          availability: { JP: false, IN: false, TR: false, IL: false },
        };
        map.set(e.concept_id, acc);
      }
      acc.availability[region] = true;
      if (e.name_en) {
        acc.nameEn = preferDisplayName(acc.nameEn, e.name_en) || e.name_en;
      }
      acc.name = preferDisplayName(acc.name, e.name_en || e.name);
      // If we still have a CJK-only title but nameEn is Latin, force it
      if (acc.nameEn && isMostlyLatin(acc.nameEn) && !isMostlyLatin(acc.name)) {
        acc.name = acc.nameEn;
      }
      if (!acc.imageUrl && e.image_url) acc.imageUrl = e.image_url;
    }

    let games: CatalogGameRow[] = [...map.values()].map((g) => {
      const regionCount = CATALOG_REGIONS.filter((r) => g.availability[r]).length;
      const display = preferDisplayName(g.nameEn, g.name) || g.name;
      // Final pass: always surface Latin nameEn when available
      let name =
        g.nameEn && isMostlyLatin(g.nameEn)
          ? g.nameEn
          : preferDisplayName(display, g.nameEn) || display;
      if (hasCjk(name)) {
        name =
          englishDisplayFallback(name) ||
          englishDisplayFallback(g.name) ||
          name;
      }
      return {
        ...g,
        name,
        regionCount,
        isPopular: popular.has(g.conceptId) || starred.has(g.conceptId),
        isStarred: starred.has(g.conceptId),
      };
    });

    const view = opts?.view ?? 'full';
    if (view === 'popular') {
      games = games.filter((g) => g.isPopular);
    } else if (view === 'differences') {
      games = games.filter((g) => g.regionCount > 0 && g.regionCount < 4);
    } else if (view === 'all_regions') {
      games = games.filter((g) => g.regionCount === 4);
    } else if (view === 'JP' || view === 'IN' || view === 'TR' || view === 'IL') {
      games = games.filter((g) => g.availability[view] && g.regionCount === 1);
    }

    if (opts?.search) {
      const q = opts.search.toLowerCase();
      games = games.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.nameEn?.toLowerCase().includes(q) ?? false),
      );
    }

    if (opts?.sort === 'regions') {
      games.sort((a, b) => b.regionCount - a.regionCount || a.name.localeCompare(b.name));
    } else if (opts?.sort === 'popular') {
      games.sort((a, b) => {
        const score = (g: CatalogGameRow) => {
          if (g.isStarred) return 1_000_000 + g.regionCount;
          if (g.isPopular) return 100_000 + g.regionCount;
          return g.regionCount;
        };
        const d = score(b) - score(a);
        if (d !== 0) return d;
        return a.name.localeCompare(b.name, 'en');
      });
    } else {
      games.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    }

    const lastUpdated = Object.fromEntries(
      CATALOG_REGIONS.map((region) => {
        const snap = snapshots.find((s) => s.region === region);
        return [
          region,
          computeFreshness(
            snap?.ok ? snap.fetched_at : null,
            snap?.fetched_at ?? null,
            this.refreshConfig.ttl.catalog,
          ),
        ];
      }),
    ) as Record<CatalogRegion, ReturnType<typeof computeFreshness>>;

    return {
      games,
      regions: CATALOG_REGIONS,
      lastUpdated,
      totalCount: games.length,
      popularMethod: POPULAR_METHOD,
    };
  }

  seedPopular(conceptIds: string[], reason: string) {
    for (const id of conceptIds) setPopularConcept(this.db, id, reason);
  }
}
