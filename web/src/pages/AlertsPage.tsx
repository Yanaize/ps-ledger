import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, moneyFromMinor, type CurrencyCode } from '@ps-price-compare/shared';
import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';

const KIND_LABEL: Record<string, string> = {
  below_ils: 'Fell below target',
  discount_pct: 'Discount reached',
  lowest_recorded: 'Lowest recorded price',
  sale_started: 'Sale started',
};

const REGION_NAMES: Record<string, string> = {
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
  IL: 'Israel',
};

export function AlertsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['alerts'], queryFn: api.alerts });

  const readOne = useMutation({
    mutationFn: (id: number) => api.markAlertRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-unread'] });
    },
  });

  const readAll = useMutation({
    mutationFn: () => api.markAllAlertsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-unread'] });
    },
  });

  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Internal notices when a watched price crosses a rule. Unchanged checks do not create duplicates."
        actions={
          <button
            type="button"
            className="btn sm"
            disabled={readAll.isPending || (q.data?.unread ?? 0) === 0}
            onClick={() => readAll.mutate()}
          >
            Mark all viewed
          </button>
        }
      />

      {q.isLoading && <LoadingState label="Loading alerts…" />}
      {q.isError && <ErrorState description={(q.error as Error).message} />}
      {q.data && items.length === 0 && (
        <EmptyState
          title="No alerts yet"
          description="Set a price alert on a game. A notice appears here when the price changes into that condition."
        />
      )}

      {items.length > 0 && (
        <ul className="alert-list">
          {items.map((item) => (
            <li key={item.id} className={`alert-row ${item.viewed_at ? '' : 'unread'}`}>
              <div>
                <div className="alert-row-title">{item.title || item.concept_id}</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  {KIND_LABEL[item.trigger_kind] ?? item.trigger_kind}
                  {' · '}
                  {REGION_NAMES[item.region] ?? item.region}
                  {item.discount_pct != null ? ` · ${item.discount_pct}% off` : ''}
                </div>
                <div className="mono" style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
                  {item.old_minor != null && item.old_currency
                    ? formatMoney(moneyFromMinor(item.old_minor, item.old_currency as CurrencyCode))
                    : '—'}
                  {' → '}
                  {formatMoney(moneyFromMinor(item.new_minor, item.new_currency as CurrencyCode))}
                  {item.new_ils_minor != null
                    ? ` · ${formatMoney(moneyFromMinor(item.new_ils_minor, 'ILS'))}`
                    : ''}
                </div>
                <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </div>
              {!item.viewed_at && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => readOne.mutate(item.id)}
                >
                  Mark viewed
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
