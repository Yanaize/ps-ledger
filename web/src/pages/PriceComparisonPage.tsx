import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  formatMoney,
  type GameComparison,
  type GiftCardListing,
  type Money,
  type RegionComparison,
  type SearchResultItem,
} from '@ps-price-compare/shared';
import { api } from '../api/client';
import { FreshnessBadge } from '../components/FreshnessBadge';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';
import { PriceHistoryPanel } from '../components/PriceHistoryPanel';
import { WatchlistButton } from '../components/WatchlistButton';
import { AlertRulesPanel } from '../components/AlertRulesPanel';
import { rememberRecent } from '../recent';
import { readWallets, walletQuery } from '../localWallets';

const REGION_NAMES: Record<string, string> = {
  IL: 'Israel',
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
};

function platformLabel(platforms: string[]): string {
  if (!platforms.length) return '';
  return platforms.join(' · ');
}

/** Smallest in-stock gift card that covers the store price, then the cheapest listing of that amount. */
function coveringGiftCard(
  listings: GiftCardListing[],
  region: string,
  price: Money,
): GiftCardListing | null {
  if (price.amountMinor <= 0) return null;
  const covering = listings.filter(
    (l) =>
      l.region === region &&
      l.denomination.currency === price.currency &&
      l.denomination.amountMinor >= price.amountMinor &&
      l.stockStatus === 'in_stock' &&
      l.price.currency === 'ILS' &&
      Boolean(l.productUrl),
  );
  if (covering.length === 0) return null;
  const minDenom = Math.min(...covering.map((l) => l.denomination.amountMinor));
  return (
    covering
      .filter((l) => l.denomination.amountMinor === minDenom)
      .sort((a, b) => a.price.amountMinor - b.price.amountMinor)[0] ?? null
  );
}

function closeEnough(a: Money | null | undefined, b: Money | null | undefined): boolean {
  if (!a || !b) return false;
  return Math.abs(a.amountMinor - b.amountMinor) < 50;
}

function showShekelStorePrice(
  data: GameComparison,
  region: RegionComparison,
  headline: Money | null | undefined,
): boolean {
  return Boolean(data.useGiftCards && region.directIls && !closeEnough(region.directIls, headline));
}

function showWhatYouPay(region: RegionComparison, headline: Money | null | undefined): boolean {
  const pay = region.truePurchaseCost?.trueCostIls;
  if (!pay) return false;
  if ((region.truePurchaseCost?.wallet.amountMinor ?? 0) > 0) return true;
  return !closeEnough(pay, headline);
}

function payExplanation(region: RegionComparison): string | null {
  const cost = region.truePurchaseCost;
  if (!cost) return null;
  if (region.region === 'IL') return 'You pay this on the Israel store. Gift cards are not used here.';
  if (cost.wallet.amountMinor > 0 && cost.trueCostIls?.amountMinor === 0) {
    return 'Money already in this account covers the game.';
  }
  if (cost.wallet.amountMinor > 0) {
    return `Includes ${formatMoney(cost.wallet)} already in this account.`;
  }
  return null;
}

function walletNote(region: RegionComparison, useGiftCards: boolean): string | null {
  const wallet = region.truePurchaseCost?.wallet;
  if (!useGiftCards || !wallet || wallet.amountMinor <= 0) return null;
  if (!region.giftCardEstimateIls) return null;
  return `Includes ${formatMoney(wallet)} already in your ${REGION_NAMES[region.region] ?? region.region} account.`;
}

function savingsLine(region: RegionComparison, useGiftCards: boolean): string | null {
  const savings = region.savingsVsIsrael;
  if (!savings) return null;
  const save = useGiftCards
    ? (savings.trueSavingsIls ?? savings.directSavingsIls)
    : savings.directSavingsIls;
  const pct = useGiftCards && savings.trueSavingsIls
    ? savings.trueSavingsPct
    : savings.directSavingsPct;
  if (!save) return null;
  const amount = formatMoney({ amountMinor: Math.abs(save.amountMinor), currency: 'ILS' });
  const percent = pct != null ? ` (${Math.abs(Math.round(pct))}%)` : '';
  if (save.amountMinor > 50) return `About ${amount} cheaper than Israel${percent}.`;
  if (save.amountMinor < -50) return `About ${amount} more than Israel${percent}.`;
  return 'About the same price as Israel.';
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
  const navigate = useNavigate();
  const params = useParams();
  const routeConceptId = params.conceptId ?? null;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<SearchResultItem | null>(null);
  const [resolvedConceptId, setResolvedConceptId] = useState<string | null>(routeConceptId);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [useGiftCards, setUseGiftCards] = useState(false);

  useEffect(() => {
    setResolvedConceptId(routeConceptId);
    if (routeConceptId) setSelected({ conceptId: routeConceptId } as SearchResultItem);
    else setSelected(null);
  }, [routeConceptId]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (routeConceptId) return;
    setSelected(null);
    setResolvedConceptId(null);
    setResolveError(null);
  }, [debounced, routeConceptId]);

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2 && !selected,
    staleTime: 30_000,
  });

  const conceptId = resolvedConceptId ?? selected?.conceptId ?? null;

  const compare = useQuery({
    queryKey: ['compare', conceptId, useGiftCards, walletQuery(readWallets())],
    queryFn: () => api.compare(conceptId!, useGiftCards, walletQuery(readWallets())),
    enabled: Boolean(conceptId) && !resolving,
  });

  useEffect(() => {
    if (!compare.data) return;
    rememberRecent({
      conceptId: compare.data.conceptId,
      title: compare.data.canonicalTitle,
      coverUrl: compare.data.coverUrl,
    });
  }, [compare.data]);

  async function pickResult(item: SearchResultItem) {
    setResolveError(null);
    let id = item.conceptId;
    if (!id) {
      setResolving(true);
      try {
        const resolved = await api.resolveConcept(item.productId);
        id = resolved.conceptId;
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setResolving(false);
      }
    }
    if (!id) {
      setResolveError('Could not resolve this listing to a store concept. Try another search result.');
      return;
    }
    rememberRecent({ conceptId: id, title: item.name, coverUrl: item.coverUrl });
    navigate(`/games/${id}`);
  }

  function clearSelection() {
    navigate('/games');
  }

  const results = search.data?.results ?? [];

  return (
    <div>
      {!routeConceptId && (
      <PageHeader
        title="Games"
        description="Search the PlayStation Store, then compare Israel, Japan, India, and Turkey."
      />
      )}

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
              <span className="badge warn">Search Degraded</span>
              <span className="text-secondary">{search.data.degradedReason}</span>
            </div>
          )}

          {!search.isFetching && debounced.length < 2 && (
            <div style={{ marginTop: '1.25rem' }}>
              <EmptyState
                title="Search a game to compare"
                description="Enter at least two characters. Results resolve to regional store listings for Israel, Japan, India, and Turkey."
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
          {resolving && <LoadingState label="Opening store listing…" />}
          {resolveError && <ErrorState title="Could not open listing" description={resolveError} />}
          {conceptId && compare.isFetching && !compare.data && (
            <LoadingState label="Loading regional prices…" />
          )}
          {compare.isError && (
            <ErrorState description={(compare.error as Error).message} />
          )}
          {compare.data && (
            <>
              <ComparisonView
                data={compare.data}
                useGiftCards={useGiftCards}
                onToggleGiftCards={setUseGiftCards}
                onBack={clearSelection}
              />
              <PriceHistoryPanel data={compare.data} />
              <AlertRulesPanel conceptId={compare.data.conceptId} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function ComparisonView({
  data,
  useGiftCards,
  onToggleGiftCards,
  onBack,
}: {
  data: GameComparison;
  useGiftCards: boolean;
  onToggleGiftCards: (value: boolean) => void;
  onBack: () => void;
}) {
  const cardsQ = useQuery({
    queryKey: ['giftcards', 'in-stock'],
    queryFn: () => api.giftCards(new URLSearchParams({ inStock: '1' })),
    staleTime: 60_000,
  });
  const listings = cardsQ.data?.listings ?? [];

  const giftCardView = data.useGiftCards && Boolean(data.cheapestByGiftCard);
  const bestRegionId = giftCardView ? data.cheapestByGiftCard : data.cheapestByExchange;
  const bestRegion = data.regions.find((r) => r.region === bestRegionId);
  const bestPrice =
    giftCardView && bestRegion?.giftCardEstimateIls
      ? bestRegion.giftCardEstimateIls
      : bestRegion?.directIls;
  return (
    <div>
      <div className="game-hero">
        {data.coverUrl && (
          <div className="game-hero-bg" style={{ backgroundImage: `url(${data.coverUrl})` }} />
        )}
        <div className="game-hero-scrim" />
        <div className="game-hero-inner">
          {data.coverUrl ? (
            <img src={data.coverUrl} alt="" />
          ) : (
            <div className="cover-placeholder" />
          )}
          <div className="hero-copy">
            <h2>{data.canonicalTitle}</h2>
            <div className="game-hero-meta">
              <button type="button" className="btn sm ghost" onClick={onBack}>
                ← New search
              </button>
              <button
                type="button"
                className={`btn sm ${useGiftCards ? 'primary' : ''}`}
                aria-pressed={useGiftCards}
                onClick={() => onToggleGiftCards(!useGiftCards)}
              >
                {useGiftCards ? 'Showing gift card prices' : 'Show gift card prices'}
              </button>
              <WatchlistButton
                conceptId={data.conceptId}
                title={data.canonicalTitle || data.regions.find((r) => r.title)?.title || 'Game'}
                coverUrl={data.coverUrl}
                preferredProductId={
                  data.regions.find((r) => r.available && r.product)?.product?.productId ?? null
                }
              />
            </div>
          </div>
          <div className="hero-aside">
            <div className="section-title">
              {giftCardView ? 'Cheapest with gift cards' : 'Cheapest in shekels'}
            </div>
            <div className="hero-price">
              {bestPrice ? formatMoney(bestPrice) : '—'}
            </div>
            {bestRegionId && (
              <span className="badge accent">{REGION_NAMES[bestRegionId]}</span>
            )}
            {giftCardView && bestRegion && walletNote(bestRegion, true) && (
              <div className="currency-note">{walletNote(bestRegion, true)}</div>
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
          const covering = r.nativePrice
            ? coveringGiftCard(listings, r.region, r.nativePrice)
            : null;

          return (
            <article
              key={r.region}
              className={`region-card ${isBest ? 'is-best' : ''}`}
            >
              <div className="region-card-top">
                <h3>{REGION_NAMES[r.region]}</h3>
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
                        ? 'If you pay with gift cards'
                        : 'Store price in shekels'}
                    </span>
                    {walletNote(r, data.useGiftCards) && (
                      <span className="currency-note">{walletNote(r, data.useGiftCards)}</span>
                    )}
                  </div>

                  <div className="price-secondary">
                    {r.title &&
                      r.title.localeCompare(data.canonicalTitle, undefined, { sensitivity: 'accent' }) !== 0 && (
                      <div className="price-row">
                        <span className="label">Name on this store</span>
                        <span className="value" style={{ fontFamily: 'var(--font)' }}>
                          {r.title}
                        </span>
                      </div>
                    )}
                    <div className="price-row">
                      <span className="label">Price on this store</span>
                      <span className="value">
                        {r.nativePrice && covering ? (
                          <a
                            className="store-price-link"
                            href={covering.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Cheapest ${formatMoney(covering.denomination)} gift card`}
                          >
                            <strong>{formatMoney(r.nativePrice)}</strong>
                          </a>
                        ) : (
                          <strong>{r.nativePrice ? formatMoney(r.nativePrice) : '—'}</strong>
                        )}
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
                    {showShekelStorePrice(data, r, primary) && (
                      <div className="price-row">
                        <span className="label">Store price in shekels</span>
                        <span className="value">{r.directIls ? formatMoney(r.directIls) : '—'}</span>
                      </div>
                    )}
                    {showWhatYouPay(r, primary) && r.truePurchaseCost && (
                      <div className="price-row">
                        <span className="label">What you pay</span>
                        <span className="value">
                          <strong>
                            {r.truePurchaseCost.trueCostIls
                              ? formatMoney(r.truePurchaseCost.trueCostIls)
                              : 'Not enough information'}
                          </strong>
                          {payExplanation(r) && (
                            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                              {payExplanation(r)}
                            </div>
                          )}
                        </span>
                      </div>
                    )}
                    {r.region !== 'IL' && savingsLine(r, data.useGiftCards) && (
                      <div className="price-row">
                        <span className="label">Compared with Israel</span>
                        <span className="value">{savingsLine(r, data.useGiftCards)}</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {r.freshness.status !== 'fresh' && (
                <div>
                  <FreshnessBadge freshness={r.freshness} />
                </div>
              )}
            </article>
          );
        })}
      </div>

      {data.exchangeRatesUpdatedAt && (
        <p className="freshness-line">
          Shekel prices use today’s exchange rate, updated{' '}
          {new Date(data.exchangeRatesUpdatedAt).toLocaleString()}
          {data.exchangeRatesCached ? ' (saved copy)' : ''}.
        </p>
      )}
    </div>
  );
}
