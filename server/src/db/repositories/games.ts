import type {
  CurrencyCode,
  EditionType,
  Platform,
  Region,
  StoreClassification,
} from '@ps-price-compare/shared';
import type { Db } from '../sqlite.js';
import { preferLatinTitle } from '../../lib/displayName.js';

export interface ProductRow {
  product_id: string;
  concept_id: string;
  region: string;
  name: string;
  platforms_json: string;
  edition_type: string;
  edition_name: string | null;
  classification: string;
  sku_suffix: string | null;
  release_date: string | null;
  cover_url: string | null;
  updated_at: string;
}

export interface PriceRow {
  product_id: string;
  region: string;
  currency: string;
  base_minor: number;
  discounted_minor: number;
  discount_pct: number | null;
  sale_end_at: string | null;
  is_free: number;
  in_plus_catalog: number;
  fetched_at: string;
}

export function upsertConcept(
  db: Db,
  conceptId: string,
  title: string,
  coverUrl: string | null,
): void {
  const now = new Date().toISOString();
  const existing = getConcept(db, conceptId);
  const titleToStore = preferLatinTitle(existing?.canonical_title, title);
  db.prepare(
    `INSERT INTO concepts (concept_id, canonical_title, cover_url, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(concept_id) DO UPDATE SET
       canonical_title = excluded.canonical_title,
       cover_url = COALESCE(excluded.cover_url, concepts.cover_url),
       updated_at = excluded.updated_at`,
  ).run(conceptId, titleToStore, coverUrl, now);
}

export function getConcept(db: Db, conceptId: string) {
  return db
    .prepare(
      'SELECT concept_id, canonical_title, cover_url, updated_at FROM concepts WHERE concept_id = ?',
    )
    .get(conceptId) as
    | {
        concept_id: string;
        canonical_title: string;
        cover_url: string | null;
        updated_at: string;
      }
    | undefined;
}

export function upsertProduct(
  db: Db,
  product: {
    productId: string;
    conceptId: string;
    region: Region;
    name: string;
    platforms: Platform[];
    editionType: EditionType;
    editionName: string | null;
    classification: StoreClassification;
    skuSuffix: string | null;
    releaseDate: string | null;
    coverUrl: string | null;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO products (
       product_id, concept_id, region, name, platforms_json, edition_type,
       edition_name, classification, sku_suffix, release_date, cover_url, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       concept_id = excluded.concept_id,
       region = excluded.region,
       name = excluded.name,
       platforms_json = excluded.platforms_json,
       edition_type = excluded.edition_type,
       edition_name = excluded.edition_name,
       classification = excluded.classification,
       sku_suffix = excluded.sku_suffix,
       release_date = excluded.release_date,
       cover_url = COALESCE(excluded.cover_url, products.cover_url),
       updated_at = excluded.updated_at`,
  ).run(
    product.productId,
    product.conceptId,
    product.region,
    product.name,
    JSON.stringify(product.platforms),
    product.editionType,
    product.editionName,
    product.classification,
    product.skuSuffix,
    product.releaseDate,
    product.coverUrl,
    now,
  );
}

export function getProductsForConcept(db: Db, conceptId: string, region?: Region): ProductRow[] {
  if (region) {
    return db
      .prepare('SELECT * FROM products WHERE concept_id = ? AND region = ?')
      .all(conceptId, region) as unknown as ProductRow[];
  }
  return db
    .prepare('SELECT * FROM products WHERE concept_id = ?')
    .all(conceptId) as unknown as ProductRow[];
}

export function getProduct(db: Db, productId: string): ProductRow | undefined {
  return db.prepare('SELECT * FROM products WHERE product_id = ?').get(productId) as
    | ProductRow
    | undefined;
}

export function upsertPrice(
  db: Db,
  price: {
    productId: string;
    region: Region;
    currency: CurrencyCode;
    baseMinor: number;
    discountedMinor: number;
    discountPct: number | null;
    saleEndAt: string | null;
    isFree: boolean;
    inPlusCatalog: boolean;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO prices (
       product_id, region, currency, base_minor, discounted_minor, discount_pct,
       sale_end_at, is_free, in_plus_catalog, fetched_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, region) DO UPDATE SET
       currency = excluded.currency,
       base_minor = excluded.base_minor,
       discounted_minor = excluded.discounted_minor,
       discount_pct = excluded.discount_pct,
       sale_end_at = excluded.sale_end_at,
       is_free = excluded.is_free,
       in_plus_catalog = excluded.in_plus_catalog,
       fetched_at = excluded.fetched_at`,
  ).run(
    price.productId,
    price.region,
    price.currency,
    price.baseMinor,
    price.discountedMinor,
    price.discountPct,
    price.saleEndAt,
    price.isFree ? 1 : 0,
    price.inPlusCatalog ? 1 : 0,
    now,
  );
}

export function getPrice(db: Db, productId: string, region: Region): PriceRow | undefined {
  return db
    .prepare('SELECT * FROM prices WHERE product_id = ? AND region = ?')
    .get(productId, region) as PriceRow | undefined;
}

export function setSearchCache(
  db: Db,
  region: Region,
  queryNorm: string,
  results: unknown,
): void {
  db.prepare(
    `INSERT INTO search_cache (region, query_norm, results_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(region, query_norm) DO UPDATE SET
       results_json = excluded.results_json,
       fetched_at = excluded.fetched_at`,
  ).run(region, queryNorm, JSON.stringify(results), new Date().toISOString());
}

export function getSearchCache(db: Db, region: Region, queryNorm: string) {
  return db
    .prepare(
      'SELECT results_json, fetched_at FROM search_cache WHERE region = ? AND query_norm = ?',
    )
    .get(region, queryNorm) as { results_json: string; fetched_at: string } | undefined;
}

export function upsertManualMatch(
  db: Db,
  conceptId: string,
  region: Region,
  baseProductId: string,
  matchedProductId: string | null,
  reason: string,
): void {
  db.prepare(
    `INSERT INTO product_matches (
       concept_id, region, base_product_id, matched_product_id, confidence, reason, is_manual, created_at
     ) VALUES (?, ?, ?, ?, 'manual', ?, 1, ?)
     ON CONFLICT(concept_id, region, base_product_id) DO UPDATE SET
       matched_product_id = excluded.matched_product_id,
       confidence = 'manual',
       reason = excluded.reason,
       is_manual = 1,
       created_at = excluded.created_at`,
  ).run(
    conceptId,
    region,
    baseProductId,
    matchedProductId,
    reason,
    new Date().toISOString(),
  );
}

export function getManualMatch(
  db: Db,
  conceptId: string,
  region: Region,
  baseProductId: string,
) {
  return db
    .prepare(
      `SELECT * FROM product_matches
       WHERE concept_id = ? AND region = ? AND base_product_id = ? AND is_manual = 1`,
    )
    .get(conceptId, region, baseProductId) as
    | {
        matched_product_id: string | null;
        confidence: string;
        reason: string;
      }
    | undefined;
}
