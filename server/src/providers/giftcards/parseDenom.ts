import type { CurrencyCode, Money, PriceRegion } from '@ps-price-compare/shared';
import { moneyFromMajor } from '@ps-price-compare/shared';

const DENOM_PATTERNS: Array<{
  region: PriceRegion;
  re: RegExp;
  currency: CurrencyCode;
}> = [
  { region: 'JP', re: /(\d[\d,]*)\s*JPY/i, currency: 'JPY' },
  { region: 'IN', re: /Rs\.?\s*(\d[\d,]*)/i, currency: 'INR' },
  { region: 'TR', re: /(\d[\d,]*)\s*TRY/i, currency: 'TRY' },
];

export function parseDenominationForTest(
  name: string,
  region: PriceRegion,
): Money | null {
  for (const p of DENOM_PATTERNS) {
    if (p.region !== region) continue;
    const m = name.match(p.re);
    if (!m) continue;
    const major = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(major) || major <= 0) return null;
    return moneyFromMajor(major, p.currency);
  }
  return null;
}
