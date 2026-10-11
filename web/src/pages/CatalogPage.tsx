import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CatalogRegion } from '@ps-price-compare/shared';
import { api } from '../api/client';
import { FreshnessBadge } from '../components/FreshnessBadge';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';

const REGION_NAMES: Record<CatalogRegion, string> = {
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
  IL: 'Israel',
};

type View =
  | 'full'
  | 'popular'
  | 'differences'
  | 'all_regions'
  | CatalogRegion;

type SortKey = 'name' | 'regions' | 'popular';

const ROW_HEIGHT = 52;
const CARD_HEIGHT = 96;

export function CatalogPage() {
  const [view, setView] = useState<View>('full');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [hidden, setHidden] = useState<CatalogRegion[]>([]);
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const params = new URLSearchParams({
    view,
    sort,
  });
  if (search) params.set('search', search);

  const q = useQuery({
    queryKey: ['catalog', view, search, sort],
    queryFn: () => api.catalog(params),
  });

  const regions = (q.data?.regions ?? (['JP', 'IN', 'TR', 'IL'] as CatalogRegion[])).filter(
    (r) => !hidden.includes(r),
  );
  const games = q.data?.games ?? [];
  const colCount = 2 + regions.length;

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: games.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (narrow ? CARD_HEIGHT : ROW_HEIGHT),
    overscan: 12,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const visibleCols = useMemo(() => regions, [regions]);

  return (
    <div>
      <PageHeader
        title="PS Plus Extra Catalog"
        description="Availability matrix across Japan, India, Turkey, and Israel. Use Regional differences to find titles that are not listed everywhere."
      />

      <div className="catalog-toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search games…"
          aria-label="Search catalog by game name"
        />
        <div className="catalog-toolbar-row">
          <label className="sort-field">
            <span className="gc-amount-label">Show</span>
            <select
              className="select"
              value={view}
              onChange={(e) => setView(e.target.value as View)}
              aria-label="Show"
            >
              <option value="full">Full catalog</option>
              <option value="differences">Regional differences</option>
              <option value="popular">Popular</option>
              <option value="all_regions">All four regions</option>
              <option value="JP">Japan only</option>
              <option value="IN">India only</option>
              <option value="TR">Turkey only</option>
              <option value="IL">Israel only</option>
            </select>
          </label>
          <label className="sort-field">
            <span className="gc-amount-label">Sort</span>
            <select
              className="select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort catalog"
            >
              <option value="name">A–Z</option>
              <option value="regions">Number of regions</option>
              <option value="popular">Most popular</option>
            </select>
          </label>
        </div>
        <div className="column-toggles">
          <span className="gc-amount-label">Columns</span>
          {(['JP', 'IN', 'TR', 'IL'] as CatalogRegion[]).map((r) => (
            <label key={r} className="check-label">
              <input
                type="checkbox"
                checked={!hidden.includes(r)}
                onChange={(e) => {
                  setHidden((prev) =>
                    e.target.checked ? prev.filter((x) => x !== r) : [...prev, r],
                  );
                }}
              />
              {REGION_NAMES[r]}
            </label>
          ))}
        </div>
      </div>

      {q.data && (
        <div
          className="text-secondary"
          style={{ fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}
        >
          <span>
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{q.data.totalCount}</strong>{' '}
            games
          </span>
          {q.data.regions
            .filter((r) => q.data!.lastUpdated[r].status !== 'fresh')
            .map((r) => (
            <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {REGION_NAMES[r]}
              <FreshnessBadge freshness={q.data!.lastUpdated[r]} />
            </span>
          ))}
        </div>
      )}

      {q.isLoading && <LoadingState label="Loading catalog…" />}
      {q.isError && <ErrorState description={(q.error as Error).message} />}
      {!q.isLoading && games.length === 0 && !q.isError && (
        <EmptyState
          title={view === 'differences' ? 'No regional differences' : 'No catalog data'}
          description={
            view === 'differences'
              ? 'Every listed title appears in all visible regions, or the catalog has not been refreshed yet.'
              : 'Open Settings / Data and refresh PS Plus catalogs.'
          }
        />
      )}

      {games.length > 0 && narrow && (
        <div className="catalog-cards">
          {games.map((g) => (
            <article key={g.conceptId} className="catalog-card">
              <div className="catalog-card-name" title={g.nameEn && g.nameEn !== g.name ? g.nameEn : g.name}>
                {g.name}
                {g.isStarred && <span className="badge accent">Starred</span>}
                {g.isPopular && !g.isStarred && <span className="badge neutral">Popular</span>}
              </div>
              <div className="catalog-card-regions">
                {visibleCols.map((r) => {
                  const yes = g.availability[r];
                  return (
                    <span key={r} className={yes ? 'yes' : 'no'}>
                      {REGION_NAMES[r]} {yes ? '✓' : '–'}
                    </span>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}

      {games.length > 0 && !narrow && (
        <>
        <p className="scroll-hint">Swipe sideways to see every column.</p>
        <div className="table-wrap catalog-scroll" ref={parentRef}>
          <table className="data catalog-table">
            <colgroup>
              <col className="catalog-col-game" />
              {visibleCols.map((r) => (
                <col key={r} className="catalog-col-region" />
              ))}
              <col className="catalog-col-count" />
            </colgroup>
            <thead>
              <tr>
                <th className="sticky">Game</th>
                {visibleCols.map((r) => (
                  <th key={r}>{REGION_NAMES[r]}</th>
                ))}
                <th className="num">#</th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr aria-hidden="true" className="virt-spacer">
                  <td
                    colSpan={colCount}
                    style={{ height: paddingTop, padding: 0, border: 0 }}
                  />
                </tr>
              )}
              {virtualRows.map((vRow) => {
                const g = games[vRow.index];
                return (
                  <tr key={g.conceptId} data-index={vRow.index}>
                    <td
                      className="sticky"
                      title={g.nameEn && g.nameEn !== g.name ? g.nameEn : g.name}
                    >
                      {g.name}
                      {g.isStarred && (
                        <span className="badge accent" style={{ marginLeft: 6 }}>
                          Starred
                        </span>
                      )}
                      {g.isPopular && !g.isStarred && (
                        <span className="badge neutral" style={{ marginLeft: 6 }}>
                          Popular
                        </span>
                      )}
                    </td>
                    {visibleCols.map((r) => {
                      const yes = g.availability[r];
                      return (
                        <td key={r}>
                          <span
                            className={`avail ${yes ? 'yes' : 'no'}`}
                            title={yes ? 'Available' : 'Not listed'}
                          >
                            <span className="avail-icon" aria-hidden>
                              {yes ? '✓' : '–'}
                            </span>
                            <span className="avail-label">{yes ? 'Yes' : 'No'}</span>
                          </span>
                        </td>
                      );
                    })}
                    <td className="num">{g.regionCount}</td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden="true" className="virt-spacer">
                  <td
                    colSpan={colCount}
                    style={{ height: paddingBottom, padding: 0, border: 0 }}
                  />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
