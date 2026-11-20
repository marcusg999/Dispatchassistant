/** Sticky totals: subtotal, discount, tax, total, cost, margin, approval and warnings. */
import { formatCents } from '../../../shared/estimate';
import { pct, StatusPill } from './shared';

export interface TotalsView {
  subtotal_cents: number;
  discount_bp: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  cost_cents: number;
  margin_cents: number;
  margin_bp: number;
  needs_approval: boolean;
  approval_reasons: string[];
  below_target: boolean;
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'invalid' | 'error' | 'stale';

export function TotalsPanel({
  t,
  targetBp,
  warnings,
  status,
  approvalNote,
  saveState,
  saveMessage,
  engineError,
  readOnly,
}: {
  t: TotalsView;
  targetBp: number | null;
  warnings: string[];
  status: string;
  approvalNote: string | null;
  saveState: SaveState;
  saveMessage: string;
  engineError: string | null;
  readOnly: boolean;
}) {
  const label = readOnly
    ? 'Locked'
    : saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'dirty'
          ? 'Changes not saved yet…'
          : saveState === 'idle'
            ? 'All changes saved'
            : saveMessage || 'Not saved';
  return (
    <aside className="a-panel est-totals" aria-labelledby="totals-h">
      <h2 id="totals-h" className="est-h2">
        Totals
      </h2>
      <p className={`est-save est-save-${saveState}`} role="status" aria-live="polite">
        {label}
      </p>
      <dl className="est-dl">
        <dt>Subtotal</dt>
        <dd className="est-money">{formatCents(t.subtotal_cents)}</dd>
        <dt>Discount{t.discount_bp ? ` (${pct(t.discount_bp)})` : ''}</dt>
        <dd className="est-money">{t.discount_cents ? formatCents(-t.discount_cents) : formatCents(0)}</dd>
        <dt>Tax</dt>
        <dd className="est-money">{formatCents(t.tax_cents)}</dd>
        <dt className="est-total-row">Total</dt>
        <dd className="est-money est-total-row">{formatCents(t.total_cents)}</dd>
        <dt>Cost</dt>
        <dd className="est-money">{formatCents(t.cost_cents)}</dd>
        <dt>Margin</dt>
        <dd className="est-money">{formatCents(t.margin_cents)}</dd>
        <dt>Margin %</dt>
        <dd className="est-money">
          {t.total_cents > 0 ? pct(t.margin_bp) : '—'}
        </dd>
      </dl>
      {t.total_cents > 0 ? (
        <p className={t.below_target ? 'est-margin-flag est-margin-low' : 'est-margin-flag est-margin-ok'}>
          {t.below_target ? '▼ Below target' : '● On target'}
          {targetBp != null ? ` (target ${pct(targetBp)})` : ''}
        </p>
      ) : null}
      <div className="est-approval">
        <h3 className="a-label">Approval</h3>
        <p>
          <StatusPill status={status} />
        </p>
        {t.needs_approval ? (
          <>
            <p className="font-semibold">Needs an admin’s approval before it can be sent:</p>
            <ul className="est-reasons">
              {t.approval_reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="est-hint">No approval needed.</p>
        )}
        {approvalNote ? <p className="est-hint">Note: {approvalNote}</p> : null}
      </div>
      {engineError ? (
        <p role="alert" className="est-err">
          Can’t calculate yet: {engineError}
        </p>
      ) : null}
      {warnings.length ? (
        <div className="est-warnings">
          <h3 className="a-label">Warnings</h3>
          <ul className="est-reasons">
            {warnings.map((w) => (
              <li key={w}>
                <span aria-hidden="true">⚠ </span>
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
