import type {
  CurrencyCode,
  Money,
  PriceRegion,
  StockStatus,
} from '@ps-price-compare/shared';
import { MINOR_UNITS } from '@ps-price-compare/shared';
import { ProviderError } from '../../lib/errors.js';
import { extractApolloState, HttpClient } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { parseDenominationForTest as parseDenomination } from './parseDenom.js';

export interface RawGiftCardListing {
  provider: string;
  providerDisplayName: string;
  region: PriceRegion;
  denomination: Money;
  sellerName: string;
  productKey: string;
  productUrl: string;
  price: Money;
  stockStatus: StockStatus;
}

export interface GiftCardProvider {
  id: string;
  displayName: string;
  supportsRegion(region: PriceRegion): boolean;
  fetchListings(region: PriceRegion): Promise<RawGiftCardListing[]>;
  getProductUrl(listing: { productKey: string }): string;
}

const ENEBA_REGION_SLUG: Record<PriceRegion, string> = {
  JP: 'japan',
  IN: 'india',
  TR: 'turkey',
};

export class EnebaWebProvider implements GiftCardProvider {
  readonly id = 'eneba';
  readonly displayName = 'Eneba';

  constructor(private readonly http: HttpClient) {}

  supportsRegion(region: PriceRegion): boolean {
    return region in ENEBA_REGION_SLUG;
  }

  getProductUrl(listing: { productKey: string }): string {
    return `https://www.eneba.com/${listing.productKey}`;
  }

  async fetchListings(region: PriceRegion): Promise<RawGiftCardListing[]> {
    const slug = ENEBA_REGION_SLUG[region];
    // robots.txt allows /store/... ; /search is disallowed — do not use search URLs
    const url = `https://www.eneba.com/store/gift-cards?drms[]=psn&regions[]=${slug}`;
    const res = await this.http.get(url, {
      headers: {
        referer: 'https://www.eneba.com/',
        accept: 'text/html',
      },
    });

    if (res.blocked) {
      throw new ProviderError('eneba', 'Blocked by anti-bot challenge', {
        status: res.status,
      });
    }
    if (!res.ok) {
      throw new ProviderError('eneba', `HTTP ${res.status}`);
    }

    const state = extractApolloState(res.text) as Record<
      string,
      Record<string, unknown>
    > | null;
    if (!state) {
      throw new ProviderError('eneba', 'Missing __APOLLO_STATE__');
    }

    const listings: RawGiftCardListing[] = [];

    for (const [key, node] of Object.entries(state)) {
      if (!key.startsWith('Product::')) continue;
      const typeVal = (node.type as { value?: string } | undefined)?.value;
      const drmSlug = (node.drm as { slug?: string } | undefined)?.slug;
      if (typeVal !== 'GIFTCARD' || drmSlug !== 'psn') continue;

      const productKey = key.slice('Product::'.length);
      const name = String(node.name ?? '');
      const denom = parseDenomination(name, region);
      if (!denom) {
        logger.debug({ name, region }, 'Skipping Eneba product — could not parse denomination');
        continue;
      }

      const regions = node.regions as Array<{ code?: string }> | undefined;
      const regionOk =
        !regions?.length ||
        regions.some((r) => r.code?.toLowerCase() === ENEBA_REGION_SLUG[region]);
      if (!regionOk) continue;

      const auctionRef = node.cheapestAuction as { __ref?: string } | undefined;
      const auctionKey = auctionRef?.__ref;
      const auction = auctionKey ? state[auctionKey] : null;

      let stockStatus: StockStatus = 'unknown';
      let price: Money | null = null;
      let sellerName = 'Eneba marketplace';

      if (auction) {
        if (auction.isInStock === true) stockStatus = 'in_stock';
        else if (auction.isInStock === false) stockStatus = 'out_of_stock';

        // Prefer ILS price (geo-served); amount is in minor units (agorot)
        const ilsPrice = auction['price({"currency":"ILS"})'] as
          | { amount?: number; currency?: string }
          | undefined;
        const eurPrice = auction['price({"currency":"EUR"})'] as
          | { amount?: number; currency?: string }
          | undefined;
        const usdPrice = auction['price({"currency":"USD"})'] as
          | { amount?: number; currency?: string }
          | undefined;

        const picked = ilsPrice ?? eurPrice ?? usdPrice;
        if (picked?.amount != null && picked.currency) {
          const currency = picked.currency as CurrencyCode;
          price = {
            amountMinor: Number(picked.amount),
            currency,
          };
          // Sanity: Eneba ILS amounts are in agorot (e.g. 19785 = ₪197.85)
          if (!(currency in MINOR_UNITS)) {
            price = null;
          }
        }

        const merchant = auction.merchant as { displayname?: string } | undefined;
        if (merchant?.displayname) sellerName = merchant.displayname;
      }

      if (!price) {
        logger.debug({ productKey }, 'Skipping Eneba product — no price');
        continue;
      }

      listings.push({
        provider: this.id,
        providerDisplayName: this.displayName,
        region,
        denomination: denom,
        sellerName,
        productKey,
        productUrl: this.getProductUrl({ productKey }),
        price,
        stockStatus,
      });
    }

    logger.info({ region, count: listings.length }, 'Eneba gift cards fetched');
    return listings;
  }
}

/** Manual entries are written directly to the DB; this provider is a no-op fetcher. */
export class ManualEntryProvider implements GiftCardProvider {
  readonly id = 'manual';
  readonly displayName = 'Manual';

  supportsRegion(): boolean {
    return true;
  }

  async fetchListings(): Promise<RawGiftCardListing[]> {
    return [];
  }

  getProductUrl(listing: { productKey: string }): string {
    return listing.productKey.startsWith('http')
      ? listing.productKey
      : `https://${listing.productKey}`;
  }
}

export function createGiftCardRegistry(
  http: HttpClient,
  enebaEnabled: boolean,
): GiftCardProvider[] {
  const providers: GiftCardProvider[] = [new ManualEntryProvider()];
  if (enebaEnabled) {
    providers.push(new EnebaWebProvider(http));
  }
  return providers;
}
