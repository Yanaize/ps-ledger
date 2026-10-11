import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatMoney, moneyFromMinor, type CurrencyCode } from '@ps-price-compare/shared';
import type { PriceHistoryPoint, PriceHistorySeries } from '@ps-price-compare/shared';

const REGION_COLORS: Record<string, string> = {
  JP: 'var(--region-jp)',
  IN: 'var(--region-in)',
  TR: 'var(--region-tr)',
  IL: 'var(--region-il)',
};

const REGION_NAMES: Record<string, string> = {
  JP: 'Japan',
  IN: 'India',
  TR: 'Turkey',
  IL: 'Israel',
};

const MIN_SPAN_MS = 7 * 86400_000; // pad short histories so a plateau is visible

type HoverState = {
  x: number;
  y: number;
  label: string;
  value: string;
  region: string;
};

function formatAxis(minor: number, cur: string) {
  try {
    return formatMoney(moneyFromMinor(minor, cur as CurrencyCode), { compact: true });
  } catch {
    return String(Math.round(minor));
  }
}

function shekelBeside(currency: string, ilsMinor: number | null | undefined): string {
  if (currency === 'ILS' || ilsMinor == null) return '';
  return ` · ${formatMoney(moneyFromMinor(ilsMinor, 'ILS'))}`;
}

/** Convert a native-axis tick using the latest stored rate on this series. */
function ilsForAxis(nativeMinor: number, points: PriceHistoryPoint[]): number | null {
  const sample = [...points]
    .reverse()
    .find((p) => p.currency !== 'ILS' && p.ilsMinor != null && p.priceMinor > 0);
  if (!sample || sample.ilsMinor == null) return null;
  return Math.round((nativeMinor / sample.priceMinor) * sample.ilsMinor);
}

/** Extend open plateau to "now" and ensure a visible horizontal step. */
function plotPoints(points: PriceHistoryPoint[], nowIso: string): PriceHistoryPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const out = [...sorted];

  // Always close the step at "now" so the current price spans the chart
  if (new Date(last.at).getTime() < new Date(nowIso).getTime() - 1_000) {
    out.push({ ...last, at: nowIso });
  }

  // Single instant (or very short span): synthesize a plateau so the line is visible
  const span =
    new Date(out[out.length - 1]!.at).getTime() - new Date(out[0]!.at).getTime();
  if (span < MIN_SPAN_MS / 4) {
    const t0 = new Date(first.at).getTime();
    return [
      { ...first, at: new Date(t0 - MIN_SPAN_MS / 2).toISOString() },
      { ...last, at: new Date(t0 + MIN_SPAN_MS / 2).toISOString() },
    ];
  }
  return out;
}

function RegionChart({
  series,
  mode,
  height,
  onHover,
}: {
  series: PriceHistorySeries[];
  mode: 'native' | 'ils';
  height: number;
  onHover: (h: HoverState | null) => void;
}) {
  const width = 640;
  const showShekel = series.some((s) =>
    s.points.some((p) => p.currency !== 'ILS' && p.ilsMinor != null),
  );
  const pad = { t: 16, r: 16, b: 28, l: showShekel ? 118 : 56 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const prepared = useMemo(() => {
    const plotted = series
      .map((s) => ({
        ...s,
        points: plotPoints(s.points, nowIso),
      }))
      .filter((s) => s.points.length > 0);
    if (plotted.length === 0) return null;

    const allPoints = plotted.flatMap((s) => s.points);
    const times = allPoints.map((p) => new Date(p.at).getTime());
    let minT = Math.min(...times);
    let maxT = Math.max(...times);
    if (maxT - minT < MIN_SPAN_MS) {
      const mid = (minT + maxT) / 2;
      minT = mid - MIN_SPAN_MS / 2;
      maxT = mid + MIN_SPAN_MS / 2;
    }
    const spanT = maxT - minT;

    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of allPoints) {
      minY = Math.min(minY, p.priceMinor);
      maxY = Math.max(maxY, p.priceMinor);
    }
    if (!Number.isFinite(minY)) return null;
    if (minY === maxY) {
      minY = Math.max(0, minY * 0.85);
      maxY = maxY * 1.15 || 1;
    }
    const padY = (maxY - minY) * 0.1;
    minY -= padY;
    maxY += padY;

    const xOf = (at: string) =>
      pad.l + ((new Date(at).getTime() - minT) / spanT) * innerW;
    const yOf = (minor: number) =>
      pad.t + innerH - ((minor - minY) / (maxY - minY)) * innerH;

    const paths = plotted.map((s) => {
      let d = '';
      for (let i = 0; i < s.points.length; i++) {
        const p = s.points[i]!;
        const x = xOf(p.at);
        const y = yOf(p.priceMinor);
        if (i === 0) d += `M ${x} ${y}`;
        else {
          const prev = s.points[i - 1]!;
          const py = yOf(prev.priceMinor);
          d += ` L ${x} ${py} L ${x} ${y}`;
        }
      }
      return {
        key: `${s.region}:${s.productId}`,
        region: s.region,
        d,
        color: REGION_COLORS[s.region] ?? '#8b93a1',
        points: s.points,
        currency: s.points[0]?.currency ?? 'JPY',
      };
    });

    const axisCurrency =
      mode === 'ils' ? 'ILS' : (paths[0]?.currency ?? allPoints[0]?.currency ?? 'JPY');

    return { paths, xOf, yOf, minY, maxY, minT, maxT, axisCurrency };
  }, [series, mode, innerW, innerH, nowIso, pad.l, pad.t]);

  if (!prepared) return null;

  const { paths, xOf, yOf, minY, maxY, minT, maxT, axisCurrency } = prepared;

  function reveal(
    pt: { at: string; priceMinor: number; currency: string; ilsMinor?: number | null },
    region: string,
    svg: SVGSVGElement | null,
  ) {
    const rect = svg?.getBoundingClientRect();
    const svgX = xOf(pt.at);
    const svgY = yOf(pt.priceMinor);
    onHover({
      x: (svgX / width) * (rect?.width ?? width),
      y: (svgY / height) * (rect?.height ?? height),
      region: REGION_NAMES[region] ?? region,
      label: new Date(pt.at).toLocaleString(),
      value:
        formatMoney(moneyFromMinor(pt.priceMinor, pt.currency as CurrencyCode)) +
        shekelBeside(pt.currency, pt.ilsMinor),
    });
  }

  function pointFromPointer(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    let best: { pt: PriceHistoryPoint; region: string } | null = null;
    let bestD = 48;
    for (const seriesPath of paths) {
      for (const pt of seriesPath.points) {
        const d = Math.hypot(xOf(pt.at) - x, yOf(pt.priceMinor) - y);
        if (d < bestD) {
          bestD = d;
          best = { pt, region: seriesPath.region };
        }
      }
    }
    if (!best) return;
    reveal(best.pt, best.region, e.currentTarget);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Price history chart"
      onMouseLeave={() => onHover(null)}
      onPointerDown={pointFromPointer}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = pad.t + innerH * (1 - t);
        const val = minY + (maxY - minY) * t;
        return (
          <g key={t}>
            <line
              x1={pad.l}
              x2={pad.l + innerW}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={pad.l - 8}
              y={y + 3}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize={10}
              fontFamily="var(--mono)"
            >
              {formatAxis(val, axisCurrency)}
              {axisCurrency !== 'ILS' ? shekelBeside(axisCurrency, ilsForAxis(val, paths[0]?.points ?? [])) : ''}
            </text>
          </g>
        );
      })}

      {/* date ticks */}
      {[0, 0.5, 1].map((t) => {
        const x = pad.l + innerW * t;
        const at = new Date(minT + (maxT - minT) * t);
        return (
          <text
            key={`x-${t}`}
            x={x}
            y={height - 8}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize={10}
            fontFamily="var(--mono)"
          >
            {at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        );
      })}

      {paths.map(
        (p) =>
          p && (
            <g key={p.key}>
              <path
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {p.points.map((pt, i) => (
                <circle
                  key={`${p.key}-${i}-${pt.at}`}
                  cx={xOf(pt.at)}
                  cy={yOf(pt.priceMinor)}
                  r={i === 0 || i === p.points.length - 1 ? 4 : 3}
                  fill={p.color}
                  stroke="var(--bg-surface)"
                  strokeWidth={1.5}
                  onMouseEnter={(e) => reveal(pt, p.region, e.currentTarget.ownerSVGElement)}
                />
              ))}
            </g>
          ),
      )}
    </svg>
  );
}

export function PriceHistoryChart({
  series,
  mode,
  height = 220,
}: {
  series: PriceHistorySeries[];
  mode: 'native' | 'ils';
  height?: number;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const active = series.filter((s) => s.points.length > 0);
  const currencies = new Set(active.flatMap((s) => s.points.map((p) => p.currency)));
  // Native + multiple currencies cannot share one axis — graph each region separately.
  const splitByRegion = mode === 'native' && currencies.size > 1 && active.length > 1;

  if (active.length === 0) {
    return (
      <div className="state-block" style={{ padding: '2rem 1rem' }}>
        <h3>Not enough history yet</h3>
        <p>More history will appear as prices are collected over time.</p>
      </div>
    );
  }

  return (
    <div className="ph-chart-wrap" style={{ position: 'relative' }}>
      <div className="ph-legend">
        {active.map((s) => (
          <span key={`${s.region}:${s.productId}`} className="ph-legend-item">
            <span
              className="ph-legend-swatch"
              style={{ background: REGION_COLORS[s.region] ?? '#8b93a1' }}
            />
            {REGION_NAMES[s.region] ?? s.region}
          </span>
        ))}
      </div>

      {splitByRegion ? (
        <div className="ph-chart-stack">
          {active.map((s) => (
            <div key={`${s.region}:${s.productId}`} className="ph-chart-region">
              <div className="ph-chart-region-label">
                <span
                  className="ph-legend-swatch"
                  style={{ background: REGION_COLORS[s.region] ?? '#8b93a1' }}
                />
                {REGION_NAMES[s.region] ?? s.region}
                <span className="muted">
                  {formatMoney(
                    moneyFromMinor(
                      s.points[s.points.length - 1]!.priceMinor,
                      s.points[s.points.length - 1]!.currency as CurrencyCode,
                    ),
                  )}
                  {shekelBeside(
                    s.points[s.points.length - 1]!.currency,
                    s.points[s.points.length - 1]!.ilsMinor,
                  )}
                </span>
              </div>
              <RegionChart
                series={[s]}
                mode={mode}
                height={Math.max(140, Math.round(height * 0.7))}
                onHover={setHover}
              />
            </div>
          ))}
        </div>
      ) : (
        <RegionChart series={active} mode={mode} height={height} onHover={setHover} />
      )}

      {hover && (
        <div
          className="ph-tooltip"
          style={{
            left: `min(${Math.round(hover.x + 8)}px, calc(100% - 9.5rem))`,
            top: Math.max(hover.y - 40, 0),
          }}
        >
          <div className="ph-tooltip-region">{hover.region}</div>
          <div className="ph-tooltip-value">{hover.value}</div>
          <div className="ph-tooltip-date">{hover.label}</div>
        </div>
      )}
    </div>
  );
}
