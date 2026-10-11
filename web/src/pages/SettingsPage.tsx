import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { FreshnessBadge } from '../components/FreshnessBadge';
import { PageHeader } from '../components/PageHeader';
import { LoadingState, ErrorState } from '../components/EmptyState';
import { formatMoney, moneyFromMajor, moneyFromMinor, computeFreshness } from '@ps-price-compare/shared';
import { THEME_META, THEMES, applyAppearance, readStoredAppearance, type AccentId } from '../theme';
import { LOCAL_WALLET_REGIONS, readWallets, writeWallet, type LocalWalletRegion } from '../localWallets';
import { useState } from 'react';

const WALLET_NAMES: Record<string, string> = {
  IL: 'Israel',
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
};

const DATASETS: {
  id: 'prices' | 'giftcards' | 'catalog' | 'rates';
  title: string;
  group: string;
}[] = [
  { id: 'prices', title: 'Game prices', group: 'PlayStation Store' },
  { id: 'catalog', title: 'PS Plus Extra catalog', group: 'PS Plus' },
  { id: 'giftcards', title: 'Gift card listings', group: 'Gift cards' },
  { id: 'rates', title: 'Currency rates', group: 'Shekels' },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ['status'], queryFn: api.status });
  const [appearance, setAppearance] = useState(readStoredAppearance);
  const [wallets, setWallets] = useState(readWallets);
  const [walletDraft, setWalletDraft] = useState<Record<string, string>>({});
  const [throttledTarget, setThrottledTarget] = useState<string | null>(null);

  const refresh = useMutation({
    mutationFn: (dataset: string) => api.refresh(dataset),
    onSuccess: (res, dataset) => {
      setThrottledTarget(res.throttled ? dataset : null);
      qc.invalidateQueries();
    },
  });

  const saveWallet = (region: LocalWalletRegion, currency: 'ILS' | 'JPY' | 'INR' | 'TRY', shown: string) => {
    const raw = Number(shown === '' ? 0 : shown);
    if (!Number.isFinite(raw) || raw < 0) return;
    const minor = currency === 'JPY' ? Math.round(raw) : moneyFromMajor(raw, currency).amountMinor;
    writeWallet(region, minor);
    setWallets(readWallets());
    setWalletDraft((prev) => {
      const next = { ...prev };
      delete next[region];
      return next;
    });
    qc.invalidateQueries({ queryKey: ['compare'] });
  };

  const ds = statusQ.data?.datasets ?? {};

  function datasetFreshness(key: string) {
    const d = ds[key];
    return computeFreshness(
      d?.lastSuccessAt ?? null,
      d?.lastAttemptAt ?? null,
      6 * 3600_000,
    );
  }

  function commitAppearance(input: Parameters<typeof applyAppearance>[0]) {
    applyAppearance(input);
    setAppearance(readStoredAppearance());
  }

  function formatWhen(iso: string | null | undefined) {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Appearance and wallet balances are saved on this browser only."
        actions={
          <>
            {throttledTarget === 'all' && (
              <span className="throttle-note">Throttled, please try again in a bit.</span>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate('all')}
            >
              {refresh.isPending ? 'Refreshing…' : 'Refresh all'}
            </button>
          </>
        }
      />

      {statusQ.isLoading && <LoadingState label="Loading server status…" />}
      {statusQ.isError && (
        <ErrorState description={(statusQ.error as Error).message} />
      )}

      <div className="settings-stack">
        <section className="panel span-all">
          <div className="panel-header">
            <div>
              <h3>Appearance</h3>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                The layout stays the same. A theme changes the room.
              </p>
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                commitAppearance({ theme: 'playstation', accent: 'theme', followSystem: false, highContrast: false });
              }}
            >
              Restore default appearance
            </button>
          </div>
          <div className="theme-grid">
            {THEMES.map((id) => {
              const meta = THEME_META[id];
              const selected = (appearance.theme ?? 'playstation') === id && !appearance.followSystem;
              return (
                <button
                  key={id}
                  type="button"
                  className={`theme-card ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    commitAppearance({
                      theme: id,
                      accent: appearance.accent as AccentId,
                      followSystem: false,
                      highContrast: appearance.highContrast,
                      customAccent: appearance.customAccent,
                    });
                  }}
                >
                  <span className="theme-swatch" style={{ background: meta.bg, color: meta.text, borderColor: meta.surface }}>
                    <span style={{ background: meta.surface }} />
                    <i style={{ background: meta.accent }} />
                  </span>
                  {meta.name}
                </button>
              );
            })}
          </div>
          <div className="appearance-options">
            <button
              type="button"
              className={`toggle-row ${appearance.followSystem ? 'on' : ''}`}
              aria-pressed={appearance.followSystem}
              onClick={() => {
                commitAppearance({
                  theme: appearance.theme,
                  accent: appearance.accent as AccentId,
                  followSystem: !appearance.followSystem,
                  highContrast: appearance.highContrast,
                  customAccent: appearance.customAccent,
                });
              }}
            >
              <span className="toggle-switch" aria-hidden><i /></span>
              <span>Follow system appearance</span>
            </button>
            <button
              type="button"
              className={`toggle-row ${appearance.highContrast ? 'on' : ''}`}
              aria-pressed={appearance.highContrast}
              onClick={() => {
                commitAppearance({
                  theme: appearance.theme,
                  accent: appearance.accent as AccentId,
                  followSystem: appearance.followSystem,
                  highContrast: !appearance.highContrast,
                  customAccent: appearance.customAccent,
                });
              }}
            >
              <span className="toggle-switch" aria-hidden><i /></span>
              <span>High contrast on this theme</span>
            </button>
          </div>
        </section>
        <section className="panel span-all">
          <div className="panel-header">
            <div>
              <h3>Data</h3>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                Store prices, PS Plus, gift cards, and shekel rates. Refresh one source, or use Refresh all above.
              </p>
            </div>
          </div>
          <div className="dataset-list">
            {DATASETS.map((d) => {
              const job = ds[d.id];
              const fresh = datasetFreshness(d.id);
              return (
                <div key={d.id} className={`dataset-row${throttledTarget === d.id ? ' is-throttled' : ''}`}>
                  <div>
                    <div className="name">{d.title}</div>
                    <div className="meta">{d.group}</div>
                  </div>
                  <div className="dataset-status">
                    <FreshnessBadge freshness={fresh} />
                    <div className="meta">
                      Last success: {formatWhen(job?.lastSuccessAt)}
                    </div>
                  </div>
                  <div className="dataset-refresh">
                    {throttledTarget === d.id && (
                      <span className="throttle-note">Throttled, please try again in a bit.</span>
                    )}
                    <button
                      type="button"
                      className="btn sm"
                      disabled={refresh.isPending}
                      onClick={() => refresh.mutate(d.id)}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>On this network</h3>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                Open PSLedger from another device on the same network.
              </p>
            </div>
          </div>
          {statusQ.data && (
            <>
              <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
                Listening on port {statusQ.data.port}
              </p>
              <ul className="settings-list">
                {statusQ.data.lanUrls.map((u) => (
                  <li key={u}>
                    <a href={u}>{u}</a>
                  </li>
                ))}
              </ul>
              <p style={{ margin: 0, fontSize: '0.875rem' }}>
                Eneba provider{' '}
                {statusQ.data.enebaEnabled ? (
                  <span className="badge ok">Enabled</span>
                ) : (
                  <span className="badge warn">Disabled</span>
                )}
              </p>
              {statusQ.data.searchDegraded && (
                <div className="alert error" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  <span className="badge danger">Search</span>
                  <span>{statusQ.data.searchDegradedReason}</span>
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel span-all">
          <div className="panel-header">
            <div>
              <h3>PSN wallets</h3>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                Saved on this browser only. Other people using this site keep their own balances.
              </p>
            </div>
          </div>
          <div className="wallet-grid">
            {LOCAL_WALLET_REGIONS.map((w) => {
              const minor = wallets[w.region];
              const shown =
                walletDraft[w.region] ??
                (w.currency === 'JPY' ? String(minor) : String(minor / 100));
              return (
                <label key={w.region} className="wallet-field">
                  <span className="gc-amount-label">
                    {WALLET_NAMES[w.region] ?? w.region}
                    <span className="muted"> · {w.currency}</span>
                  </span>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="0"
                    value={shown}
                    onChange={(e) =>
                      setWalletDraft((prev) => ({ ...prev, [w.region]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="btn sm"
                    style={{ marginTop: 8 }}
                    onClick={() => saveWallet(w.region, w.currency, shown)}
                  >
                    Save
                  </button>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {formatMoney(moneyFromMinor(minor, w.currency))}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
