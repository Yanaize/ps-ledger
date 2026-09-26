import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: path.join(rootDir, '.env') });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BIND_HOST: z.string().default('0.0.0.0'),
  DB_PATH: z.string().default('./data/ps-price-compare.sqlite'),
  PRICE_TTL_HOURS: z.coerce.number().positive().default(6),
  CATALOG_TTL_HOURS: z.coerce.number().positive().default(24),
  GIFTCARD_TTL_HOURS: z.coerce.number().positive().default(6),
  RATES_TTL_HOURS: z.coerce.number().positive().default(12),
  REFRESH_MIN_INTERVAL_SECONDS: z.coerce.number().nonnegative().default(300),
  /** Refresh datasets whose last success is older than this (hours). 12 = half a day. */
  AUTO_REFRESH_STALE_HOURS: z.coerce.number().positive().default(12),
  /** How often the server checks for stale datasets (minutes). */
  AUTO_REFRESH_CHECK_MINUTES: z.coerce.number().positive().default(60),
  GIFTCARD_ENEBA_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === '1' || v.toLowerCase() === 'true'),
  EXCHANGE_PROVIDERS: z.string().default('frankfurter,erapi'),
  PS_SEARCH_REGION: z.enum(['JP', 'IN', 'TR', 'IL']).default('IN'),
  HTTP_USER_AGENT: z
    .string()
    .default('ps-price-compare/1.0 (personal home LAN)'),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  HTTP_MAX_CONCURRENCY: z.coerce.number().int().positive().default(3),
  PS_SEARCH_HASH: z
    .string()
    .default('4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides?: Partial<Record<string, string>>): Env {
  const source = { ...process.env, ...overrides };
  return envSchema.parse(source);
}

export function resolveDbPath(dbPath: string): string {
  return path.isAbsolute(dbPath) ? dbPath : path.resolve(rootDir, dbPath);
}

export { rootDir };
