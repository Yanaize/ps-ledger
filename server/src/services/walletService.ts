import { moneyFromMinor, type CurrencyCode, type Money } from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import {
  isWalletRegion,
  listWalletBalances,
  setWalletBalance,
  WALLET_CURRENCY,
  WALLET_REGIONS,
  type WalletRegion,
} from '../db/repositories/wallets.js';

export interface WalletBalanceView {
  region: WalletRegion;
  currency: CurrencyCode;
  balance: Money;
  updatedAt: string | null;
}

export class WalletService {
  constructor(private readonly db: Db) {}

  list(): WalletBalanceView[] {
    const stored = new Map(listWalletBalances(this.db).map((r) => [r.region, r]));
    return WALLET_REGIONS.map((region) => {
      const row = stored.get(region);
      const currency = WALLET_CURRENCY[region];
      return {
        region,
        currency,
        balance: moneyFromMinor(row?.balance_minor ?? 0, currency),
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  getMinor(region: string): number {
    if (!isWalletRegion(region)) return 0;
    const row = listWalletBalances(this.db).find((r) => r.region === region);
    return row?.balance_minor ?? 0;
  }

  /** Only call from an explicit user save. */
  set(region: string, balanceMinor: number): WalletBalanceView {
    if (!isWalletRegion(region)) {
      throw new Error(`Unsupported wallet region: ${region}`);
    }
    if (!Number.isFinite(balanceMinor) || balanceMinor < 0) {
      throw new Error('Balance must be a non-negative number');
    }
    setWalletBalance(this.db, region, balanceMinor);
    return this.list().find((w) => w.region === region)!;
  }
}
