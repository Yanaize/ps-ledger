import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMoney,
  moneyFromMinor,
  type CurrencyCode,
  type GameComparison,
  type HistoryMode,
  type HistoryRange,
  type PriceHistoryChartResponse,
  type PriceHistorySeries,
  type PriceRegion,
} from '@ps-price-compare/shared';
import { api } from '../api/client';
import { PriceHistoryChart } from './PriceHistoryChart';
import { LoadingState } from './EmptyState';

const REGION_NAMES: Record<string, string> = {
  IL: 'Israel',
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
};

const REGION_ORDER: PriceRegion[] = ['IL', 'JP', 'IN', 'TR'];
const RANGES: HistoryRange[] = ['1M', '3M', '6M', '1Y', 'ALL'];

/** Ensure every compared region appears on the chart, even before DB history catches up. */
function mergeLivePrices(
  chart: PriceHistoryChartResponse | undefined,
  data: GameComparison,
  mode: HistoryMode,
  enabledRegions: PriceRegion[],
): PriceHistorySeries[] {
  const now = new Date().toISOString();
  const byRegion = new Map<string, PriceHistorySeries>();

  for (const s of chart?.series ?? []) {
    if (!enabledRegions.includes(s.region as PriceRegion)) continue;
    byRegion.set(s.region, s);
  }

  for (const region of REGION_ORDER) {
    if (!enabledRegions.includes(region)) continue;
    const row = data.regions.find((r) => r.region === region);
    if (!row?.available || !row.product || !row.nativePrice) continue;

    const existing = byRegion.get(region);
    if (existing && existing.points.length > 0) continue;

    const native = row.nativePrice;
    let priceMinor = native.amountMinor;
    let currency: string = native.currency;

    if (mode === 'ils') {
      if (!row.directIls) continue;
      priceMinor = row.directIls.amountMinor;
      currency = 'ILS';
    }

    byRegion.set(region, {
      region,
      productId: row.product.productId,
      points: [
        {
          at: now,
          priceMinor,
          currency,
          ilsMinor: row.directIls?.amountMinor ?? (currency === 'ILS' ? priceMinor : null),
          isOnSale: Boolean(row.isDiscounted),
          segmentId: -1,
        },
      ],
      ilsConversion:
        mode === 'ils'
          ? {
              method: 'historical_stored',
              label: 'Current price converted with today’s rate (no prior observations yet)',
            }
          : null,
    });
  }

  return REGION_ORDER.map((r) => byRegion.get(r)).filter(
    (s): s is PriceHistorySeries => Boolean(s && s.points.length > 0),
  );
}

const CHART_MODE: HistoryMode = 'native';

export function PriceHistoryPanel({ data }: { data: GameComparison }) {
  const qc = useQueryClient();
  const [range, setRange] = useState<HistoryRange>('ALL');
  const [summaryRegion, setSummaryRegion] = useState<PriceRegion>('JP');

  const productIds = useMemo(
    () =>
      [
        ...new Set(
          data.regions
            .filter((r) => r.available && r.product?.productId)
            .map((r) => r.product!.productId),
        ),
      ],
    [data.regions],
  );

  const summaryProductId =
    data.regions.find((r) => r.region === summaryRegion)?.product?.productId ?? null;

  const historyQ = useQuery({
    queryKey: ['history', data.conceptId, range, productIds],
    queryFn: () =>
      api.history(data.conceptId, {
        regions: REGION_ORDER,
        range,
        mode: CHART_MODE,
        productIds,
      }),
  });

  const summaryQ = useQuery({
    queryKey: ['history-summary', data.conceptId, summaryProductId, summaryRegion],
    queryFn: () =>
      api.historySummary(data.conceptId, summaryProductId!, summaryRegion),
    enabled: Boolean(summaryProductId),
  });

  const refreshMut = useMutation({
    mutationFn: () => api.refreshTrackedGame(data.conceptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['history-summary'] });
      qc.invalidateQueries({ queryKey: ['compare', data.conceptId] });
    },
  });

  const summary = summaryQ.data;
  const chartSeries = useMemo(
    () => mergeLivePrices(historyQ.data, data, CHART_MODE, REGION_ORDER),
    [historyQ.data, data],
  );

  function moneyLabel(minor: number, currency: string) {
    return formatMoney(moneyFromMinor(minor, currency as CurrencyCode));
  }

  return (
    <section className="ph-panel">
      <div className="ph-panel-header">
        <h3 className="section-title" style={{ margin: 0 }}>
          Price History
        </h3>
        <div className="ph-panel-actions">
          <button
            type="button"
            className="btn sm"
            disabled={refreshMut.isPending}
            onClick={() => refreshMut.mutate()}
          >
            {refreshMut.isPending ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      </div>

      <div className="ph-body panel">
        <div className="ph-controls">
          <div className="ph-control-group">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`filter-chip ${range === r ? 'active' : ''}`}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="ph-layout">
          <div className="ph-stats">
            <label className="ph-summary-region">
              <span className="gc-amount-label">Summary region</span>
              <select
                className="select"
                value={summaryRegion}
                onChange={(e) => setSummaryRegion(e.target.value as PriceRegion)}
              >
                {REGION_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {REGION_NAMES[r]}
                  </option>
                ))}
              </select>
            </label>

            {!summaryProductId && (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                No matched product in this region yet.
              </p>
            )}

            {summaryQ.isLoading && <LoadingState label="Loading summary…" />}

            {summary && summary.observationCount === 0 && (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                First observation is being recorded from this comparison.
              </p>
            )}

            {summary && summary.observationCount > 0 && summary.current && (
              <>
                <div className="ph-stat-primary">
                  <div className="label">Current price</div>
                  <div className="value">
                    {moneyLabel(summary.current.minor, summary.current.currency)}
                  </div>
                </div>
                <div className="ph-stat-grid">
                  <div>
                    <div className="label">Lowest recorded</div>
                    <div className="mono">
                      {summary.lowest
                        ? moneyLabel(summary.lowest.minor, summary.lowest.currency)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="label">Highest recorded</div>
                    <div className="mono">
                      {summary.highest
                        ? moneyLabel(summary.highest.minor, summary.highest.currency)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="label">Regular</div>
                    <div className="mono">
                      {summary.regular
                        ? moneyLabel(summary.regular.minor, summary.regular.currency)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="label">Discount</div>
                    <div className="mono">
                      {summary.currentDiscountPct != null
                        ? `${summary.currentDiscountPct}%`
                        : summary.isOnSale
                          ? 'On sale'
                          : '—'}
                    </div>
                  </div>
                </div>

                {summary.salePeriods.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <p className="section-title">Previous sales</p>
                    <ul className="ph-sales">
                      {summary.salePeriods.slice(0, 6).map((s, i) => (
                        <li key={`${s.startAt}-${i}`}>
                          <span>
                            {new Date(s.startAt).toLocaleDateString()}
                            {' – '}
                            {new Date(s.endAt).toLocaleDateString()}
                          </span>
                          <span className="mono">
                            {moneyLabel(s.currentMinor, s.currency)}
                            {s.discountPct != null ? ` · ${s.discountPct}% off` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="ph-chart">
            {historyQ.isLoading && chartSeries.length === 0 && (
              <LoadingState label="Loading chart…" />
            )}
            {chartSeries.length === 0 && !historyQ.isLoading && (
              <div className="state-block" style={{ padding: '1.5rem' }}>
                <h3>No prices to graph yet</h3>
                <p>Refresh this game to record regional prices.</p>
              </div>
            )}
            {chartSeries.length > 0 && (
              <PriceHistoryChart series={chartSeries} mode={CHART_MODE} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
