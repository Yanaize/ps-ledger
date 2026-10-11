import type { CurrencyCode, PriceRegion, StockStatus } from '@ps-price-compare/shared';
import type { Db } from '../sqlite.js';

export interface GiftCardRow {
  id: string;
  provider: string;
  region: string;
  denom_minor: number;
  denom_currency: string;
  seller_name: string;
  product_key: string;
  product_url: string;
  price_minor: number;
  price_currency: string;
  stock_status: string;
  last_checked_at: string;
  last_success_at: string | null;
  is_manual: number;
}

export function upsertGiftCardListing(
  db: Db,
  listing: {
    id: string;
    provider: string;
    region: PriceRegion;
    denomMinor: number;
    denomCurrency: CurrencyCode;
    sellerName: string;
    productKey: string;
    productUrl: string;
    priceMinor: number;
    priceCurrency: CurrencyCode;
    stockStatus: StockStatus;
    isManual?: boolean;
  },
  success: boolean,
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT last_success_at FROM gift_card_listings WHERE id = ?')
    .get(listing.id) as { last_success_at: string | null } | undefined;

  if (success) {
    db.prepare(
      `INSERT INTO gift_card_listings (
         id, provider, region, denom_minor, denom_currency, seller_name, product_key,
         product_url, price_minor, price_currency, stock_status, last_checked_at, last_success_at, is_manual
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         denom_minor = excluded.denom_minor,
         denom_currency = excluded.denom_currency,
         seller_name = excluded.seller_name,
         product_url = excluded.product_url,
         price_minor = excluded.price_minor,
         price_currency = excluded.price_currency,
         stock_status = excluded.stock_status,
         last_checked_at = excluded.last_checked_at,
         last_success_at = excluded.last_success_at,
         is_manual = excluded.is_manual`,
    ).run(
      listing.id,
      listing.provider,
      listing.region,
      listing.denomMinor,
      listing.denomCurrency,
      listing.sellerName,
      listing.productKey,
      listing.productUrl,
      listing.priceMinor,
      listing.priceCurrency,
      listing.stockStatus,
      now,
      now,
      listing.isManual ? 1 : 0,
    );
  } else {
    // Failure: only update last_checked_at, preserve price/stock
    if (existing) {
      db.prepare(
        'UPDATE gift_card_listings SET last_checked_at = ? WHERE id = ?',
      ).run(now, listing.id);
    }
  }
}

export function listGiftCards(
  db: Db,
  filters?: { region?: PriceRegion; provider?: string; inStockOnly?: boolean },
): GiftCardRow[] {
  let sql = 'SELECT * FROM gift_card_listings WHERE 1=1';
  const params: unknown[] = [];
  if (filters?.region) {
    sql += ' AND region = ?';
    params.push(filters.region);
  }
  if (filters?.provider) {
    sql += ' AND provider = ?';
    params.push(filters.provider);
  }
  if (filters?.inStockOnly) {
    sql += " AND stock_status = 'in_stock'";
  }
  sql += ' ORDER BY region, denom_minor, price_minor';
  return db.prepare(sql).all(...(params as never[])) as unknown as GiftCardRow[];
}

export function deleteNonManualProviderListings(db: Db, provider: string, region: PriceRegion): void {
  db.prepare(
    'DELETE FROM gift_card_listings WHERE provider = ? AND region = ? AND is_manual = 0',
  ).run(provider, region);
}

export function getGiftCard(db: Db, id: string): GiftCardRow | undefined {
  return db.prepare('SELECT * FROM gift_card_listings WHERE id = ?').get(id) as
    | GiftCardRow
    | undefined;
}
