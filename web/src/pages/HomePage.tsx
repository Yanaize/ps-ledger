import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@ps-price-compare/shared';
import { api } from '../api/client';
import { readRecent } from '../recent';
import { CommandSearch } from '../components/CommandSearch';

export function HomePage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const watch = useQuery({ queryKey: ['watchlist'], queryFn: api.watchlist });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: api.alerts });
  const cards = useQuery({ queryKey: ['giftcard-summary'], queryFn: api.giftCardSummary });
  const recent = readRecent();
  const items = watch.data?.items ?? [];
  const featured = items[0];
  const deals = items.filter((g) => (g.discountPct ?? 0) > 0 || g.atLowestRecorded);
  const plus = (watch.data?.items ?? []).filter((g) => g.psPlusRegions.length > 0);
  const unread = (alerts.data?.items ?? []).filter((a) => !a.viewed_at).slice(0, 4);

  return (
    <div>
      <section className="home-hero">
        <div className="home-hero-inner">
          <div>
            <h1>Find the best way to play.</h1>
            <p>
              Regional PlayStation prices, gift-card funding, PS Plus Extra, recorded history, and what a purchase actually costs in ₪.
            </p>
            <div className="home-search">
              <button type="button" className="nav-search" style={{ width: '100%', height: 52, justifyContent: 'flex-start' }} onClick={() => setOpen(true)}>
                Search PlayStation games…
              </button>
            </div>
          </div>
          {featured ? (
            <Link to={`/games/${featured.conceptId}`} className="home-hero-side">
              {featured.coverUrl ? <img src={featured.coverUrl} alt="" /> : <div className="cover-placeholder" />}
              <div>
                <div className="section-title" style={{ marginBottom: 6 }}>Watching</div>
                <div style={{ fontWeight: 500 }}>{featured.title}</div>
                <div className="hero-price" style={{ fontSize: '1.6rem' }}>
                  {featured.currentBest ? formatMoney(featured.currentBest) : '—'}
                </div>
                <div className="result-meta">
                  {featured.cheapestRegion ?? ''}
                  {featured.discountPct ? ` · −${featured.discountPct}%` : ''}
                  {featured.atLowestRecorded ? ' · Lowest recorded' : ''}
                </div>
              </div>
            </Link>
          ) : (
            <aside className="home-hero-side">
              <div className="home-regions" style={{ gridColumn: '1 / -1' }}>
                <span>Israel</span>
                <span>Japan</span>
                <span>India</span>
                <span>Turkey</span>
              </div>
            </aside>
          )}
        </div>
      </section>

      {open && (
        <CommandSearch
          onClose={() => setOpen(false)}
          onOpen={(id) => {
            setOpen(false);
            navigate(`/games/${id}`);
          }}
        />
      )}

      <div className="rail-head">
        <h2>Watchlist</h2>
        <Link to="/watchlist">View all</Link>
      </div>
      {watch.isLoading && (
        <div className="rail-skeleton" aria-hidden>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {(watch.data?.items.length ?? 0) === 0 && !watch.isLoading && (
        <p className="muted">Nothing watched yet. Search a game and add it.</p>
      )}
      <div className="rail">
        {(deals.length ? deals : watch.data?.items ?? []).slice(0, 10).map((g) => (
          <Link key={g.conceptId} to={`/games/${g.conceptId}`} className="rail-card">
            {g.coverUrl ? <img src={g.coverUrl} alt="" /> : <div className="cover-placeholder" />}
            <div className="body">
              <div className="title">{g.title}</div>
              <div className="price">{g.currentBest ? formatMoney(g.currentBest) : '—'}</div>
              <div className="result-meta">
                {g.atLowestRecorded ? 'Lowest recorded' : g.discountPct ? `−${g.discountPct}%` : g.cheapestRegion ?? ''}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="home-band">
        <section className="panel">
          <h2 className="section-title">Alerts</h2>
          {unread.length === 0 && <p className="muted">No unread alerts.</p>}
          <ul className="alert-list">
            {unread.map((a) => (
              <li key={a.id}>
                <div className="alert-row-title">{a.title}</div>
                <div className="result-meta">{a.trigger_kind} · {a.region}</div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2 className="section-title">Gift card market</h2>
          {(cards.data?.summaries ?? []).map((s) => (
            <div key={s.region} className="price-row">
              <span>{s.region}</span>
              <span className="mono">
                {s.bestAvailableIlsPer1000 != null ? `₪${s.bestAvailableIlsPer1000.toFixed(2)} / 1000` : 'No fresh listing'}
              </span>
            </div>
          ))}
          {(cards.data?.summaries.length ?? 0) === 0 && <p className="muted">No gift-card summary yet.</p>}
        </section>
      </div>

      {plus.length > 0 && (
        <>
          <div className="rail-head"><h2>On PS Plus Extra</h2></div>
          <div className="rail">
            {plus.slice(0, 8).map((g) => (
              <Link key={g.conceptId} to={`/games/${g.conceptId}`} className="rail-card">
                {g.coverUrl ? <img src={g.coverUrl} alt="" /> : <div className="cover-placeholder" />}
                <div className="body">
                  <div className="title">{g.title}</div>
                  <div className="result-meta">{g.psPlusRegions.join(', ')}</div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {recent.length > 0 && (
        <>
          <div className="rail-head"><h2>Recently viewed</h2></div>
          <div className="rail">
            {recent.map((g) => (
              <Link key={g.conceptId} to={`/games/${g.conceptId}`} className="rail-card">
                {g.coverUrl ? <img src={g.coverUrl} alt="" /> : <div className="cover-placeholder" />}
                <div className="body"><div className="title">{g.title}</div></div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
