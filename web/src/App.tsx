import { PRODUCT_NAME } from './brand';
import { AppShell } from './components/AppShell';
import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { PriceComparisonPage } from './pages/PriceComparisonPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { AlertsPage } from './pages/AlertsPage';
import { GiftCardsPage } from './pages/GiftCardsPage';
import { CatalogPage } from './pages/CatalogPage';
import { ThemeLabPage } from './pages/ThemeLabPage';
import { SettingsPage } from './pages/SettingsPage';
import { api } from './api/client';
import { applyAppearance, readStoredAppearance } from './theme';

export function App() {
  useEffect(() => {
    document.title = PRODUCT_NAME;
    void api.status().catch(() => {});
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onScheme = () => {
      if (localStorage.getItem('ps-ledger-follow-system') === '1') {
        applyAppearance({ ...readStoredAppearance(), followSystem: true });
      }
    };
    mq.addEventListener('change', onScheme);
    return () => mq.removeEventListener('change', onScheme);
  }, []);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/games" element={<PriceComparisonPage />} />
        <Route path="/games/:conceptId" element={<PriceComparisonPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/gift-cards" element={<GiftCardsPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {import.meta.env.DEV && <Route path="/dev/themes" element={<ThemeLabPage />} />}
      </Routes>
    </AppShell>
  );
}
