const EDITION_KEYWORDS = [
  'digital deluxe edition',
  'digital deluxe',
  'deluxe edition',
  'deluxe',
  'ultimate edition',
  'ultimate',
  'premium edition',
  'premium',
  'gold edition',
  'complete edition',
  'complete',
  'standard edition',
  'standard',
  'game of the year',
  'goty',
  'collector edition',
  'collectors edition',
  "collector's edition",
  'collector',
  'collectors',
  "collector's",
  'bundle',
  'cross-gen',
  'cross gen',
  'ps4 & ps5',
  'ps4 and ps5',
  'ps5 & ps4',
  'upgrade',
  'edition',
];

const PLATFORM_KEYWORDS = ['ps5', 'ps4', 'playstation 5', 'playstation 4'];

export function normalizeTitle(raw: string): string {
  let s = (raw ?? '').toLowerCase();
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[''`´]/g, '');
  s = s.replace(/[™®©]/g, '');
  for (const kw of [...EDITION_KEYWORDS, ...PLATFORM_KEYWORDS]) {
    s = s.replace(new RegExp(`\\b${escapeRegex(kw)}\\b`, 'gi'), ' ');
  }
  s = s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return s;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Jaccard similarity over word tokens, 0..1 */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function extractSkuSuffix(productId: string): string | null {
  const m = productId.match(/_00-(.+)$/);
  return m ? m[1] : null;
}

export function detectEditionType(name: string, editionTypeHint?: string | null): 'STANDARD' | 'PREMIUM' | 'UNKNOWN' {
  if (editionTypeHint === 'STANDARD' || editionTypeHint === 'PREMIUM') {
    return editionTypeHint;
  }
  const lower = name.toLowerCase();
  if (
    /deluxe|ultimate|premium|gold|complete|collector/.test(lower) &&
    !/standard/.test(lower)
  ) {
    return 'PREMIUM';
  }
  if (/standard/.test(lower) || !/deluxe|ultimate|premium|gold|complete|bundle/.test(lower)) {
    return 'STANDARD';
  }
  return 'UNKNOWN';
}
