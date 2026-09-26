import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  formatMoney,
  type GameComparison,
  type SearchResultItem,
} from '@ps-price-compare/shared';
import { api } from '../api/client';
import { FreshnessBadge } from '../components/FreshnessBadge';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';

const REGION_NAMES: Record<string, string> = {
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
};

function platformLabel(platforms: string[]): string {
  if (!platforms.length) return '';
  return platforms.join(' · ');
}

function editionHint(item: SearchResultItem): string | null {
  if (/deluxe|ultimate|premium|complete|bundle|digital deluxe/i.test(item.name)) {
    return 'Edition / bundle';
  }
  if (item.classification === 'PREMIUM_EDITION') return 'Premium edition';
  if (item.classification === 'GAME_BUNDLE') return 'Bundle';
  return null;
}

export function PriceComparisonPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<SearchResultItem | null>(null);
  const [resolvedConceptId, setResolvedConceptId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [useGiftCards, setUseGiftCards] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    api.prefs().then((p) => setUseGiftCards(Boolean(p.useGiftCardsDefault))).catch(() => {});
  }, []);

  useEffect(() => {
    setSelected(null);
    setResolvedConceptId(null);
    setResolveError(null);
  }, [debounced]);

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2 && !selected,
    staleTime: 30_000,
  });

  const conceptId = resolvedConceptId ?? selected?.conceptId ?? null;

  const compare = useQuery({
    queryKey: ['compare', conceptId, useGiftCards],
    queryFn: () => api.compare(conceptId!, useGiftCards),
    enabled: Boolean(conceptId) && !resolving,
  });

  async function pickResult(item: SearchResultItem) {
    setSelected(item);
    setResolveError(null);
    if (item.conceptId) {
      setResolvedConceptId(item.conceptId);
      return;
    }
    setResolving(true);
    try {
      const { conceptId: id } = await api.resolveConcept(item.productId);
      if (!id) {
        setResolveError(
          'Could not resolve this listing to a store concept. Try another search result.',
        );
        setResolvedConceptId(null);
      } else {
        setResolvedConceptId(id);
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : String(err));
      setResolvedConceptId(null);
    } finally {
      setResolving(false);
    }
  }

  function clearSelection() {
    setSelected(null);
    setResolvedConceptId(null);
    setResolveError(null);
  }

  const results = search.data?.results ?? [];

  return (
    <div>
      <PageHeader
        title="Price Comparison"
        description="Compare current PlayStation Store prices for Japan, India, and Turkey — converted to ₪."
      />

      {!selected && (
        <>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search for a PS5 game…"
            aria-label="Search for a PS5 game"
          />

          {search.isFetching && <div style={{ marginTop: '1rem' }}><LoadingState label="Searching store…" /></div>}
          {search.isError && (
            <div style={{ marginTop: '1rem' }}>
              <ErrorState description={(search.error as Error).message} />
            </div>
          )}
          {search.data?.degraded && (
            <div className="alert warn" style={{ marginTop: '1rem' }}>
              <span className="badge warn">Search degraded</span>
              <span className="text-secondary">{search.data.degradedReason}</span>
            </div>
          )}

          {!search.isFetching && debounced.length < 2 && (
            <div style={{ marginTop: '1.25rem' }}>
              <EmptyState
                title="Search a game to compare"
                description="Enter at least two characters. Results resolve to regional store listings for Japan, India, and Turkey."
              />
            </div>
          )}

          {debounced.length >= 2 && !search.isFetching && results.length === 0 && !search.isError && (
            <div style={{ marginTop: '1rem' }}>
              <EmptyState
                title="No matching games"
                description="Try a shorter title, remove edition words, or check spelling."
              />
            </div>
          )}

          {results.length > 0 && (
            <ul className="search-results">
              {results.slice(0, 24).map((r) => {
                const hint = editionHint(r);
                return (
                  <li key={`${r.productId}-${r.conceptId ?? 'x'}`}>
                    <button type="button" onClick={() => void pickResult(r)}>
                      {r.coverUrl ? (
                        <img src={r.coverUrl} alt="" className="cover-thumb" />
                      ) : (
                        <div className="cover-placeholder" />
                      )}
                      <div>
                        <div className="result-title">{r.name}</div>
                        <div className="result-meta">
                          {[platformLabel(r.platforms), hint, r.discountText]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {selected && (
        <>
          <div className="toolbar">
            <button type="button" className="btn ghost" onClick={clearSelection}>
              ← New search
            </button>
            <label className="check-label">
              <input
                type="checkbox"
                checked={useGiftCards}
                onChange={(e) => setUseGiftCards(e.target.checked)}
              />
              Use gift card cost
            </label>
            {compare.data && <FreshnessBadge freshness={compare.data.ratesFreshness} />}
          </div>

          {resolving && <LoadingState label="Opening store listing…" />}
          {resolveError && <ErrorState title="Could not open listing" description={resolveError} />}
          {conceptId && compare.isFetching && !compare.data && (
            <LoadingState label="Loading regional prices…" />
          )}
          {compare.isError && (
            <ErrorState description={(compare.error as Error).message} />
          )}
          {compare.data && <ComparisonView data={compare.data} />}
        </>
      )}
    </div>
  );
}

function ComparisonView({ data }: { data: GameComparison }) {
  return (
    <div>
      <div className="game-header">
        {data.coverUrl ? (
          <img src={data.coverUrl} alt="" />
        ) : (
          <div className="cover-placeholder" style={{ width: 80, height: 80 }} />
        )}
        <div>
          <h2>{data.canonicalTitle}</h2>
          <div className="game-header-meta">
            {data.cheapestByExchange && (
              <span className="badge ok">
                Best FX · {REGION_NAMES[data.cheapestByExchange]}
              </span>
            )}
            {data.useGiftCards && data.cheapestByGiftCard && (
              <span className="badge accent">
                Best funded · {REGION_NAMES[data.cheapestByGiftCard]}
              </span>
            )}
            {data.exchangeRatesCached && (
              <span className="badge warn">Cached exchange rates</span>
            )}
          </div>
        </div>
      </div>

      <div className="region-grid">
        {data.regions.map((r) => {
          const isCheapestEx = data.cheapestByExchange === r.region;
          const isCheapestGc =
            data.useGiftCards && data.cheapestByGiftCard === r.region;
          const isBest = isCheapestEx || isCheapestGc;
          const primary =
            data.useGiftCards && r.giftCardEstimateIls
              ? r.giftCardEstimateIls
              : r.directIls;

          return (
            <article
              key={r.region}
              className={`region-card ${isBest ? 'is-best' : ''}`}
            >
              <div className="region-card-top">
                <h3>{REGION_NAMES[r.region]}</h3>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {isCheapestEx && <span className="badge ok">Best FX</span>}
                  {isCheapestGc && <span className="badge accent">Best funded</span>}
                </div>
              </div>

              {!r.available ? (
                <div>
                  <div className="price-primary" style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>
                    Not available
                  </div>
                  <p className="muted" style={{ fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
                    {r.matchReason}
                  </p>
                </div>
              ) : (
                <>
                  <div className="price-primary">
                    {primary ? formatMoney(primary) : '—'}
                    <span className="currency-note">
                      {data.useGiftCards && r.giftCardEstimateIls
                        ? 'Estimated gift-card cost (₪)'
                        : 'Direct conversion (₪)'}
                    </span>
                  </div>

                  <div className="price-secondary">
                    {r.title && (
                      <div className="price-row">
                        <span className="label">Store title</span>
                        <span className="value" style={{ fontFamily: 'var(--font)', maxWidth: '60%' }}>
                          {r.title}
                        </span>
                      </div>
                    )}
                    <div className="price-row">
                      <span className="label">Native price</span>
                      <span className="value">
                        <strong>{r.nativePrice ? formatMoney(r.nativePrice) : '—'}</strong>
                        {r.isDiscounted && r.originalNativePrice && (
                          <>
                            {' '}
                            <span className="strike">{formatMoney(r.originalNativePrice)}</span>
                            {r.discountPercent != null && (
                              <span className="discount-tag"> −{r.discountPercent}%</span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    <div className="price-row">
                      <span className="label">Direct FX</span>
                      <span className="value">
                        {r.directIls ? formatMoney(r.directIls) : 'Unavailable'}
                      </span>
                    </div>
                    {data.useGiftCards && (
                      <div className="price-row">
                        <span className="label">Gift card estimate</span>
                        <span className="value">
                          {r.giftCardEstimateIls
                            ? formatMoney(r.giftCardEstimateIls)
                            : 'Unavailable'}
                          {r.fundingStrategy && (
                            <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>
                              {r.fundingStrategy.cards
                                .map((c) => formatMoney(c.denomination))
                                .join(' + ')}
                              {' · remaining '}
                              {formatMoney(r.fundingStrategy.creditRemaining)}
                            </div>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="price-row">
                      <span className="label">Match</span>
                      <span className="value">
                        <span
                          className={`badge ${
                            r.matchConfidence === 'low'
                              ? 'warn'
                              : r.matchConfidence === 'none'
                                ? 'danger'
                                : 'ok'
                          }`}
                        >
                          {r.matchConfidence}
                        </span>
                      </span>
                    </div>
                  </div>
                  {r.matchReason && (
                    <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                      {r.matchReason}
                    </p>
                  )}
                </>
              )}

              <div>
                <FreshnessBadge freshness={r.freshness} />
              </div>
            </article>
          );
        })}
      </div>

      {data.exchangeRatesUpdatedAt && (
        <p className="freshness-line">
          Exchange rates updated {new Date(data.exchangeRatesUpdatedAt).toLocaleString()}
          {data.exchangeRatesCached ? ' · cached' : ''}
        </p>
      )}
    </div>
  );
}
