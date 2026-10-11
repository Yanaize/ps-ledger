const KEY = 'ps-ledger-wallets';

export const LOCAL_WALLET_REGIONS = [
  { region: 'IL', currency: 'ILS' as const },
  { region: 'JP', currency: 'JPY' as const },
  { region: 'IN', currency: 'INR' as const },
  { region: 'TR', currency: 'TRY' as const },
];

export type LocalWalletRegion = (typeof LOCAL_WALLET_REGIONS)[number]['region'];

export function readWallets(): Record<LocalWalletRegion, number> {
  const empty: Record<LocalWalletRegion, number> = { IL: 0, JP: 0, IN: 0, TR: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Record<LocalWalletRegion, number>>;
    for (const { region } of LOCAL_WALLET_REGIONS) {
      const value = parsed[region];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        empty[region] = Math.round(value);
      }
    }
    return empty;
  } catch {
    return empty;
  }
}

export function writeWallet(region: LocalWalletRegion, minor: number) {
  const all = readWallets();
  all[region] = Math.max(0, Math.round(minor));
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function walletQuery(wallets: Record<LocalWalletRegion, number>): string {
  return LOCAL_WALLET_REGIONS.map(({ region }) => `${region}:${wallets[region]}`).join(',');
}
