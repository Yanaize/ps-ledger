import type { Freshness, FreshnessStatus } from './types.js';

export function computeFreshness(
  lastSuccessAt: string | null,
  lastAttemptAt: string | null,
  ttlMs: number,
  opts?: { isManual?: boolean; now?: Date },
): Freshness {
  const now = opts?.now ?? new Date();
  if (opts?.isManual) {
    return {
      status: 'manual',
      lastSuccessAt,
      lastAttemptAt,
      label: lastSuccessAt
        ? `Manual entry — recorded ${formatRelative(now.getTime() - new Date(lastSuccessAt).getTime())}`
        : 'Manual entry',
      ageMs: lastSuccessAt ? now.getTime() - new Date(lastSuccessAt).getTime() : null,
    };
  }

  if (!lastSuccessAt) {
    return {
      status: 'unavailable',
      lastSuccessAt: null,
      lastAttemptAt,
      label: lastAttemptAt
        ? `Unavailable — last attempt ${formatAbsolute(lastAttemptAt)}`
        : 'Unavailable',
      ageMs: null,
    };
  }

  const ageMs = now.getTime() - new Date(lastSuccessAt).getTime();
  const attemptFailed =
    lastAttemptAt != null &&
    new Date(lastAttemptAt).getTime() > new Date(lastSuccessAt).getTime();

  let status: FreshnessStatus;
  let label: string;

  if (ageMs <= ttlMs && !attemptFailed) {
    status = 'fresh';
    label = `Updated ${formatRelative(ageMs)}`;
  } else if (ageMs <= ttlMs * 4) {
    status = 'cached';
    label = attemptFailed
      ? `Cached — last successful update ${formatAbsolute(lastSuccessAt)}`
      : `Cached — updated ${formatRelative(ageMs)}`;
  } else {
    status = 'stale';
    label = `Stale — last successful update ${formatAbsolute(lastSuccessAt)}`;
  }

  return { status, lastSuccessAt, lastAttemptAt, label, ageMs };
}

export function formatRelative(ageMs: number): string {
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function stockLabel(
  status: 'in_stock' | 'out_of_stock' | 'unknown',
  freshness: Freshness,
): string {
  if (freshness.status === 'unavailable') return '? Unknown';
  if (freshness.status === 'stale' || freshness.status === 'cached') {
    if (status === 'in_stock') {
      return `Previously in stock — last checked ${formatRelative(freshness.ageMs ?? 0)}`;
    }
    if (status === 'out_of_stock') {
      return `Previously out of stock — last checked ${formatRelative(freshness.ageMs ?? 0)}`;
    }
    return `? Unknown — last checked ${formatRelative(freshness.ageMs ?? 0)}`;
  }
  if (status === 'in_stock') return '✓ In Stock';
  if (status === 'out_of_stock') return '✕ Out of Stock';
  return '? Unknown';
}
