import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { FreshnessBadge } from '../components/FreshnessBadge';
import { PageHeader } from '../components/PageHeader';
import { LoadingState, ErrorState } from '../components/EmptyState';
import { computeFreshness } from '@ps-price-compare/shared';
import { useState } from 'react';

const DATASETS: {
  id: 'prices' | 'giftcards' | 'catalog' | 'rates';
  title: string;
  group: string;
}[] = [
  { id: 'prices', title: 'Game prices', group: 'PlayStation Store' },
  { id: 'catalog', title: 'PS Plus Extra catalog', group: 'PS Plus' },
  { id: 'giftcards', title: 'Gift card listings', group: 'Gift cards' },
  { id: 'rates', title: 'Exchange rates', group: 'FX' },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ['status'], queryFn: api.status });
  const ratesQ = useQuery({ queryKey: ['rates'], queryFn: api.rates });
  const prefsQ = useQuery({ queryKey: ['prefs'], queryFn: api.prefs });
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'warn' | 'error'>('ok');
  const [starInput, setStarInput] = useState('');

  const refresh = useMutation({
    mutationFn: (dataset: string) => api.refresh(dataset),
    onSuccess: (res) => {
      setMessageTone(res.throttled ? 'warn' : res.ok ? 'ok' : 'error');
      setMessage(res.throttled ? `Throttled: ${res.message}` : res.message);
      qc.invalidateQueries();
    },
    onError: (err) => {
      setMessageTone('error');
      setMessage((err as Error).message);
    },
  });

  const savePrefs = useMutation({
    mutationFn: api.setPrefs,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
  });

  const ds = statusQ.data?.datasets ?? {};

  function datasetFreshness(key: string) {
    const d = ds[key];
    return computeFreshness(
      d?.lastSuccessAt ?? null,
      d?.lastAttemptAt ?? null,
      6 * 3600_000,
    );
  }

  function formatWhen(iso: string | null | undefined) {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  }

  return (
    <div>
      <PageHeader
        title="Settings / Data"
        description="Manage dataset freshness and preferences. Sources older than half a day refresh automatically in the background."
        actions={
          <button
            type="button"
            className="btn primary"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate('all')}
          >
            {refresh.isPending ? 'Refreshing…' : 'Refresh all'}
          </button>
        }
      />

      {message && (
        <div className={`alert ${messageTone === 'error' ? 'error' : messageTone === 'warn' ? 'warn' : ''}`}>
          <span className={`badge ${messageTone === 'ok' ? 'ok' : messageTone === 'warn' ? 'warn' : 'danger'}`}>
            {messageTone === 'ok' ? 'Updated' : messageTone === 'warn' ? 'Note' : 'Failed'}
          </span>
          <span className="text-secondary">{message}</span>
        </div>
      )}

      {statusQ.isLoading && <LoadingState label="Loading server status…" />}
      {statusQ.isError && (
        <ErrorState description={(statusQ.error as Error).message} />
      )}

      <div className="settings-stack">
        <section>
          <p className="section-title">Datasets</p>
          <div className="dataset-list">
            {DATASETS.map((d) => {
              const job = ds[d.id];
              const fresh = datasetFreshness(d.id);
              return (
                <div key={d.id} className="dataset-row">
                  <div>
                    <div className="name">{d.title}</div>
                    <div className="meta">{d.group}</div>
                  </div>
                  <div>
                    <FreshnessBadge freshness={fresh} />
                    <div className="meta" style={{ marginTop: 6 }}>
                      Last success: {formatWhen(job?.lastSuccessAt)}
                    </div>
                  </div>
                  <div className="meta">
                    {job?.status === 'running' ? (
                      <span className="badge accent">In progress</span>
                    ) : job?.status === 'error' ? (
                      <span className="badge danger">Error</span>
                    ) : job?.message ? (
                      <span title={job.message}>{job.message.slice(0, 48)}{job.message.length > 48 ? '…' : ''}</span>
                    ) : (
                      '—'
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={refresh.isPending}
                    onClick={() => refresh.mutate(d.id)}
                  >
                    Refresh
                  </button>
                </div>
              );
            })}
          </div>
          {ratesQ.data && (
            <p className="freshness-line">
              FX provider: {ratesQ.data.provider} · as of{' '}
              {new Date(ratesQ.data.asOf).toLocaleString()}
              {ratesQ.data.fromCache ? ' · cached' : ''}
              {statusQ.data?.autoRefreshStaleHours != null && (
                <>
                  {' '}
                  · Auto-refresh after {statusQ.data.autoRefreshStaleHours}h (check every{' '}
                  {statusQ.data.autoRefreshCheckMinutes ?? 60}m)
                </>
              )}
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Server / LAN</h3>
          </div>
          {statusQ.data && (
            <>
              <p className="mono" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
                Bound to {statusQ.data.bindHost}:{statusQ.data.port}
              </p>
              <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.1rem' }}>
                {statusQ.data.lanUrls.map((u) => (
                  <li key={u} style={{ marginBottom: 4 }}>
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

        <section className="panel">
          <div className="panel-header">
            <h3>Preferences</h3>
          </div>
          <label className="check-label" style={{ marginBottom: '1.25rem' }}>
            <input
              type="checkbox"
              checked={Boolean(prefsQ.data?.useGiftCardsDefault)}
              onChange={(e) =>
                savePrefs.mutate({ useGiftCardsDefault: e.target.checked })
              }
            />
            Default “Use gift card cost” on Price Comparison
          </label>

          <p className="section-title" style={{ marginTop: '0.5rem' }}>
            Starred concept IDs
          </p>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            PlayStation concept IDs (one per line or comma-separated) for the Popular Games view.
          </p>
          <textarea
            className="input"
            value={starInput || (prefsQ.data?.starredConcepts ?? []).join('\n')}
            onChange={(e) => setStarInput(e.target.value)}
            placeholder="10002456"
          />
          <button
            type="button"
            className="btn"
            style={{ marginTop: 10 }}
            onClick={() => {
              const ids = (starInput || (prefsQ.data?.starredConcepts ?? []).join('\n'))
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              savePrefs.mutate({ starredConcepts: ids });
            }}
          >
            Save starred concepts
          </button>
        </section>
      </div>
    </div>
  );
}
