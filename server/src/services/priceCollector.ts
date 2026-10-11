import type { PriceRegion } from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import {
  getCollectorState,
  listTrackedGames,
  setCollectorState,
  updateTrackedCollectionResult,
} from '../db/repositories/priceHistory.js';
import { PRICE_REGIONS } from '../config/regions.js';
import type { GameSearchService } from './gameSearch.js';
import type { PriceHistoryService } from './priceHistoryService.js';
import { logger } from '../lib/logger.js';

export class PriceCollector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private started = false;

  constructor(
    private readonly db: Db,
    private readonly gameSearch: GameSearchService,
    private readonly history: PriceHistoryService,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    const delay = Math.min(20_000, this.intervalMs);
    setTimeout(() => {
      void this.run('startup');
    }, delay);
    this.timer = setInterval(() => {
      void this.run('interval');
    }, this.intervalMs);
    this.timer.unref?.();
    this.scheduleNext(new Date().toISOString());
    logger.info(
      { intervalHours: this.intervalMs / 3600_000 },
      'Price history collector enabled',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  async run(reason: string): Promise<{
    checked: number;
    successful: number;
    failed: number;
  }> {
    if (this.running) {
      return { checked: 0, successful: 0, failed: 0 };
    }
    this.running = true;
    const startedAt = new Date().toISOString();
    let successful = 0;
    let failed = 0;
    const tracked = listTrackedGames(this.db, { activeOnly: true });

    try {
      for (const game of tracked) {
        try {
          await this.collectOne(game.concept_id);
          successful++;
          updateTrackedCollectionResult(this.db, game.concept_id, true, 'ok');
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          updateTrackedCollectionResult(this.db, game.concept_id, false, msg);
          logger.warn({ conceptId: game.concept_id, err: msg, reason }, 'Tracked price collect failed');
        }
      }

      const result = {
        checked: tracked.length,
        successful,
        failed,
        reason,
        at: startedAt,
      };
      setCollectorState(this.db, {
        lastRunAt: startedAt,
        lastSuccessAt: failed < tracked.length || tracked.length === 0 ? startedAt : undefined,
        lastResultJson: JSON.stringify(result),
        nextRunAt: new Date(Date.now() + this.intervalMs).toISOString(),
      });
      logger.info(result, 'Price history collection pass finished');
      return result;
    } finally {
      this.running = false;
    }
  }

  private async collectOne(conceptId: string): Promise<void> {
    // loadAndCacheConcept records history via the shared pipeline
    await Promise.all(
      PRICE_REGIONS.map(async (region: PriceRegion) => {
        await this.gameSearch.loadAndCacheConcept(region, conceptId);
      }),
    );
  }

  private scheduleNext(fromIso: string): void {
    setCollectorState(this.db, {
      nextRunAt: new Date(new Date(fromIso).getTime() + this.intervalMs).toISOString(),
    });
  }

  status() {
    return {
      ...getCollectorState(this.db),
      running: this.running,
      intervalMs: this.intervalMs,
    };
  }
}
