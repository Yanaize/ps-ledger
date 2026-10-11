import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PRODUCT_NAME } from '../brand';
import { api } from '../api/client';
import { IconBell, IconCard, IconClose, IconHome, IconMenu, IconPlus, IconSearch, IconSettings, IconWatch } from './Icons';
import { CommandSearch } from './CommandSearch';

const NAV = [
  { to: '/', label: 'Home', end: true, icon: IconHome },
  { to: '/games', label: 'Games', icon: IconSearch },
  { to: '/watchlist', label: 'Watchlist', icon: IconWatch },
  { to: '/alerts', label: 'Alerts', icon: IconBell },
  { to: '/catalog', label: 'PS Plus', icon: IconPlus },
  { to: '/gift-cards', label: 'Gift cards', icon: IconCard },
  { to: '/settings', label: 'Settings', icon: IconSettings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const unread = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: api.alertUnread,
    refetchInterval: 60_000,
  });
  const count = unread.data?.count ?? 0;
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!('startViewTransition' in document)) return;
    document.documentElement.dataset.path = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', menuOpen);
    return () => document.body.classList.remove('nav-open');
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand" aria-label={PRODUCT_NAME}>
          <img className="brand-logo" src="/logo.png" alt="" />
          <span className="brand-name">
            PS<span className="brand-ledger">Ledger</span>
          </span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false}>
                <Icon />
                <span className="label">{item.label}</span>
                {item.to === '/alerts' && count > 0 && <span className="nav-count">{count}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="header-tools">
          <button type="button" className="nav-search" aria-label="Search" onClick={() => { setMenuOpen(false); setSearchOpen(true); }}>
            <IconSearch />
            <span className="nav-search-label">Search</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            type="button"
            className="nav-menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <IconClose /> : <IconMenu />}
            <span>{menuOpen ? 'Close' : 'Menu'}</span>
          </button>
        </div>
      </header>
      {menuOpen && (
        <nav className="mobile-nav" id="mobile-nav" aria-label="Mobile">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} onClick={() => setMenuOpen(false)}>
                <Icon />
                <span>{item.label}</span>
                {item.to === '/alerts' && count > 0 && <span className="nav-count">{count}</span>}
              </NavLink>
            );
          })}
        </nav>
      )}
      <main className="app-main">{children}</main>
      {searchOpen && (
        <CommandSearch
          onClose={() => setSearchOpen(false)}
          onOpen={(conceptId) => {
            setSearchOpen(false);
            navigate(`/games/${conceptId}`);
          }}
        />
      )}
    </div>
  );
}
