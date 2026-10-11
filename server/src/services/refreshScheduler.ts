import type { RefreshResult } from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import { getRefreshJob, upsertRefreshJob } from '../db/repositories/meta.js';
import type { DatasetId, RefreshConfig } from '../config/refresh.js';
import { ThrottleError } from '../lib/errors.js';
import type { ExchangeService } from './exchangeService.js';
import type { GiftCardService } from './giftCardService.js';
import type { CatalogService } from './catalogService.js';
import { logger } from '../lib/logger.js';

const AUTO_DATASETS = ['rates', 'giftcards', 'catalog', 'prices'] as const;

export class RefreshScheduler {
  private running = new Set<string>();
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private autoPassRunning = false;

  constructor(
    private readonly db: Db,
    private readonly refreshConfig: RefreshConfig,
    private readonly exchange: ExchangeService,
    private readonly giftCards: GiftCardService,
    private readonly catalog: CatalogService,
  ) {}

  /** Start periodic stale checks (also runs one pass shortly after boot). */
  startAutoRefresh(): void {
    if (this.autoTimer) return;
    const delayMs = Math.min(15_000, this.refreshConfig.autoRefreshCheckMs);
    setTimeout(() => {
      void this.refreshStaleDatasets('startup');
    }, delayMs);
    this.autoTimer = setInterval(() => {
      void this.refreshStaleDatasets('interval');
    }, this.refreshConfig.autoRefreshCheckMs);
    // Don't keep the process alive solely for the timer
    this.autoTimer.unref?.();
    logger.info(
      {
        staleHours: this.refreshConfig.autoRefreshStaleMs / 3600_000,
        checkMinutes: this.refreshConfig.autoRefreshCheckMs / 60_000,
      },
      'Auto-refresh enabled for stale datasets',
    );
  }

  stopAutoRefresh(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  /**
   * Refresh any dataset whose last success is older than AUTO_REFRESH_STALE_HOURS
   * (or that has never succeeded). Safe to call often; no-ops when everything is fresh.
   */
  async refreshStaleDatasets(reason: string = 'manual'): Promise<{
    triggered: string[];
    results: RefreshResult[];
  }> {
    if (this.autoPassRunning) {
      return { triggered: [], results: [] };
    }
    this.autoPassRunning = true;
    const triggered: string[] = [];
    const results: RefreshResult[] = [];
    try {
      const staleMs = this.refreshConfig.autoRefreshStaleMs;
      const now = Date.now();
      for (const dataset of AUTO_DATASETS) {
        const job = getRefreshJob(this.db, dataset);
        const lastOk = job?.last_success_at
          ? new Date(job.last_success_at).getTime()
          : 0;
        const age = lastOk ? now - lastOk : Number.POSITIVE_INFINITY;
        if (age < staleMs) continue;
        triggered.push(dataset);
        logger.info(
          {
            dataset,
            reason,
            ageHours: Number.isFinite(age) ? Math.round(age / 3600_000) : null,
          },
          'Auto-refreshing stale dataset',
        );
        results.push(await this.refreshOne(dataset, { bypassThrottle: true }));
      }
    } finally {
      this.autoPassRunning = false;
    }
    return { triggered, results };
  }

  async refresh(dataset: DatasetId): Promise<RefreshResult> {
    if (dataset === 'all') {
      const parts = await Promise.all([
        this.refreshOne('rates'),
        this.refreshOne('giftcards'),
        this.refreshOne('catalog'),
      ]);
      const ok = parts.every((p) => p.ok || p.throttled);
      return {
        dataset: 'all',
        ok,
        throttled: parts.every((p) => p.throttled),
        throttledUntil: null,
        message: parts.map((p) => `${p.dataset}: ${p.message}`).join('; '),
        details: Object.fromEntries(parts.map((p) => [p.dataset, p])),
      };
    }
    return this.refreshOne(dataset);
  }

  private async refreshOne(
    dataset: Exclude<DatasetId, 'all'>,
    opts?: { bypassThrottle?: boolean },
  ): Promise<RefreshResult> {
    if (this.running.has(dataset)) {
      return {
        dataset,
        ok: false,
        throttled: true,
        throttledUntil: null,
        message: 'Refresh already in progress',
      };
    }

    const job = getRefreshJob(this.db, dataset);
    if (!opts?.bypassThrottle && job?.last_attempt_at) {
      const elapsed = Date.now() - new Date(job.last_attempt_at).getTime();
      if (elapsed < this.refreshConfig.minIntervalMs) {
        const until = new Date(
          new Date(job.last_attempt_at).getTime() +
            this.refreshConfig.minIntervalMs,
        );
        return {
          dataset,
          ok: false,
          throttled: true,
          throttledUntil: until.toISOString(),
          message: `Throttled until ${until.toISOString()}`,
        };
      }
    }

    this.running.add(dataset);
    upsertRefreshJob(this.db, dataset, 'running', 'Refresh started', false);

    try {
      let message = 'OK';
      let details: Record<string, unknown> | undefined;

      if (dataset === 'rates') {
        const snap = await this.exchange.getSnapshot(true);
        message = `Rates from ${snap.provider} as of ${snap.asOf}`;
        details = { provider: snap.provider, asOf: snap.asOf };
      } else if (dataset === 'giftcards') {
        const result = await this.giftCards.refreshAll();
        message = Object.entries(result)
          .map(([r, v]) => `${r}: ${v.count} listings${v.ok ? '' : ' (errors)'}`)
          .join(', ');
        details = result;
      } else if (dataset === 'catalog') {
        const result = await this.catalog.refreshAll();
        message = Object.entries(result)
          .map(([r, v]) => `${r}: ${v.count}${v.ok ? '' : ' FAIL'}`)
          .join(', ');
        details = result;
      } else if (dataset === 'prices') {
        // Prices are fetched on-demand per game; this marks the job and warms rates
        await this.exchange.getSnapshot(true);
        message =
          'Price cache TTL reset via rates warm-up. Individual game prices refresh on search/compare.';
      }

      upsertRefreshJob(this.db, dataset, 'ok', message, true);
      return {
        dataset,
        ok: true,
        throttled: false,
        throttledUntil: null,
        message,
        details,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ dataset, err: msg }, 'Refresh failed');
      upsertRefreshJob(this.db, dataset, 'error', msg, false);
      if (err instanceof ThrottleError) throw err;
      return {
        dataset,
        ok: false,
        throttled: false,
        throttledUntil: null,
        message: msg,
      };
    } finally {
      this.running.delete(dataset);
    }
  }
}
