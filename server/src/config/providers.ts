import type { Env } from './env.js';

export function getProviderConfig(env: Env) {
  return {
    psSearchHash: env.PS_SEARCH_HASH,
    psSearchRegion: env.PS_SEARCH_REGION,
    enebaEnabled: env.GIFTCARD_ENEBA_ENABLED,
    exchangeProviders: env.EXCHANGE_PROVIDERS.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    userAgent: env.HTTP_USER_AGENT,
    timeoutMs: env.HTTP_TIMEOUT_MS,
    maxConcurrency: env.HTTP_MAX_CONCURRENCY,
  };
}

export type ProviderConfig = ReturnType<typeof getProviderConfig>;
