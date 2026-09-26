import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMoney,
  toMajor,
  type GiftCardListing,
  type PriceRegion,
} from '@ps-price-compare/shared';
import { api } from '../api/client';
import { FreshnessBadge } from '../components/FreshnessBadge';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';

const REGIONS: PriceRegion[] = ['JP', 'IN', 'TR'];

const REGION_META: Record<
  PriceRegion,
  { name: string; currency: string; symbol: string }
> = {
  JP: { name: 'Japan', currency: 'JPY', symbol: '¥' },
  IN: { name: 'India', currency: 'INR', symbol: '₹' },
  TR: { name: 'Turkey', currency: 'TRY', symbol: '₺' },
};

function listingIlsMinor(l: GiftCardListing): number {
  if (l.price.currency === 'ILS') return l.price.amountMinor;
  return Infinity;
}

function isBuyable(l: GiftCardListing): boolean {
  if (l.stockStatus !== 'in_stock') return false;
  if (l.freshness.status === 'stale' || l.freshness.status === 'unavailable') return false;
  return listingIlsMinor(l) < Infinity;
}

function pickBest(listings: GiftCardListing[]): GiftCardListing | null {
  const buyable = listings.filter(isBuyable).sort((a, b) => listingIlsMinor(a) - listingIlsMinor(b));
  if (buyable[0]) return buyable[0];
  const any = [...listings].sort((a, b) => listingIlsMinor(a) - listingIlsMinor(b));
  return any[0] ?? null;
}

function stockLabel(l: GiftCardListing): { text: string; tone: string } {
  if (l.freshness.status === 'stale' || l.freshness.status === 'unavailable') {
    return { text: 'Stale data', tone: 'stale' };
  }
  if (l.stockStatus === 'in_stock') return { text: 'In stock', tone: 'in_stock' };
  if (l.stockStatus === 'out_of_stock') return { text: 'Out of stock', tone: 'out_of_stock' };
  return { text: 'Stock unknown', tone: 'unknown' };
}

export function GiftCardsPage() {
  const qc = useQueryClient();
  const [selectedDenom, setSelectedDenom] = useState<Record<PriceRegion, number | null>>({
    JP: null,
    IN: null,
    TR: null,
  });
  const [showManual, setShowManual] = useState(false);

  const listingsQ = useQuery({
    queryKey: ['giftcards'],
    queryFn: () => api.giftCards(new URLSearchParams()),
  });
  const summaryQ = useQuery({
    queryKey: ['giftcard-summary'],
    queryFn: () => api.giftCardSummary(),
  });

  const addManual = useMutation({
    mutationFn: api.addManualGiftCard,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['giftcards'] });
      qc.invalidateQueries({ queryKey: ['giftcard-summary'] });
      setShowManual(false);
    },
  });

  const byRegion = useMemo(() => {
    const map: Record<PriceRegion, GiftCardListing[]> = { JP: [], IN: [], TR: [] };
    for (const l of listingsQ.data?.listings ?? []) {
      map[l.region].push(l);
    }
    return map;
  }, [listingsQ.data]);

  const denomsByRegion = useMemo(() => {
    const out: Record<PriceRegion, number[]> = { JP: [], IN: [], TR: [] };
    for (const region of REGIONS) {
      const set = new Set<number>();
      for (const l of byRegion[region]) set.add(l.denomination.amountMinor);
      out[region] = [...set].sort((a, b) => a - b);
    }
    return out;
  }, [byRegion]);

  // Default each region to a sensible denomination once data loads
  useEffect(() => {
    setSelectedDenom((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const region of REGIONS) {
        const denoms = denomsByRegion[region];
        if (!denoms.length) continue;
        if (next[region] != null && denoms.includes(next[region]!)) continue;
        // Prefer a common mid-tier face value when available
        const majors = denoms.map((d) => ({
          d,
          major: toMajor({ amountMinor: d, currency: REGION_META[region].currency as 'JPY' | 'INR' | 'TRY' }),
        }));
        const preferred =
          majors.find((x) => x.major === 10000)?.d ??
          majors.find((x) => x.major === 5000)?.d ??
          majors.find((x) => x.major === 3000)?.d ??
          majors.find((x) => x.major === 1000)?.d ??
          denoms[Math.floor(denoms.length / 2)] ??
          denoms[0];
        next[region] = preferred;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [denomsByRegion]);

  const summaryByRegion = useMemo(() => {
    const map = new Map(
      (summaryQ.data?.summaries ?? []).map((s) => [s.region, s] as const),
    );
    return map;
  }, [summaryQ.data]);

  const bestRates = useMemo(() => {
    const rates: Partial<Record<PriceRegion, number>> = {};
    for (const region of REGIONS) {
      const denom = selectedDenom[region];
      if (denom == null) continue;
      const best = pickBest(byRegion[region].filter((l) => l.denomination.amountMinor === denom));
      if (best?.effectiveRatePer1000 != null) rates[region] = best.effectiveRatePer1000;
    }
    return rates;
  }, [byRegion, selectedDenom]);

  const cheapestRegion = useMemo(() => {
    let best: PriceRegion | null = null;
    let bestRate = Infinity;
    for (const region of REGIONS) {
      const r = bestRates[region];
      if (r != null && r < bestRate) {
        bestRate = r;
        best = region;
      }
    }
    return best;
  }, [bestRates]);

  return (
    <div>
      <PageHeader
        title="Gift Cards"
        description="Pick a card amount for each region and see the best available purchase price in ₪."
      />

      {listingsQ.isLoading && <LoadingState label="Loading gift cards…" />}
      {listingsQ.isError && (
        <ErrorState description={(listingsQ.error as Error).message} />
      )}
      {!listingsQ.isLoading &&
        !listingsQ.isError &&
        (listingsQ.data?.listings.length ?? 0) === 0 && (
          <EmptyState
            title="No gift-card data yet"
            description="Refresh gift cards from Settings / Data, or add a manual observation."
            action={
              <button type="button" className="btn" onClick={() => setShowManual(true)}>
                Add observation
              </button>
            }
          />
        )}

      {(listingsQ.data?.listings.length ?? 0) > 0 && (
        <div className="gc-grid">
          {REGIONS.map((region) => {
            const meta = REGION_META[region];
            const denoms = denomsByRegion[region];
            const denom = selectedDenom[region];
            const candidates =
              denom == null
                ? []
                : byRegion[region].filter((l) => l.denomination.amountMinor === denom);
            const best = pickBest(candidates);
            const summary = summaryByRegion.get(region);
            const isBestRegion = cheapestRegion === region && best && isBuyable(best);
            const stock = best ? stockLabel(best) : null;

            return (
              <article
                key={region}
                className={`gc-card ${isBestRegion ? 'is-best' : ''}`}
              >
                <div className="gc-card-top">
                  <div>
                    <h3>{meta.name}</h3>
                    <div className="gc-currency">{meta.currency} wallet</div>
                  </div>
                  {isBestRegion && <span className="badge ok">Best rate</span>}
                </div>

                <label className="gc-amount">
                  <span className="gc-amount-label">Card amount</span>
                  <select
                    className="select"
                    value={denom ?? ''}
                    disabled={!denoms.length}
                    onChange={(e) =>
                      setSelectedDenom((prev) => ({
                        ...prev,
                        [region]: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    aria-label={`${meta.name} gift card amount`}
                  >
                    {!denoms.length && <option value="">No amounts available</option>}
                    {denoms.map((d) => (
                      <option key={d} value={d}>
                        {formatMoney({ amountMinor: d, currency: meta.currency as 'JPY' | 'INR' | 'TRY' })}
                      </option>
                    ))}
                  </select>
                </label>

                {!best ? (
                  <div className="gc-empty">No listing for this amount</div>
                ) : (
                  <>
                    <div className="gc-price">
                      {best.price.currency === 'ILS'
                        ? formatMoney(best.price)
                        : best.effectiveRatePer1000 != null && denom != null
                          ? `₪${((best.effectiveRatePer1000 * toMajor({ amountMinor: denom, currency: best.denomination.currency })) / 1000).toFixed(2)}`
                          : formatMoney(best.price)}
                      <span className="gc-price-note">Best available purchase</span>
                    </div>

                    <div className="gc-details">
                      <div className="gc-row">
                        <span>Seller</span>
                        <span>
                          {best.sellerName}
                          <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>
                            {best.isManual ? 'Manual' : best.providerDisplayName}
                          </span>
                        </span>
                      </div>
                      <div className="gc-row">
                        <span>Markup vs FX</span>
                        <span className="mono">
                          {best.markupPercent != null
                            ? `${best.markupPercent >= 0 ? '+' : ''}${best.markupPercent.toFixed(1)}%`
                            : '—'}
                        </span>
                      </div>
                      <div className="gc-row">
                        <span>Effective /1k</span>
                        <span className="mono">
                          {best.effectiveRatePer1000 != null
                            ? `₪${best.effectiveRatePer1000.toFixed(2)}`
                            : '—'}
                        </span>
                      </div>
                      {summary?.marketRateIlsPer1000 != null && (
                        <div className="gc-row">
                          <span>Market FX /1k</span>
                          <span className="mono">
                            ₪{summary.marketRateIlsPer1000.toFixed(2)}
                          </span>
                        </div>
                      )}
                      <div className="gc-row">
                        <span>Stock</span>
                        <span className={`stock-pill ${stock?.tone ?? 'unknown'}`}>
                          <span className="status-dot" aria-hidden />
                          {stock?.text ?? '—'}
                        </span>
                      </div>
                    </div>

                    <div className="gc-footer">
                      <FreshnessBadge freshness={best.freshness} />
                      <a
                        className="btn sm"
                        href={best.productUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open listing
                      </a>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="gc-manual-toggle">
        <button
          type="button"
          className="btn ghost"
          onClick={() => setShowManual((v) => !v)}
        >
          {showManual ? 'Hide manual entry' : 'Add manual observation'}
        </button>
      </div>

      {showManual && (
        <ManualEntryForm
          onSubmit={(body) => addManual.mutate(body)}
          busy={addManual.isPending}
        />
      )}
    </div>
  );
}

function ManualEntryForm({
  onSubmit,
  busy,
}: {
  onSubmit: (body: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [region, setRegion] = useState<PriceRegion>('JP');
  const [denom, setDenom] = useState('10000');
  const [seller, setSeller] = useState('');
  const [url, setUrl] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('ILS');
  const [stock, setStock] = useState<'in_stock' | 'out_of_stock' | 'unknown'>(
    'unknown',
  );

  return (
    <div className="panel" style={{ marginTop: '0.75rem' }}>
      <div className="panel-header">
        <div>
          <h3>Manual observation</h3>
          <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            Record a price or stock check. Stock stays unknown unless you set it.
          </p>
        </div>
      </div>
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <select
          className="select"
          value={region}
          onChange={(e) => setRegion(e.target.value as PriceRegion)}
        >
          <option value="JP">Japan</option>
          <option value="IN">India</option>
          <option value="TR">Turkey</option>
        </select>
        <input
          className="input"
          placeholder="Denomination (major)"
          value={denom}
          onChange={(e) => setDenom(e.target.value)}
        />
        <input
          className="input"
          placeholder="Seller name"
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
        />
        <input
          className="input"
          placeholder="Product URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ minWidth: 180 }}
        />
        <input
          className="input"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="ILS">ILS</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
        <select
          className="select"
          value={stock}
          onChange={(e) => setStock(e.target.value as typeof stock)}
        >
          <option value="unknown">Unknown</option>
          <option value="in_stock">In stock</option>
          <option value="out_of_stock">Out of stock</option>
        </select>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !seller || !url || !price}
          onClick={() =>
            onSubmit({
              region,
              denomMajor: Number(denom),
              sellerName: seller,
              productUrl: url,
              priceMajor: Number(price),
              priceCurrency: currency,
              stockStatus: stock,
            })
          }
        >
          Save entry
        </button>
      </div>
    </div>
  );
}
