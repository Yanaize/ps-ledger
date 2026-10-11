import {
  convertToIls,
  moneyFromMinor,
  type CurrencyCode,
} from '@ps-price-compare/shared';
import type { Db } from '../db/sqlite.js';
import type { PriceHistoryRow } from '../db/repositories/priceHistory.js';
import {
  insertAlertEvent,
  listAlertEvents,
  listEnabledRules,
  listRulesForConcept,
  countUnviewedAlerts,
  markAlertViewed,
  markAllAlertsViewed,
  upsertRule,
  type AlertEventRow,
  type AlertKind,
  type AlertRuleRow,
} from '../db/repositories/alerts.js';

export type PriceChangedEvent = {
  previous: PriceHistoryRow | null;
  current: PriceHistoryRow;
};

export class AlertService {
  constructor(private readonly db: Db) {}

  /** Evaluate rules after a new price-history segment. Unchanged checks must not call this. */
  evaluate(event: PriceChangedEvent): number {
    const { previous, current } = event;
    if (!previous) return 0;

    const rules = listEnabledRules(this.db, current.concept_id);
    let created = 0;
    for (const rule of rules) {
      if (!this.matches(rule, previous, current)) continue;
      const ils = ilsMinor(current);
      const inserted = insertAlertEvent(this.db, {
        ruleId: rule.id,
        conceptId: current.concept_id,
        productId: current.product_id,
        region: current.region,
        triggerKind: rule.kind,
        oldMinor: previous.current_minor,
        oldCurrency: previous.currency,
        newMinor: current.current_minor,
        newCurrency: current.currency,
        newIlsMinor: ils,
        discountPct: current.discount_pct,
        fingerprint: `${current.product_id}:${current.region}:${current.id}:${rule.kind}`,
      });
      if (inserted) created++;
    }
    return created;
  }

  rulesFor(conceptId: string): AlertRuleRow[] {
    return listRulesForConcept(this.db, conceptId);
  }

  saveRules(
    conceptId: string,
    input: {
      belowIlsMinor: number | null;
      discountPct: number | null;
      lowestRecorded: boolean;
      saleStarted: boolean;
    },
  ): AlertRuleRow[] {
    upsertRule(this.db, {
      conceptId,
      kind: 'below_ils',
      thresholdMinor: input.belowIlsMinor,
      enabled: input.belowIlsMinor != null && input.belowIlsMinor > 0,
    });
    upsertRule(this.db, {
      conceptId,
      kind: 'discount_pct',
      thresholdPct: input.discountPct,
      enabled: input.discountPct != null && input.discountPct > 0,
    });
    upsertRule(this.db, {
      conceptId,
      kind: 'lowest_recorded',
      enabled: input.lowestRecorded,
    });
    upsertRule(this.db, {
      conceptId,
      kind: 'sale_started',
      enabled: input.saleStarted,
    });
    return this.rulesFor(conceptId);
  }

  list(unreadOnly = false): AlertEventRow[] {
    return listAlertEvents(this.db, { unreadOnly, limit: 100 });
  }

  unreadCount(): number {
    return countUnviewedAlerts(this.db);
  }

  view(id: number): void {
    markAlertViewed(this.db, id);
  }

  viewAll(): void {
    markAllAlertsViewed(this.db);
  }

  private matches(rule: AlertRuleRow, prev: PriceHistoryRow, next: PriceHistoryRow): boolean {
    if (rule.kind === 'below_ils') {
      if (rule.threshold_minor == null) return false;
      const before = ilsMinor(prev);
      const after = ilsMinor(next);
      if (before == null || after == null) return false;
      return before > rule.threshold_minor && after <= rule.threshold_minor;
    }
    if (rule.kind === 'discount_pct') {
      if (rule.threshold_pct == null) return false;
      const before = prev.discount_pct ?? 0;
      const after = next.discount_pct ?? 0;
      return before < rule.threshold_pct && after >= rule.threshold_pct;
    }
    if (rule.kind === 'sale_started') {
      return !prev.is_on_sale && Boolean(next.is_on_sale);
    }
    if (rule.kind === 'lowest_recorded') {
      if (next.current_minor >= prev.current_minor) return false;
      const min = this.db
        .prepare(
          `SELECT MIN(current_minor) AS m FROM price_history
           WHERE product_id = ? AND region = ?`,
        )
        .get(next.product_id, next.region) as { m: number | null };
      return min.m != null && next.current_minor === min.m;
    }
    return false;
  }
}

function ilsMinor(row: PriceHistoryRow): number | null {
  const currency = row.currency as CurrencyCode;
  if (currency === 'ILS') return row.current_minor;
  if (!row.fx_rate_ils_base || row.fx_rate_ils_base <= 0) return null;
  const ils = convertToIls(moneyFromMinor(row.current_minor, currency), {
    [currency]: row.fx_rate_ils_base,
  });
  return ils?.amountMinor ?? null;
}

export type { AlertKind };
