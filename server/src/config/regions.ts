import type {
  CatalogRegion,
  CurrencyCode,
  PriceRegion,
  Region,
} from '@ps-price-compare/shared';

export interface RegionConfig {
  code: Region;
  name: string;
  currency: CurrencyCode;
  locale: string;
  countryCode: string;
  languageCode: string;
  priceCompare: boolean;
  giftCards: boolean;
  catalog: boolean;
}

export const REGIONS: Record<Region, RegionConfig> = {
  JP: {
    code: 'JP',
    name: 'Japan',
    currency: 'JPY',
    locale: 'ja-jp',
    countryCode: 'JP',
    languageCode: 'ja',
    priceCompare: true,
    giftCards: true,
    catalog: true,
  },
  IN: {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    locale: 'en-in',
    countryCode: 'IN',
    languageCode: 'en',
    priceCompare: true,
    giftCards: true,
    catalog: true,
  },
  TR: {
    code: 'TR',
    name: 'Turkey',
    currency: 'TRY',
    locale: 'en-tr',
    countryCode: 'TR',
    languageCode: 'en',
    priceCompare: true,
    giftCards: true,
    catalog: true,
  },
  IL: {
    code: 'IL',
    name: 'Israel',
    currency: 'ILS',
    locale: 'en-il',
    countryCode: 'IL',
    languageCode: 'en',
    priceCompare: false,
    giftCards: false,
    catalog: true,
  },
};

export const PRICE_REGIONS: PriceRegion[] = ['JP', 'IN', 'TR'];
export const CATALOG_REGIONS: CatalogRegion[] = ['JP', 'IN', 'TR', 'IL'];
export const GIFT_CARD_REGIONS: PriceRegion[] = ['JP', 'IN', 'TR'];

export function regionCurrency(region: Region): CurrencyCode {
  return REGIONS[region].currency;
}
