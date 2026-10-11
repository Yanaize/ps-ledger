import type { Env } from './env.js';

export type DatasetId = 'prices' | 'giftcards' | 'catalog' | 'rates' | 'all';

export function getRefreshConfig(env: Env) {
  return {
    minIntervalMs: env.REFRESH_MIN_INTERVAL_SECONDS * 1000,
    autoRefreshStaleMs: env.AUTO_REFRESH_STALE_HOURS * 3600_000,
    autoRefreshCheckMs: env.AUTO_REFRESH_CHECK_MINUTES * 60_000,
    priceHistoryIntervalMs: env.PRICE_HISTORY_INTERVAL_HOURS * 3600_000,
    ttl: {
      prices: env.PRICE_TTL_HOURS * 3600_000,
      giftcards: env.GIFTCARD_TTL_HOURS * 3600_000,
      catalog: env.CATALOG_TTL_HOURS * 3600_000,
      rates: env.RATES_TTL_HOURS * 3600_000,
    },
  };
}

export type RefreshConfig = ReturnType<typeof getRefreshConfig>;
