import type { Db } from '../sqlite.js';

export function recordFetchAttempt(
  db: Db,
  dataset: string,
  key: string,
  ok: boolean,
  error?: string | null,
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT last_success_at FROM fetch_log WHERE dataset = ? AND key = ?')
    .get(dataset, key) as { last_success_at: string | null } | undefined;

  db.prepare(
    `INSERT INTO fetch_log (dataset, key, last_attempt_at, last_success_at, error)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(dataset, key) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = CASE WHEN excluded.error IS NULL THEN excluded.last_success_at ELSE fetch_log.last_success_at END,
       error = excluded.error`,
  ).run(dataset, key, now, ok ? now : existing?.last_success_at ?? null, ok ? null : error ?? 'error');
}

export function getFetchLog(db: Db, dataset: string, key: string) {
  return db
    .prepare(
      'SELECT last_attempt_at, last_success_at, error FROM fetch_log WHERE dataset = ? AND key = ?',
    )
    .get(dataset, key) as
    | { last_attempt_at: string | null; last_success_at: string | null; error: string | null }
    | undefined;
}

export function upsertRefreshJob(
  db: Db,
  dataset: string,
  status: string,
  message: string | null,
  success: boolean,
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT last_success_at FROM refresh_jobs WHERE dataset = ?')
    .get(dataset) as { last_success_at: string | null } | undefined;

  db.prepare(
    `INSERT INTO refresh_jobs (dataset, last_attempt_at, last_success_at, status, message)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(dataset) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = CASE WHEN ? THEN excluded.last_success_at ELSE refresh_jobs.last_success_at END,
       status = excluded.status,
       message = excluded.message`,
  ).run(
    dataset,
    now,
    success ? now : existing?.last_success_at ?? null,
    status,
    message,
    success ? 1 : 0,
  );
}

export function getRefreshJobs(db: Db) {
  return db
    .prepare(
      'SELECT dataset, last_attempt_at, last_success_at, status, message FROM refresh_jobs',
    )
    .all() as Array<{
    dataset: string;
    last_attempt_at: string | null;
    last_success_at: string | null;
    status: string;
    message: string | null;
  }>;
}

export function getRefreshJob(db: Db, dataset: string) {
  return db
    .prepare(
      'SELECT dataset, last_attempt_at, last_success_at, status, message FROM refresh_jobs WHERE dataset = ?',
    )
    .get(dataset) as
    | {
        dataset: string;
        last_attempt_at: string | null;
        last_success_at: string | null;
        status: string;
        message: string | null;
      }
    | undefined;
}
