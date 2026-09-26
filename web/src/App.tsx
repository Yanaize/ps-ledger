import { PRODUCT_NAME } from './brand';
import { AppShell } from './components/AppShell';
import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PriceComparisonPage } from './pages/PriceComparisonPage';
import { GiftCardsPage } from './pages/GiftCardsPage';
import { CatalogPage } from './pages/CatalogPage';
import { SettingsPage } from './pages/SettingsPage';
import { api } from './api/client';

export function App() {
  useEffect(() => {
    document.title = PRODUCT_NAME;
    void api.status().catch(() => {});
  }, []);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<PriceComparisonPage />} />
        <Route path="/gift-cards" element={<GiftCardsPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppShell>
  );
}
