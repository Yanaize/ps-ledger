import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { moneyFromMajor, moneyFromMinor, toMajor } from '@ps-price-compare/shared';
import { api } from '../api/client';

export function AlertRulesPanel({ conceptId }: { conceptId: string }) {
  const qc = useQueryClient();
  const rulesQ = useQuery({
    queryKey: ['alert-rules', conceptId],
    queryFn: () => api.alertRules(conceptId),
  });

  const [below, setBelow] = useState('');
  const [discount, setDiscount] = useState('');
  const [lowest, setLowest] = useState(false);
  const [sale, setSale] = useState(false);

  useEffect(() => {
    const rules = rulesQ.data?.rules ?? [];
    const belowRule = rules.find((r) => r.kind === 'below_ils' && r.enabled);
    const discountRule = rules.find((r) => r.kind === 'discount_pct' && r.enabled);
    setBelow(
      belowRule?.threshold_minor
        ? String(toMajor(moneyFromMinor(belowRule.threshold_minor, 'ILS')))
        : '',
    );
    setDiscount(
      discountRule?.threshold_pct != null ? String(discountRule.threshold_pct) : '',
    );
    setLowest(Boolean(rules.find((r) => r.kind === 'lowest_recorded' && r.enabled)));
    setSale(Boolean(rules.find((r) => r.kind === 'sale_started' && r.enabled)));
  }, [rulesQ.data]);

  const save = useMutation({
    mutationFn: () => {
      const belowNum = below.trim() === '' ? null : Number(below);
      const discountNum = discount.trim() === '' ? null : Number(discount);
      return api.saveAlertRules(conceptId, {
        belowIlsMinor:
          belowNum != null && Number.isFinite(belowNum) && belowNum > 0
            ? moneyFromMajor(belowNum, 'ILS').amountMinor
            : null,
        discountPct:
          discountNum != null && Number.isFinite(discountNum) && discountNum > 0
            ? discountNum
            : null,
        lowestRecorded: lowest,
        saleStarted: sale,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alert-rules', conceptId] });
    },
  });

  return (
    <section className="panel alert-rules">
      <div className="ph-panel-header">
        <h3 className="section-title" style={{ margin: 0 }}>
          Price alerts
        </h3>
        <button
          type="button"
          className="btn sm primary"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save alerts'}
        </button>
      </div>
      <p className="muted" style={{ margin: '0 0 0.85rem', fontSize: '0.82rem' }}>
        Alerts fire when a tracked price changes into the condition. Repeat checks of the same price do not create another alert.
      </p>
      <div className="alert-rules-grid">
        <label className="gc-amount">
          <span className="gc-amount-label">Below (₪)</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="100"
            value={below}
            onChange={(e) => setBelow(e.target.value)}
          />
        </label>
        <label className="gc-amount">
          <span className="gc-amount-label">Discount at least (%)</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="50"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={`toggle-row ${lowest ? 'on' : ''}`}
          aria-pressed={lowest}
          onClick={() => setLowest((v) => !v)}
        >
          <span className="toggle-switch" aria-hidden><i /></span>
          <span>Lowest recorded price</span>
        </button>
        <button
          type="button"
          className={`toggle-row ${sale ? 'on' : ''}`}
          aria-pressed={sale}
          onClick={() => setSale((v) => !v)}
        >
          <span className="toggle-switch" aria-hidden><i /></span>
          <span>New sale begins</span>
        </button>
      </div>
    </section>
  );
}
