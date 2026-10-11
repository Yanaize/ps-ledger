import type { CurrencyCode } from '@ps-price-compare/shared';
import type { Db } from '../sqlite.js';

export const WALLET_REGIONS = ['IL', 'JP', 'IN', 'TR'] as const;
export type WalletRegion = (typeof WALLET_REGIONS)[number];

export const WALLET_CURRENCY: Record<WalletRegion, CurrencyCode> = {
  IL: 'ILS',
  JP: 'JPY',
  IN: 'INR',
  TR: 'TRY',
};

export interface WalletRow {
  region: string;
  currency: string;
  balance_minor: number;
  updated_at: string;
}

export function listWalletBalances(db: Db): WalletRow[] {
  return db
    .prepare(`SELECT region, currency, balance_minor, updated_at FROM wallet_balances`)
    .all() as unknown as WalletRow[];
}

export function setWalletBalance(
  db: Db,
  region: WalletRegion,
  balanceMinor: number,
): WalletRow {
  const now = new Date().toISOString();
  const currency = WALLET_CURRENCY[region];
  db.prepare(
    `INSERT INTO wallet_balances (region, currency, balance_minor, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(region) DO UPDATE SET
       currency = excluded.currency,
       balance_minor = excluded.balance_minor,
       updated_at = excluded.updated_at`,
  ).run(region, currency, Math.max(0, Math.round(balanceMinor)), now);
  return db
    .prepare(`SELECT region, currency, balance_minor, updated_at FROM wallet_balances WHERE region = ?`)
    .get(region) as unknown as WalletRow;
}

export function isWalletRegion(region: string): region is WalletRegion {
  return (WALLET_REGIONS as readonly string[]).includes(region);
}
