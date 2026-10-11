import type { CurrencyCode, Money } from './types.js';

/** Number of minor units per major unit. JPY has no subdivision. */
export const MINOR_UNITS: Record<CurrencyCode, number> = {
  JPY: 1,
  INR: 100,
  TRY: 100,
  ILS: 100,
  USD: 100,
  EUR: 100,
};

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  JPY: '¥',
  INR: '₹',
  TRY: '₺',
  ILS: '₪',
  USD: '$',
  EUR: '€',
};

export function moneyFromMajor(amount: number, currency: CurrencyCode): Money {
  const factor = MINOR_UNITS[currency];
  return {
    amountMinor: Math.round(amount * factor),
    currency,
  };
}

export function moneyFromMinor(amountMinor: number, currency: CurrencyCode): Money {
  return { amountMinor: Math.round(amountMinor), currency };
}

export function toMajor(money: Money): number {
  return money.amountMinor / MINOR_UNITS[money.currency];
}

/**
 * Convert foreign currency amount to ILS.
 * `rate` is "units of foreign currency per 1 ILS" (Frankfurter/ER-API style when base=ILS),
 * OR we accept the inverse — see convertToIls.
 *
 * Convention used throughout this app:
 * rates[quote] = how many units of `quote` equal 1 ILS.
 * So ILS = foreignMajor / rates[foreignCurrency].
 */
export function convertToIls(
  foreign: Money,
  ratesIlsBase: Record<string, number>,
): Money | null {
  if (foreign.currency === 'ILS') return foreign;
  const rate = ratesIlsBase[foreign.currency];
  if (!rate || rate <= 0) return null;
  const foreignMajor = toMajor(foreign);
  const ilsMajor = foreignMajor / rate;
  return moneyFromMajor(ilsMajor, 'ILS');
}

export function formatMoney(money: Money, opts?: { compact?: boolean }): string {
  const major = toMajor(money);
  const symbol = CURRENCY_SYMBOLS[money.currency];
  if (money.currency === 'JPY') {
    return `${symbol}${Math.round(major).toLocaleString('en-US')}`;
  }
  const digits = opts?.compact ? 0 : 2;
  return `${symbol}${major.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function markupPercent(theoreticalIls: Money, actualIls: Money): number | null {
  const t = toMajor(theoreticalIls);
  const a = toMajor(actualIls);
  if (t <= 0) return null;
  return ((a - t) / t) * 100;
}

/** ILS cost per 1000 units of regional currency. */
export function effectiveRatePer1000(
  denomination: Money,
  priceIls: Money,
): number | null {
  const denomMajor = toMajor(denomination);
  if (denomMajor <= 0) return null;
  return (toMajor(priceIls) / denomMajor) * 1000;
}
