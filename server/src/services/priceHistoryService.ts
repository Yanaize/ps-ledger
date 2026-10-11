import {
  moneyFromMinor,
  toMajor,
  type CurrencyCode,
  type PriceRegion,
} from '@ps-price-compare/shared';
import {
  countTracked,
  getCollectorState,
  getHistoryForChart,
  getTrackedGame,
  listTrackedGames,
  recordPriceObservation,
  setTrackedActive,
  upsertTrackedGame,
  type PriceHistoryRow,
} from '../db/repositories/priceHistory.js';
import { getProductsForConcept } from '../db/repositories/games.js';
import type { ExchangeService } from './exchangeService.js';
import { logger } from '../lib/logger.js';
import type { Db } from '../db/sqlite.js';
import type { PriceChangedEvent } from './alertService.js';

export type HistoryRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';
export type HistoryMode = 'native' | 'ils';

function rangeSince(range: HistoryRange): string | null {
  if (range === 'ALL') return null;
  const days = range === '1M' ? 30 : range === '3M' ? 90 : range === '6M' ? 180 : 365;
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function toIlsMinor(
  nativeMinor: number,
  currency: CurrencyCode,
  fxRateIlsBase: number | null,
): number | null {
  if (currency === 'ILS') return nativeMinor;
  if (!fxRateIlsBase || fxRateIlsBase <= 0) return null;
  const major = toMajor(moneyFromMinor(nativeMinor, currency));
  return Math.round((major / fxRateIlsBase) * 100);
}

export class PriceHistoryService {
  private onChanged: ((event: PriceChangedEvent) => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly exchange: ExchangeService,
  ) {}

  /** Called only when a new history segment is stored (not on identical checks). */
  setOnPriceChanged(handler: (event: PriceChangedEvent) => void): void {
    this.onChanged = handler;
  }

  /**
   * Single pipeline for manual compare + background collector.
   * Only call after a successful provider fetch for this product.
   */
  async recordSuccessfulPrice(input: {
    productId: string;
    conceptId: string;
    region: PriceRegion;
    currency: CurrencyCode;
    baseMinor: number;
    discountedMinor: number;
    discountPct: number | null;
    saleEndAt: string | null;
    isFree?: boolean;
  }): Promise<{ changed: boolean; id: number }> {
    let fxRate: number | null = null;
    let fxAsOf: string | null = null;
    let fxProvider: string | null = null;
    try {
      const snap = await this.exchange.getSnapshot();
      fxRate = snap.rates[input.currency] ?? null;
      fxAsOf = snap.asOf;
      fxProvider = snap.provider;
    } catch (err) {
      logger.warn({ err }, 'Could not attach FX rate to price history observation');
    }

    const currentMinor = input.isFree ? 0 : input.discountedMinor;
    const isOnSale =
      !input.isFree &&
      input.discountedMinor < input.baseMinor &&
      input.baseMinor > 0;

    const recorded = recordPriceObservation(this.db, {
      productId: input.productId,
      conceptId: input.conceptId,
      region: input.region,
      currency: input.currency,
      baseMinor: input.baseMinor,
      currentMinor,
      discountPct: input.discountPct,
      isOnSale,
      saleEndAt: input.saleEndAt,
      fxRateIlsBase: fxRate,
      fxAsOf,
      fxProvider,
    });

    if (recorded.changed && recorded.previous && this.onChanged) {
      const current = this.db
        .prepare(`SELECT * FROM price_history WHERE id = ?`)
        .get(recorded.id) as PriceHistoryRow | undefined;
      if (current) {
        try {
          this.onChanged({ previous: recorded.previous, current });
        } catch (err) {
          logger.warn({ err }, 'Price alert evaluation failed');
        }
      }
    }

    return { changed: recorded.changed, id: recorded.id };
  }

  track(input: {
    conceptId: string;
    title: string;
    coverUrl?: string | null;
    preferredProductId?: string | null;
  }) {
    upsertTrackedGame(this.db, input);
    return getTrackedGame(this.db, input.conceptId);
  }

  untrack(conceptId: string) {
    setTrackedActive(this.db, conceptId, false);
    return getTrackedGame(this.db, conceptId);
  }

  getTracking(conceptId: string) {
    return getTrackedGame(this.db, conceptId);
  }

  listTracking(activeOnly = false) {
    return listTrackedGames(this.db, { activeOnly });
  }

  getSummary(productId: string, region: PriceRegion) {
    const series = this.db
      .prepare(
        `SELECT * FROM price_history WHERE product_id = ? AND region = ?
         ORDER BY observed_at ASC, id ASC`,
      )
      .all(productId, region) as unknown as PriceHistoryRow[];

    if (series.length === 0) {
      return {
        productId,
        region,
        observationCount: 0,
        current: null,
        lowest: null,
        highest: null,
        regular: null,
        currentDiscountPct: null,
        isOnSale: false,
        isLowestRecorded: false,
        lastChangeAt: null,
        trackingSince: null,
        salePeriods: [] as ReturnType<typeof deriveSalePeriods>,
      };
    }

    const current = series[series.length - 1]!;
    let lowest = series[0]!;
    let highest = series[0]!;
    for (const r of series) {
      if (r.current_minor < lowest.current_minor) lowest = r;
      if (r.current_minor > highest.current_minor) highest = r;
    }

    const lastChangeAt =
      series.length >= 2 ? current.observed_at : series[0]!.observed_at;

    return {
      productId,
      region,
      currency: current.currency as CurrencyCode,
      observationCount: series.length,
      current: {
        minor: current.current_minor,
        currency: current.currency,
        observedAt: current.observed_at,
        lastSeenAt: current.last_seen_at,
      },
      lowest: {
        minor: lowest.current_minor,
        currency: lowest.currency,
        observedAt: lowest.observed_at,
        lastSeenAt: lowest.last_seen_at,
      },
      highest: {
        minor: highest.current_minor,
        currency: highest.currency,
        observedAt: highest.observed_at,
        lastSeenAt: highest.last_seen_at,
      },
      regular: {
        minor: current.base_minor,
        currency: current.currency,
      },
      currentDiscountPct: current.discount_pct,
      isOnSale: Boolean(current.is_on_sale),
      isLowestRecorded: current.current_minor === lowest.current_minor,
      lastChangeAt,
      trackingSince: series[0]!.observed_at,
      salePeriods: deriveSalePeriods(series),
    };
  }

  getChart(opts: {
    conceptId: string;
    regions: PriceRegion[];
    range: HistoryRange;
    mode: HistoryMode;
    productIds?: string[];
  }) {
    const since = rangeSince(opts.range);
    const rows = getHistoryForChart(this.db, {
      conceptId: opts.conceptId,
      productIds: opts.productIds,
      regions: opts.regions,
      since,
    });

    const seriesByKey = new Map<string, PriceHistoryRow[]>();
    for (const row of rows) {
      const key = `${row.region}:${row.product_id}`;
      const list = seriesByKey.get(key) ?? [];
      list.push(row);
      seriesByKey.set(key, list);
    }

    const series = [...seriesByKey.entries()].map(([key, segs]) => {
      const [region, productId] = key.split(':') as [string, string];
      const points = expandStepPoints(segs, opts.mode);
      return {
        region,
        productId,
        points,
        ilsConversion: opts.mode === 'ils' ? describeIlsConversion(segs) : null,
      };
    });

    const tracked = getTrackedGame(this.db, opts.conceptId);
    const firstObserved = rows[0]?.observed_at ?? null;

    return {
      conceptId: opts.conceptId,
      range: opts.range,
      mode: opts.mode,
      since,
      trackingStartedAt: tracked?.tracked_at ?? firstObserved,
      observationCount: rows.length,
      series,
    };
  }

  /** Resolve product IDs for a concept in each region (for chart defaults). */
  productsForConcept(conceptId: string, region?: PriceRegion) {
    return getProductsForConcept(this.db, conceptId, region);
  }

  trackingStatus(intervalMs: number) {
    const counts = countTracked(this.db);
    const state = getCollectorState(this.db);
    let lastResult: {
      successful: number;
      failed: number;
      checked: number;
    } | null = null;
    if (state.last_result_json) {
      try {
        lastResult = JSON.parse(state.last_result_json) as typeof lastResult;
      } catch {
        lastResult = null;
      }
    }
    const next =
      state.next_run_at ??
      (state.last_run_at
        ? new Date(new Date(state.last_run_at).getTime() + intervalMs).toISOString()
        : null);
    return {
      trackedActive: counts.active,
      trackedTotal: counts.total,
      lastCollectionAt: state.last_run_at,
      lastCollectionSuccessAt: state.last_success_at,
      nextScheduledAt: next,
      intervalMs,
      lastResult,
    };
  }
}

function describeIlsConversion(segs: PriceHistoryRow[]): {
  method: 'historical_stored' | 'mixed' | 'unavailable';
  label: string;
} {
  const withFx = segs.filter((s) => s.fx_rate_ils_base != null).length;
  if (withFx === segs.length && segs.length > 0) {
    return {
      method: 'historical_stored',
      label: 'ILS uses exchange rates stored with each observation',
    };
  }
  if (withFx === 0) {
    return {
      method: 'unavailable',
      label: 'No stored FX rates for these observations — ILS points omitted',
    };
  }
  return {
    method: 'mixed',
    label: 'Some points lack stored FX; those points are omitted from the ILS series',
  };
}

/** Step chart points: value holds from observed_at until last_seen_at (and next change). */
function expandStepPoints(
  segs: PriceHistoryRow[],
  mode: HistoryMode,
): Array<{
  at: string;
  priceMinor: number;
  currency: string;
  ilsMinor: number | null;
  isOnSale: boolean;
  segmentId: number;
}> {
  const points: Array<{
    at: string;
    priceMinor: number;
    currency: string;
    ilsMinor: number | null;
    isOnSale: boolean;
    segmentId: number;
  }> = [];

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const ilsMinor = toIlsMinor(
      seg.current_minor,
      seg.currency as CurrencyCode,
      seg.fx_rate_ils_base,
    );
    let priceMinor = seg.current_minor;
    let currency = seg.currency;

    if (mode === 'ils') {
      if (ilsMinor == null) continue;
      priceMinor = ilsMinor;
      currency = 'ILS';
    }

    const point = {
      priceMinor,
      currency,
      ilsMinor,
      isOnSale: Boolean(seg.is_on_sale),
      segmentId: seg.id,
    };

    points.push({
      at: seg.observed_at,
      ...point,
    });

    // Close the step at last_seen_at if it differs (helps charts span the plateau)
    if (seg.last_seen_at !== seg.observed_at) {
      points.push({
        at: seg.last_seen_at,
        ...point,
      });
    }
  }

  return points;
}

export function deriveSalePeriods(series: PriceHistoryRow[]): Array<{
  startAt: string;
  endAt: string;
  currentMinor: number;
  baseMinor: number;
  discountPct: number | null;
  currency: string;
}> {
  const periods: Array<{
    startAt: string;
    endAt: string;
    currentMinor: number;
    baseMinor: number;
    discountPct: number | null;
    currency: string;
  }> = [];

  for (const seg of series) {
    if (!seg.is_on_sale) continue;
    periods.push({
      startAt: seg.observed_at,
      endAt: seg.last_seen_at,
      currentMinor: seg.current_minor,
      baseMinor: seg.base_minor,
      discountPct: seg.discount_pct,
      currency: seg.currency,
    });
  }

  return periods.reverse(); // newest first
}
