import {
  convertToIls,
  moneyFromMinor,
  type CatalogRegion,
  type CurrencyCode,
  type Money,
  type PriceRegion,
  type WatchlistEntry,
} from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import { upsertConcept } from '../db/repositories/games.js';
import {
  claimLegacyWatchlist,
  deleteWatchlistItem,
  getWatchlistItem,
  listWatchlistItems,
  upsertWatchlistItem,
} from '../db/repositories/watchlist.js';
import type { ExchangeService } from './exchangeService.js';
import type { PriceHistoryService } from './priceHistoryService.js';
import { preferLatinTitle } from '../lib/displayName.js';

const PRICE_REGIONS: PriceRegion[] = ['IL', 'JP', 'IN', 'TR'];
const CATALOG_REGIONS: CatalogRegion[] = ['JP', 'IN', 'TR', 'IL'];

type PriceRow = {
  region: string;
  product_id: string;
  edition_type: string;
  classification: string;
  currency: string;
  discounted_minor: number;
  base_minor: number;
  discount_pct: number | null;
  fetched_at: string;
  is_free: number;
};

type HistRow = {
  product_id: string;
  region: string;
  current_minor: number;
  currency: string;
  fx_rate_ils_base: number | null;
  observed_at: string;
  last_seen_at: string;
};

export class WatchlistService {
  constructor(
    private readonly db: Db,
    private readonly history: PriceHistoryService,
    private readonly exchange: ExchangeService,
  ) {}

  async add(
    ownerId: string,
    input: {
      conceptId: string;
      title: string;
      coverUrl?: string | null;
      preferredProductId?: string | null;
      notes?: string | null;
    },
  ): Promise<WatchlistEntry> {
    claimLegacyWatchlist(this.db, ownerId);
    upsertConcept(this.db, input.conceptId, input.title, input.coverUrl ?? null);
    upsertWatchlistItem(this.db, ownerId, input.conceptId, input.notes);
    this.history.track({
      conceptId: input.conceptId,
      title: input.title,
      coverUrl: input.coverUrl,
      preferredProductId: input.preferredProductId,
    });
    const entry = await this.get(ownerId, input.conceptId);
    if (!entry) throw new Error('Watchlist insert failed');
    return entry;
  }

  /** Membership only. Does not delete price history or deactivate tracking. */
  remove(ownerId: string, conceptId: string): void {
    claimLegacyWatchlist(this.db, ownerId);
    deleteWatchlistItem(this.db, ownerId, conceptId);
  }

  has(ownerId: string, conceptId: string): boolean {
    claimLegacyWatchlist(this.db, ownerId);
    return Boolean(getWatchlistItem(this.db, ownerId, conceptId));
  }

  async list(ownerId: string): Promise<WatchlistEntry[]> {
    claimLegacyWatchlist(this.db, ownerId);
    const items = listWatchlistItems(this.db, ownerId);
    if (items.length === 0) return [];

    let rates: Record<string, number> = {};
    try {
      const snap = await this.exchange.getSnapshot();
      rates = snap.rates;
    } catch {
      rates = {};
    }

    return items.map((item) => this.hydrate(item.concept_id, item.added_at, rates));
  }

  async get(ownerId: string, conceptId: string): Promise<WatchlistEntry | null> {
    claimLegacyWatchlist(this.db, ownerId);
    const row = getWatchlistItem(this.db, ownerId, conceptId);
    if (!row) return null;
    let rates: Record<string, number> = {};
    try {
      rates = (await this.exchange.getSnapshot()).rates;
    } catch {
      rates = {};
    }
    return this.hydrate(conceptId, row.added_at, rates);
  }

  private hydrate(
    conceptId: string,
    addedAt: string,
    rates: Record<string, number>,
  ): WatchlistEntry {
    const concept = this.db
      .prepare(`SELECT canonical_title, cover_url FROM concepts WHERE concept_id = ?`)
      .get(conceptId) as { canonical_title: string; cover_url: string | null } | undefined;

    const tracked = this.db
      .prepare(
        `SELECT active, last_collected_at, title, cover_url FROM tracked_games WHERE concept_id = ?`,
      )
      .get(conceptId) as
      | {
          active: number;
          last_collected_at: string | null;
          title: string;
          cover_url: string | null;
        }
      | undefined;

    const prices = this.db
      .prepare(
        `SELECT pr.region, p.product_id, p.edition_type, p.classification,
                pr.currency, pr.discounted_minor, pr.base_minor, pr.discount_pct,
                pr.fetched_at, pr.is_free
         FROM products p
         JOIN prices pr ON pr.product_id = p.product_id
         WHERE p.concept_id = ?`,
      )
      .all(conceptId) as unknown as PriceRow[];

    const best = pickCheapest(prices, rates);

    const history = best
      ? (this.db
          .prepare(
            `SELECT product_id, region, current_minor, currency, fx_rate_ils_base,
                    observed_at, last_seen_at
             FROM price_history
             WHERE concept_id = ? AND product_id = ? AND region = ?
             ORDER BY observed_at ASC, id ASC`,
          )
          .all(conceptId, best.productId, best.region) as unknown as HistRow[])
      : [];

    let lowestNative = history[0]?.current_minor ?? null;
    let lowestRow = history[0] ?? null;
    for (const row of history) {
      if (lowestNative == null || row.current_minor < lowestNative) {
        lowestNative = row.current_minor;
        lowestRow = row;
      }
    }

    const lowestRecorded = lowestRow
      ? toIlsMoney(lowestRow.current_minor, lowestRow.currency as CurrencyCode, {
          ...(lowestRow.fx_rate_ils_base
            ? { [lowestRow.currency]: lowestRow.fx_rate_ils_base }
            : rates),
        })
      : null;

    const atLowestRecorded =
      Boolean(best) && lowestNative != null && best!.nativeMinor === lowestNative;

    const deltaFromLowestIls =
      best?.ils && lowestRecorded
        ? moneyFromMinor(best.ils.amountMinor - lowestRecorded.amountMinor, 'ILS')
        : null;

    const lastChangeAt =
      history.length >= 2
        ? history[history.length - 1]!.observed_at
        : (history[0]?.observed_at ?? null);

    const plusRows = this.db
      .prepare(
        `SELECT region FROM catalog_entries
         WHERE concept_id = ? AND present = 1 AND list_key = 'plus-games-list'`,
      )
      .all(conceptId) as unknown as Array<{ region: string }>;

    const psPlusRegions = plusRows
      .map((r) => r.region)
      .filter((r): r is CatalogRegion =>
        (CATALOG_REGIONS as string[]).includes(r),
      );

    const fetchedAt = prices.reduce<string | null>((acc, p) => {
      if (!acc || p.fetched_at > acc) return p.fetched_at;
      return acc;
    }, null);

    const productNames = this.db
      .prepare(`SELECT name FROM products WHERE concept_id = ?`)
      .all(conceptId) as unknown as Array<{ name: string }>;
    let title = '';
    for (const name of [
      concept?.canonical_title,
      tracked?.title,
      ...productNames.map((p) => p.name),
    ]) {
      title = preferLatinTitle(title, name);
    }

    return {
      conceptId,
      title: title || conceptId,
      coverUrl: concept?.cover_url ?? tracked?.cover_url ?? null,
      addedAt,
      tracked: Boolean(tracked?.active),
      currentBest: best?.ils ?? null,
      cheapestRegion: best?.region ?? null,
      discountPct: best?.discountPct ?? null,
      lowestRecorded,
      deltaFromLowestIls,
      atLowestRecorded,
      psPlusRegions,
      lastPriceChangeAt: lastChangeAt,
      lastCheckedAt: tracked?.last_collected_at ?? fetchedAt,
    };
  }
}

function toIlsMoney(
  minor: number,
  currency: CurrencyCode,
  rates: Record<string, number>,
): Money | null {
  if (currency === 'ILS') return moneyFromMinor(minor, 'ILS');
  return convertToIls(moneyFromMinor(minor, currency), rates);
}

function pickCheapest(
  prices: PriceRow[],
  rates: Record<string, number>,
): {
  region: PriceRegion;
  productId: string;
  nativeMinor: number;
  ils: Money | null;
  discountPct: number | null;
} | null {
  type Cand = {
    region: PriceRegion;
    productId: string;
    nativeMinor: number;
    ilsMinor: number | null;
    ils: Money | null;
    discountPct: number | null;
    preferred: boolean;
  };

  const byRegion = new Map<PriceRegion, Cand>();

  for (const row of prices) {
    if (!(PRICE_REGIONS as string[]).includes(row.region)) continue;
    const region = row.region as PriceRegion;
    const currency = row.currency as CurrencyCode;
    const nativeMinor = row.is_free ? 0 : row.discounted_minor;
    const ils = toIlsMoney(nativeMinor, currency, rates);
    const preferred =
      row.edition_type === 'STANDARD' || row.classification === 'FULL_GAME';
    const cand: Cand = {
      region,
      productId: row.product_id,
      nativeMinor,
      ilsMinor: ils?.amountMinor ?? null,
      ils,
      discountPct: row.discount_pct,
      preferred,
    };
    const prev = byRegion.get(region);
    if (!prev) {
      byRegion.set(region, cand);
      continue;
    }
    if (cand.preferred && !prev.preferred) {
      byRegion.set(region, cand);
      continue;
    }
    if (cand.preferred === prev.preferred) {
      const a = cand.ilsMinor ?? Number.POSITIVE_INFINITY;
      const b = prev.ilsMinor ?? Number.POSITIVE_INFINITY;
      if (a < b) byRegion.set(region, cand);
    }
  }

  let best: Cand | null = null;
  for (const cand of byRegion.values()) {
    if (!best) {
      best = cand;
      continue;
    }
    const a = cand.ilsMinor ?? Number.POSITIVE_INFINITY;
    const b = best.ilsMinor ?? Number.POSITIVE_INFINITY;
    if (a < b) best = cand;
  }
  if (!best) return null;
  return {
    region: best.region,
    productId: best.productId,
    nativeMinor: best.nativeMinor,
    ils: best.ils,
    discountPct: best.discountPct,
  };
}
