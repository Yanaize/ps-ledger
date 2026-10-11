import type {
  MatchConfidence,
  Platform,
  StoreClassification,
} from '@ps-price-compare/shared';
import {
  extractSkuSuffix,
  titleSimilarity,
} from '@ps-price-compare/shared';
import type { ParsedEdition } from '../providers/playstation/storeWeb.js';
import { isComparableClassification } from '../providers/playstation/storeWeb.js';

export interface MatchResult {
  edition: ParsedEdition | null;
  confidence: MatchConfidence;
  reason: string;
}

function samePlatforms(a: Platform[], b: Platform[]): boolean {
  const sa = [...a].sort().join(',');
  const sb = [...b].sort().join(',');
  return sa === sb;
}

function isFullGamePreferred(c: StoreClassification): boolean {
  return c === 'FULL_GAME';
}

/**
 * Match a base edition (from search region) to candidates in another region.
 * Prefer stable identifiers over title similarity.
 */
export function matchEdition(
  base: ParsedEdition,
  candidates: ParsedEdition[],
  manualProductId?: string | null,
): MatchResult {
  if (manualProductId) {
    const found = candidates.find((c) => c.productId === manualProductId);
    return {
      edition: found ?? null,
      confidence: 'manual',
      reason: found
        ? 'Manually selected match'
        : 'Manual match product no longer found in region',
    };
  }

  const comparable = candidates.filter(
    (c) => isComparableClassification(c.classification) || c.price != null,
  );

  // exact: same product ID
  const exact = comparable.find((c) => c.productId === base.productId);
  if (exact) {
    return { edition: exact, confidence: 'exact', reason: 'Identical product ID' };
  }

  const baseSuffix = base.skuSuffix ?? extractSkuSuffix(base.productId);

  // high: same SKU suffix + same platforms
  if (baseSuffix) {
    const high = comparable.filter(
      (c) =>
        (c.skuSuffix ?? extractSkuSuffix(c.productId)) === baseSuffix &&
        samePlatforms(c.platforms, base.platforms),
    );
    if (high.length === 1) {
      return {
        edition: high[0],
        confidence: 'high',
        reason: `Same SKU suffix (${baseSuffix}) and platforms`,
      };
    }
    if (high.length > 1) {
      const preferred =
        high.find((h) => h.editionType === base.editionType) ??
        high.find((h) => isFullGamePreferred(h.classification)) ??
        high[0];
      return {
        edition: preferred,
        confidence: 'high',
        reason: `Same SKU suffix (${baseSuffix}); chose among ${high.length} candidates`,
      };
    }
  }

  // medium: same edition type + platforms + classification
  const medium = comparable.filter(
    (c) =>
      c.editionType === base.editionType &&
      c.editionType !== 'UNKNOWN' &&
      samePlatforms(c.platforms, base.platforms) &&
      c.classification === base.classification,
  );
  if (medium.length === 1) {
    return {
      edition: medium[0],
      confidence: 'medium',
      reason: `Same edition type (${base.editionType}), platforms, and classification`,
    };
  }
  if (medium.length > 1) {
    // Prefer FULL_GAME standard
    const preferred =
      medium.find((m) => isFullGamePreferred(m.classification)) ?? medium[0];
    return {
      edition: preferred,
      confidence: 'medium',
      reason: `Edition/platform/classification match among ${medium.length} candidates`,
    };
  }

  // low: title similarity fallback — must still share platforms when base has platforms
  const scored = comparable
    .map((c) => ({
      c,
      score: titleSimilarity(base.name, c.name),
      platformOk:
        base.platforms.length === 0 ||
        c.platforms.length === 0 ||
        samePlatforms(c.platforms, base.platforms),
    }))
    .filter((x) => x.platformOk && x.score >= 0.55)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return {
      edition: scored[0].c,
      confidence: 'low',
      reason: `Uncertain title match (${(scored[0].score * 100).toFixed(0)}% similarity) — verify editions`,
    };
  }

  return {
    edition: null,
    confidence: 'none',
    reason: 'Not available / not found',
  };
}

/** Pick the default "standard" edition from a concept's editions for comparison. */
export function pickPrimaryEdition(editions: ParsedEdition[]): ParsedEdition | null {
  const comparable = editions.filter(
    (e) => isComparableClassification(e.classification) && e.price != null,
  );
  if (comparable.length === 0) {
    return editions.find((e) => e.price != null) ?? editions[0] ?? null;
  }
  // Prefer STANDARD FULL_GAME PS5
  const standardPs5 = comparable.find(
    (e) =>
      e.editionType === 'STANDARD' &&
      e.classification === 'FULL_GAME' &&
      e.platforms.includes('PS5') &&
      !e.platforms.includes('PS4'),
  );
  if (standardPs5) return standardPs5;

  const standard = comparable.find(
    (e) => e.editionType === 'STANDARD' && e.classification === 'FULL_GAME',
  );
  if (standard) return standard;

  const fullGame = comparable.find((e) => e.classification === 'FULL_GAME');
  if (fullGame) return fullGame;

  return comparable[0];
}
