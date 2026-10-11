import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, type CatalogRegion, type WatchlistEntry } from '@ps-price-compare/shared';
import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';

const REGION_NAMES: Record<string, string> = {
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
  IL: 'Israel',
};

type FilterId = 'sale' | 'plus' | 'noplus';

type SortId = 'added' | 'name' | 'price' | 'discount' | 'change';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'sale', label: 'On sale' },
  { id: 'plus', label: 'On PS Plus' },
  { id: 'noplus', label: 'Not on PS Plus' },
];

function plusLabel(regions: CatalogRegion[]): string {
  if (regions.length === 0) return 'No';
  return regions.map((r) => `${REGION_NAMES[r] ?? r} Extra`).join(', ');
}

function daysAgo(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function matches(item: WatchlistEntry, filters: FilterId[]): boolean {
  if (filters.length === 0) return true;
  return filters.every((f) => {
    if (f === 'sale') return item.discountPct != null && item.discountPct > 0;
    if (f === 'plus') return item.psPlusRegions.length > 0;
    return item.psPlusRegions.length === 0;
  });
}

export function WatchlistPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['watchlist'], queryFn: api.watchlist });
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterId[]>([]);
  const [sort, setSort] = useState<SortId>('added');

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let list = (q.data?.items ?? []).filter((item) => {
      if (needle && !item.title.toLowerCase().includes(needle)) return false;
      return matches(item, filters);
    });
    list = [...list].sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title);
      if (sort === 'price') {
        return (a.currentBest?.amountMinor ?? Infinity) - (b.currentBest?.amountMinor ?? Infinity);
      }
      if (sort === 'discount') return (b.discountPct ?? -1) - (a.discountPct ?? -1);
      if (sort === 'change') {
        return (b.lastPriceChangeAt ?? '').localeCompare(a.lastPriceChangeAt ?? '');
      }
      return b.addedAt.localeCompare(a.addedAt);
    });
    return list;
  }, [q.data, search, filters, sort]);

  return (
    <div>
      <PageHeader
        title="Watchlist"
        description="Games you are following. Adding a game starts price tracking. Removing it keeps the history already recorded."
      />

      <div className="watchlist-filters">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Filter watchlist…"
          aria-label="Filter watchlist"
        />
        <div className="list-controls">
          <label className="sort-field">
            <span className="gc-amount-label">Show</span>
            <select
              className="select"
              value={filters[0] ?? ''}
              onChange={(e) => setFilters(e.target.value ? [e.target.value as FilterId] : [])}
              aria-label="Show"
            >
              <option value="">All games</option>
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sort-field">
            <span className="gc-amount-label">Sort</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortId)}>
              <option value="added">Recently added</option>
              <option value="name">Name</option>
              <option value="price">Current best</option>
              <option value="discount">Discount</option>
              <option value="change">Last price change</option>
            </select>
          </label>
        </div>
      </div>

      {q.isLoading && <LoadingState label="Loading watchlist…" />}
      {q.isError && <ErrorState description={(q.error as Error).message} />}
      {q.data && q.data.items.length === 0 && (
        <EmptyState
          title="Nothing on your watchlist"
          description="Open a game in Price Comparison and choose Add to watchlist. Prices are collected in the background from then on."
        />
      )}
      {q.data && q.data.items.length > 0 && rows.length === 0 && (
        <EmptyState title="No games match these filters" description="Clear a filter or search to see the rest of the list." />
      )}

      {rows.length > 0 && (
        <div className="table-wrap watchlist-table">
          <table className="data">
            <thead>
              <tr>
                <th>Game</th>
                <th>Current best</th>
                <th>Region</th>
                <th>Discount</th>
                <th>Lowest recorded</th>
                <th>Vs lowest</th>
                <th>PS+</th>
                <th>Last change</th>
                <th>Last checked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr
                  key={item.conceptId}
                  className="wl-row"
                  onClick={() => navigate(`/games/${item.conceptId}`)}
                >
                  <td>
                    <Link
                      to={`/games/${item.conceptId}`}
                      className="wl-game"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.coverUrl ? (
                        <img src={item.coverUrl} alt="" />
                      ) : (
                        <span className="cover-placeholder" />
                      )}
                      <span>{item.title}</span>
                    </Link>
                  </td>
                  <td data-label="Current best">
                    <span className="mono">{item.currentBest ? formatMoney(item.currentBest) : '—'}</span>
                  </td>
                  <td data-label="Region">
                    <span>{item.cheapestRegion ? REGION_NAMES[item.cheapestRegion] : '—'}</span>
                  </td>
                  <td data-label="Discount">
                    <span className="mono">
                      {item.discountPct != null && item.discountPct > 0 ? `−${item.discountPct}%` : '—'}
                    </span>
                  </td>
                  <td data-label="Lowest recorded">
                    <span className="mono">
                      {item.lowestRecorded ? formatMoney(item.lowestRecorded) : '—'}
                    </span>
                  </td>
                  <td data-label="Vs lowest">
                    <span className="mono">
                      {item.deltaFromLowestIls ? formatMoney(item.deltaFromLowestIls) : '—'}
                    </span>
                  </td>
                  <td data-label="PS+">
                    <span>{plusLabel(item.psPlusRegions)}</span>
                  </td>
                  <td data-label="Last change">
                    <span>{daysAgo(item.lastPriceChangeAt)}</span>
                  </td>
                  <td data-label="Last checked">
                    <span>{daysAgo(item.lastCheckedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
