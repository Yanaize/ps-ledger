import { describe, expect, it } from 'vitest';
import {
  parseFormattedMajor,
  psPriceToMinor,
  toMinorUnits,
} from '../src/providers/playstation/storeWeb.js';
import { parseDenominationForTest } from '../src/providers/giftcards/parseDenom.js';

describe('toMinorUnits', () => {
  it('keeps JPY as-is', () => {
    expect(toMinorUnits(8980, 'JPY')).toBe(8980);
  });
  it('scales INR/TRY/ILS majors', () => {
    expect(toMinorUnits(4999, 'INR')).toBe(499900);
    expect(toMinorUnits(2799, 'TRY')).toBe(279900);
  });
});

describe('psPriceToMinor', () => {
  it('treats TRY CTA values as already kuruş', () => {
    expect(psPriceToMinor(279900, null, 'TRY')).toBe(279900);
    expect(psPriceToMinor(139950, '1.399,50 TL', 'TRY')).toBe(139950);
  });
  it('treats INR CTA values as major units', () => {
    expect(psPriceToMinor(4999, 'Rs 4,999', 'INR')).toBe(499900);
  });
});

describe('parseFormattedMajor', () => {
  it('parses European thousands', () => {
    expect(parseFormattedMajor('2.799,00 TL', 'TRY')).toBe(2799);
  });
});

describe('eneba denomination parsing', () => {
  it('parses JP/IN/TR names', () => {
    expect(
      parseDenominationForTest(
        'PlayStation Network Card 10000 JPY PSN Key JAPAN',
        'JP',
      )?.amountMinor,
    ).toBe(10000);
    expect(
      parseDenominationForTest(
        'PlayStation Network Card Rs.5000 (IN) PSN Key INDIA',
        'IN',
      )?.amountMinor,
    ).toBe(500000);
    expect(
      parseDenominationForTest(
        'PlayStation Network Card 2000 TRY (TR) PSN Key TURKEY',
        'TR',
      )?.amountMinor,
    ).toBe(200000);
  });
});
