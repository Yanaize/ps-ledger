import { readUserId } from '../localUser';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('x-ps-ledger-user', readUserId());
  // Fastify rejects Content-Type: application/json with an empty body
  if (init?.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => request<import('@ps-price-compare/shared').AppStatus>('/api/status'),
  search: (q: string) =>
    request<{
      results: import('@ps-price-compare/shared').SearchResultItem[];
      fromCache: boolean;
      degraded: boolean;
      degradedReason: string | null;
    }>(`/api/games/search?q=${encodeURIComponent(q)}`),
  resolveConcept: (productId: string) =>
    request<{ productId: string; conceptId: string | null }>(
      `/api/games/resolve-concept?productId=${encodeURIComponent(productId)}`,
    ),
  compare: (conceptId: string, useGiftCards: boolean, wallets?: string) =>
    request<import('@ps-price-compare/shared').GameComparison>(
      `/api/games/${conceptId}/compare?useGiftCards=${useGiftCards ? '1' : '0'}${
        wallets ? `&wallets=${encodeURIComponent(wallets)}` : ''
      }`,
    ),
  giftCards: (params: URLSearchParams) =>
    request<{ listings: import('@ps-price-compare/shared').GiftCardListing[] }>(
      `/api/giftcards?${params}`,
    ),
  giftCardSummary: () =>
    request<{
      summaries: import('@ps-price-compare/shared').GiftCardRegionSummary[];
    }>('/api/giftcards/summary'),
  catalog: (params: URLSearchParams) =>
    request<import('@ps-price-compare/shared').CatalogResponse>(
      `/api/catalog?${params}`,
    ),
  rates: () =>
    request<import('@ps-price-compare/shared').ExchangeRatesSnapshot>('/api/rates'),
  refresh: (dataset: string) =>
    request<import('@ps-price-compare/shared').RefreshResult>(
      `/api/refresh/${dataset}`,
      { method: 'POST', body: '{}' },
    ),
  prefs: () =>
    request<{
      starredConcepts: string[];
      useGiftCardsDefault: boolean;
      hiddenCatalogRegions: string[];
      minSavingsIlsMinor: number;
      minSavingsPct: number;
      theme?: string;
      accent?: string;
      followSystem?: boolean;
      highContrast?: boolean;
      customAccent?: string | null;
    }>('/api/prefs'),
  setPrefs: (body: Record<string, unknown>) =>
    request<{ ok: boolean }>('/api/prefs', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  addManualGiftCard: (body: Record<string, unknown>) =>
    request<{ ok: boolean; id: string }>('/api/giftcards/manual', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  history: (
    conceptId: string,
    opts: {
      regions?: string[];
      range?: string;
      mode?: string;
      productIds?: string[];
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.regions?.length) params.set('regions', opts.regions.join(','));
    if (opts.range) params.set('range', opts.range);
    if (opts.mode) params.set('mode', opts.mode);
    if (opts.productIds?.length) params.set('productIds', opts.productIds.join(','));
    const q = params.toString();
    return request<import('@ps-price-compare/shared').PriceHistoryChartResponse>(
      `/api/games/${conceptId}/history${q ? `?${q}` : ''}`,
    );
  },
  historySummary: (conceptId: string, productId: string, region: string) =>
    request<import('@ps-price-compare/shared').PriceHistorySummary>(
      `/api/games/${conceptId}/history/summary?productId=${encodeURIComponent(productId)}&region=${encodeURIComponent(region)}`,
    ),
  tracking: () =>
    request<{
      games: import('@ps-price-compare/shared').TrackedGame[];
      status: import('@ps-price-compare/shared').TrackingStatus;
    }>('/api/tracking'),
  trackingFor: (conceptId: string) =>
    request<{ tracking: import('@ps-price-compare/shared').TrackedGame | null }>(
      `/api/tracking/${conceptId}`,
    ),
  trackGame: (body: {
    conceptId: string;
    title: string;
    coverUrl?: string | null;
    preferredProductId?: string | null;
  }) =>
    request<{ ok: boolean; tracking: import('@ps-price-compare/shared').TrackedGame }>(
      '/api/tracking',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  untrackGame: (conceptId: string) =>
    request<{ ok: boolean }>(`/api/tracking/${conceptId}`, { method: 'DELETE' }),
  refreshTrackedGame: (conceptId: string) =>
    request<{ ok: boolean }>(`/api/tracking/${conceptId}/refresh`, {
      method: 'POST',
      body: '{}',
    }),
  collectTracked: () =>
    request<{ ok: boolean; result: unknown }>('/api/tracking/collect', {
      method: 'POST',
      body: '{}',
    }),
  watchlist: () =>
    request<{ items: import('@ps-price-compare/shared').WatchlistEntry[] }>('/api/watchlist'),
  watchlistItem: (conceptId: string) =>
    request<{ item: import('@ps-price-compare/shared').WatchlistEntry | null }>(
      `/api/watchlist/${conceptId}`,
    ),
  addToWatchlist: (body: {
    conceptId: string;
    title: string;
    coverUrl?: string | null;
    preferredProductId?: string | null;
  }) =>
    request<{ ok: boolean; item: import('@ps-price-compare/shared').WatchlistEntry }>(
      '/api/watchlist',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  removeFromWatchlist: (conceptId: string) =>
    request<{ ok: boolean }>(`/api/watchlist/${conceptId}`, { method: 'DELETE' }),
  alerts: () =>
    request<{ items: import('@ps-price-compare/shared').AlertEvent[]; unread: number }>(
      '/api/alerts',
    ),
  alertUnread: () => request<{ count: number }>('/api/alerts/unread'),
  alertRules: (conceptId: string) =>
    request<{ rules: import('@ps-price-compare/shared').AlertRule[] }>(
      `/api/alerts/rules/${conceptId}`,
    ),
  saveAlertRules: (
    conceptId: string,
    body: {
      belowIlsMinor: number | null;
      discountPct: number | null;
      lowestRecorded: boolean;
      saleStarted: boolean;
    },
  ) =>
    request<{ ok: boolean; rules: import('@ps-price-compare/shared').AlertRule[] }>(
      `/api/alerts/rules/${conceptId}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  markAlertRead: (id: number) =>
    request<{ ok: boolean }>(`/api/alerts/${id}/read`, { method: 'POST', body: '{}' }),
  markAllAlertsRead: () =>
    request<{ ok: boolean }>('/api/alerts/read-all', { method: 'POST', body: '{}' }),
  wallets: () =>
    request<{
      wallets: Array<{
        region: 'IL' | 'JP' | 'IN' | 'TR';
        currency: import('@ps-price-compare/shared').CurrencyCode;
        balance: import('@ps-price-compare/shared').Money;
        updatedAt: string | null;
      }>;
    }>('/api/wallets'),
  setWallet: (region: string, balanceMinor: number) =>
    request<{ ok: boolean }>(`/api/wallets/${region}`, {
      method: 'PUT',
      body: JSON.stringify({ balanceMinor }),
    }),
};
