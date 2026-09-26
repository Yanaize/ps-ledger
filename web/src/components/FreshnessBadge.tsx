import type { Freshness } from '@ps-price-compare/shared';

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const tone =
    freshness.status === 'fresh'
      ? 'ok'
      : freshness.status === 'stale' || freshness.status === 'unavailable'
        ? 'danger'
        : freshness.status === 'manual'
          ? 'accent'
          : 'warn';
  return (
    <span className={`badge ${tone}`}>
      <span className="status-dot" aria-hidden />
      {freshness.label}
    </span>
  );
}
