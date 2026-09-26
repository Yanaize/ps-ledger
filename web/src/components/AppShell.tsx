import { NavLink, Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '../brand';

const NAV = [
  { to: '/', label: 'Price Comparison', end: true },
  { to: '/gift-cards', label: 'Gift Cards' },
  { to: '/catalog', label: 'PS Plus Extra Catalog' },
  { to: '/settings', label: 'Settings / Data' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand" aria-label={PRODUCT_NAME}>
          <span className="brand-mark" aria-hidden>
            PS
          </span>
          <span className="brand-name">{PRODUCT_NAME}</span>
          <span className="brand-tag">{PRODUCT_TAGLINE}</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
