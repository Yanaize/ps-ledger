import {
  computeFreshness,
  type ExchangeRatesSnapshot,
} from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import { getRates, upsertRates } from '../db/repositories/rates.js';
import { recordFetchAttempt } from '../db/repositories/meta.js';
import type { ExchangeRateProvider } from '../providers/exchange/index.js';
import type { RefreshConfig } from '../config/refresh.js';
import { logger } from '../lib/logger.js';

const QUOTES = ['JPY', 'INR', 'TRY', 'USD', 'EUR'];

export class ExchangeService {
  constructor(
    private readonly db: Db,
    private readonly provider: ExchangeRateProvider,
    private readonly refreshConfig: RefreshConfig,
  ) {}

  async getSnapshot(forceRefresh = false): Promise<ExchangeRatesSnapshot> {
    const cached = getRates(this.db, 'ILS');
    const ttl = this.refreshConfig.ttl.rates;
    const age = cached
      ? Date.now() - new Date(cached.fetchedAt).getTime()
      : Infinity;

    if (!forceRefresh && cached && age < ttl) {
      return {
        base: 'ILS',
        rates: cached.rates,
        provider: cached.provider,
        asOf: cached.asOf,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        freshness: computeFreshness(cached.fetchedAt, cached.fetchedAt, ttl),
      };
    }

    try {
      const result = await this.provider.getRates('ILS', QUOTES);
      upsertRates(this.db, 'ILS', result.rates, result.provider, result.asOf);
      recordFetchAttempt(this.db, 'rates', 'ILS', true);
      return {
        base: 'ILS',
        rates: result.rates,
        provider: result.provider,
        asOf: result.asOf,
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        freshness: computeFreshness(
          new Date().toISOString(),
          new Date().toISOString(),
          ttl,
        ),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordFetchAttempt(this.db, 'rates', 'ILS', false, msg);
      logger.warn({ err: msg }, 'Exchange rate refresh failed; using cache if available');
      if (cached) {
        return {
          base: 'ILS',
          rates: cached.rates,
          provider: cached.provider,
          asOf: cached.asOf,
          fetchedAt: cached.fetchedAt,
          fromCache: true,
          freshness: computeFreshness(
            cached.fetchedAt,
            new Date().toISOString(),
            ttl,
          ),
        };
      }
      throw err;
    }
  }
}
