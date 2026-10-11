import type { Db } from '../sqlite.js';

export type AlertKind = 'below_ils' | 'discount_pct' | 'lowest_recorded' | 'sale_started';

export interface AlertRuleRow {
  id: number;
  concept_id: string;
  kind: AlertKind;
  threshold_minor: number | null;
  threshold_pct: number | null;
  enabled: number;
  created_at: string;
}

export interface AlertEventRow {
  id: number;
  rule_id: number;
  concept_id: string;
  product_id: string;
  region: string;
  trigger_kind: AlertKind;
  old_minor: number | null;
  old_currency: string | null;
  new_minor: number;
  new_currency: string;
  new_ils_minor: number | null;
  discount_pct: number | null;
  fingerprint: string;
  created_at: string;
  viewed_at: string | null;
  title?: string | null;
}

export function listRulesForConcept(db: Db, conceptId: string): AlertRuleRow[] {
  return db
    .prepare(`SELECT * FROM alert_rules WHERE concept_id = ? ORDER BY kind`)
    .all(conceptId) as unknown as AlertRuleRow[];
}

export function listEnabledRules(db: Db, conceptId: string): AlertRuleRow[] {
  return db
    .prepare(`SELECT * FROM alert_rules WHERE concept_id = ? AND enabled = 1`)
    .all(conceptId) as unknown as AlertRuleRow[];
}

export function upsertRule(
  db: Db,
  input: {
    conceptId: string;
    kind: AlertKind;
    thresholdMinor?: number | null;
    thresholdPct?: number | null;
    enabled: boolean;
  },
): AlertRuleRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO alert_rules (concept_id, kind, threshold_minor, threshold_pct, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(concept_id, kind) DO UPDATE SET
       threshold_minor = excluded.threshold_minor,
       threshold_pct = excluded.threshold_pct,
       enabled = excluded.enabled`,
  ).run(
    input.conceptId,
    input.kind,
    input.thresholdMinor ?? null,
    input.thresholdPct ?? null,
    input.enabled ? 1 : 0,
    now,
  );
  return db
    .prepare(`SELECT * FROM alert_rules WHERE concept_id = ? AND kind = ?`)
    .get(input.conceptId, input.kind) as unknown as AlertRuleRow;
}

export function insertAlertEvent(
  db: Db,
  input: {
    ruleId: number;
    conceptId: string;
    productId: string;
    region: string;
    triggerKind: AlertKind;
    oldMinor: number | null;
    oldCurrency: string | null;
    newMinor: number;
    newCurrency: string;
    newIlsMinor: number | null;
    discountPct: number | null;
    fingerprint: string;
  },
): boolean {
  const existing = db
    .prepare(`SELECT id FROM alert_events WHERE rule_id = ? AND fingerprint = ?`)
    .get(input.ruleId, input.fingerprint) as { id: number } | undefined;
  if (existing) return false;

  db.prepare(
    `INSERT INTO alert_events (
       rule_id, concept_id, product_id, region, trigger_kind,
       old_minor, old_currency, new_minor, new_currency, new_ils_minor,
       discount_pct, fingerprint, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.ruleId,
    input.conceptId,
    input.productId,
    input.region,
    input.triggerKind,
    input.oldMinor,
    input.oldCurrency,
    input.newMinor,
    input.newCurrency,
    input.newIlsMinor,
    input.discountPct,
    input.fingerprint,
    new Date().toISOString(),
  );
  return true;
}

export function listAlertEvents(db: Db, opts?: { unreadOnly?: boolean; limit?: number }): AlertEventRow[] {
  const limit = opts?.limit ?? 100;
  const where = opts?.unreadOnly ? 'WHERE e.viewed_at IS NULL' : '';
  return db
    .prepare(
      `SELECT e.*, COALESCE(c.canonical_title, t.title, e.concept_id) AS title
       FROM alert_events e
       LEFT JOIN concepts c ON c.concept_id = e.concept_id
       LEFT JOIN tracked_games t ON t.concept_id = e.concept_id
       ${where}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as AlertEventRow[];
}

export function countUnviewedAlerts(db: Db): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM alert_events WHERE viewed_at IS NULL`)
    .get() as { c: number };
  return row.c;
}

export function markAlertViewed(db: Db, id: number): void {
  db.prepare(
    `UPDATE alert_events SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL`,
  ).run(new Date().toISOString(), id);
}

export function markAllAlertsViewed(db: Db): void {
  db.prepare(`UPDATE alert_events SET viewed_at = ? WHERE viewed_at IS NULL`).run(
    new Date().toISOString(),
  );
}
