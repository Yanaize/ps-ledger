async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
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
  compare: (conceptId: string, useGiftCards: boolean) =>
    request<import('@ps-price-compare/shared').GameComparison>(
      `/api/games/${conceptId}/compare?useGiftCards=${useGiftCards ? '1' : '0'}`,
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
};
