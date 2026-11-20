/** Priced lines (with "how calculated", overrides) and manual lines. */
import { Fragment, useEffect, useRef, useState } from 'react';
import { LINE_CATEGORIES, LINE_CATEGORY_LABEL, formatCents, type EstimateLine, type LineCategory } from '../../../shared/estimate';
import { emptyManual, num, type Draft, type Errors, type ManualForm } from './model';
import { Field } from './shared';
import type { SetDraft } from './Sections';

const NOT_OVERRIDABLE = new Set(['transport.fuel', 'premium.rush', 'policy.minimum', 'discount', 'tax']);
const canOverride = (l: EstimateLine) => l.source === 'calc' && !NOT_OVERRIDABLE.has(l.key);
const qtyText = (q: number) => q.toLocaleString('en-US', { maximumFractionDigits: 2 });

function OverrideDialog({ line, existing, onSave, onClose }: { line: EstimateLine | null; existing: { qty?: number; unit_price_cents?: number; reason: string } | undefined; onSave: (key: string, o: { qty?: number; unit_price_cents?: number; reason: string }) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (line && !d.open) {
      const base = line.original ?? { qty: line.qty, unit_price_cents: line.unit_price_cents };
      setQty(String(existing?.qty ?? base.qty));
      setPrice(((existing?.unit_price_cents ?? base.unit_price_cents) / 100).toFixed(2));
      setReason(existing?.reason ?? '');
      setErr('');
      d.showModal();
    }
    if (!line && d.open) d.close();
  }, [line, existing]);
  if (!line) return <dialog ref={ref} className="a-dialog" onClose={onClose} aria-label="Override line" />;
  const base = line.original ?? { qty: line.qty, unit_price_cents: line.unit_price_cents };
  const submit = () => {
    const q = num(qty);
    const p = num(price);
    if (q == null || q < 0 || Math.abs(q * 100 - Math.round(q * 100)) > 1e-6) return setErr('Quantity must be a number with up to 2 decimals.');
    if (p == null || p < 0) return setErr('Unit price must be a number, $0 or more.');
    const cents = Math.round(p * 100);
    if (reason.trim().length < 3) return setErr('Add a reason (at least 3 characters).');
    const o: { qty?: number; unit_price_cents?: number; reason: string } = { reason: reason.trim() };
    if (q !== base.qty) o.qty = q;
    if (cents !== base.unit_price_cents) o.unit_price_cents = cents;
    if (o.qty === undefined && o.unit_price_cents === undefined) return setErr('Change the quantity or the unit price, or cancel.');
    onSave(line.key, o);
  };
  return (
    <dialog ref={ref} className="a-dialog" onClose={onClose} aria-labelledby="ov-title">
      <h2 id="ov-title" className="text-lg font-bold">
        Override line
      </h2>
      <p className="mt-1">{line.description}</p>
      <p className="est-hint">
        Calculated: {qtyText(base.qty)} {line.unit} × {formatCents(base.unit_price_cents)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Quantity">
          <input className="a-input est-num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Unit price ($)">
          <input className="a-input est-num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Reason (required)" className="col-span-2">
          <input className="a-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {err ? (
        <p role="alert" className="est-err">
          {err}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="a-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="a-btn a-btn-primary" onClick={submit}>
          Save override
        </button>
      </div>
    </dialog>
  );
}

export function LinesSection({ lines, d, set, readOnly }: { lines: EstimateLine[]; d: Draft; set: SetDraft; readOnly: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<EstimateLine | null>(null);
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(k)) n.add(k);
      return n;
    });
  const allOpen = lines.length > 0 && lines.every((l) => open.has(l.key));
  return (
    <section aria-labelledby="lines-h" className="a-panel est-section">
      <div className="est-section-head">
        <h2 id="lines-h" className="est-h2">
          Lines
        </h2>
        <button type="button" className="a-toggle est-tap" aria-pressed={allOpen} onClick={() => setOpen(allOpen ? new Set() : new Set(lines.map((l) => l.key)))}>
          ⓘ How calculated (all)
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="text-muted">No lines yet. Add items, stops and a vehicle and the price appears here.</p>
      ) : (
        <div className="est-table-wrap">
          <table className="a-table est-lines">
            <caption className="sr-only">Priced lines. Discounts are shown with a minus sign.</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Description</th>
                <th scope="col" className="est-r">
                  Qty
                </th>
                <th scope="col">Unit</th>
                <th scope="col" className="est-r">
                  Unit price
                </th>
                <th scope="col" className="est-r">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const isDiscount = l.category === 'discount';
                const ov = d.overrides[l.key];
                return (
                  <Fragment key={l.key}>
                    <tr className="est-line">
                      <td>{LINE_CATEGORY_LABEL[l.category]}</td>
                      <td>
                        <span>{l.description}</span>
                        {l.overridden ? (
                          <span className="est-badge">
                            Overridden
                            {l.original ? (
                              <>
                                {' '}
                                (was {qtyText(l.original.qty)} × {formatCents(l.original.unit_price_cents)})
                              </>
                            ) : null}
                          </span>
                        ) : null}
                        {!l.client_visible ? <span className="est-badge">Internal only</span> : null}
                        {l.source === 'manual' ? <span className="est-badge">Manual</span> : null}
                        {l.overridden && l.override_reason ? <span className="est-hint block">Reason: {l.override_reason}</span> : null}
                        <div className="est-actions">
                        <button type="button" className="a-btn a-btn-sm est-tap" aria-expanded={open.has(l.key)} aria-controls={`trace-${l.key}`} onClick={() => toggle(l.key)}>
                          ⓘ <span className="sr-only">How </span>calculated<span className="sr-only">: {l.description}</span>
                        </button>
                        {!readOnly && canOverride(l) ? (
                          <button type="button" className="a-btn a-btn-sm est-tap" onClick={() => setTarget(l)}>
                            Override<span className="sr-only">: {l.description}</span>
                          </button>
                        ) : null}
                        {!readOnly && l.overridden && ov ? (
                          <button
                            type="button"
                            className="a-btn a-btn-sm est-tap"
                            onClick={() =>
                              set((x) => {
                                const { [l.key]: _gone, ...rest } = x.overrides;
                                return { ...x, overrides: rest };
                              })
                            }
                          >
                            Clear override<span className="sr-only">: {l.description}</span>
                          </button>
                        ) : null}
                      </div>
                      </td>
                      <td className="est-r est-money">{qtyText(l.qty)}</td>
                      <td>{l.unit}</td>
                      <td className="est-r est-money">{formatCents(l.unit_price_cents)}</td>
                      <td className="est-r est-money">
                        {isDiscount ? <span className="est-discount-tag">Discount </span> : null}
                        {formatCents(l.amount_cents)}
                      </td>
                    </tr>
                    {open.has(l.key) ? (
                      <tr className="est-trace-row">
                        <td colSpan={6} id={`trace-${l.key}`}>
                          <p className="est-trace">{l.trace}</p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <OverrideDialog
        line={target}
        existing={target ? d.overrides[target.key] : undefined}
        onClose={() => setTarget(null)}
        onSave={(key, o) => {
          set((x) => ({ ...x, overrides: { ...x.overrides, [key]: o } }));
          setTarget(null);
        }}
      />
    </section>
  );
}

const MANUAL_CATEGORIES = LINE_CATEGORIES.filter((c): c is Exclude<LineCategory, 'discount' | 'tax'> => c !== 'discount' && c !== 'tax');

export function ManualLinesSection({ d, set, errors }: { d: Draft; set: SetDraft; errors: Errors }) {
  const patch = (id: string, p: Partial<ManualForm>) => set((x) => ({ ...x, manual: x.manual.map((m) => (m.id === id ? { ...m, ...p } : m)) }));
  return (
    <section aria-labelledby="manual-h" className="a-panel est-section">
      <div className="est-section-head">
        <h2 id="manual-h" className="est-h2">
          Manual lines
        </h2>
      </div>
      <p className="est-hint">Add anything the rate card doesn’t cover. Lines that are not client-visible are internal only and must have a price of $0 (they still count toward cost).</p>
      <ul className="mt-2 space-y-3">
        {d.manual.map((m, n) => {
          const k = `manual.${m.id}`;
          return (
            <li key={m.id} className="est-card">
              <div className="est-card-head">
                <h3 className="font-bold">Manual line {n + 1}</h3>
                <button type="button" className="a-btn a-btn-sm a-btn-danger est-tap" onClick={() => set((x) => ({ ...x, manual: x.manual.filter((y) => y.id !== m.id) }))}>
                  Remove manual line {n + 1}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Field label="Category" className="col-span-2">
                  <select className="a-select" value={m.category} onChange={(e) => patch(m.id, { category: e.target.value as ManualForm['category'] })}>
                    {MANUAL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {LINE_CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Description" error={errors[`${k}.description`]} className="col-span-2 md:col-span-4">
                  <input className="a-input" value={m.description} maxLength={200} onChange={(e) => patch(m.id, { description: e.target.value })} />
                </Field>
                <Field label="Quantity" error={errors[`${k}.qty`]}>
                  <input className="a-input est-num" inputMode="decimal" value={m.qty} onChange={(e) => patch(m.id, { qty: e.target.value })} />
                </Field>
                <Field label="Unit">
                  <input className="a-input" value={m.unit} maxLength={30} onChange={(e) => patch(m.id, { unit: e.target.value })} />
                </Field>
                <Field label="Unit price ($)" error={errors[`${k}.price`]}>
                  <input className="a-input est-num" inputMode="decimal" value={m.client_visible ? m.price : '0.00'} disabled={!m.client_visible} onChange={(e) => patch(m.id, { price: e.target.value })} />
                </Field>
                <Field label="Unit cost ($)" error={errors[`${k}.cost`]}>
                  <input className="a-input est-num" inputMode="decimal" value={m.cost} onChange={(e) => patch(m.id, { cost: e.target.value })} />
                </Field>
                <label className="est-check col-span-2">
                  <input type="checkbox" checked={m.client_visible} onChange={(e) => patch(m.id, e.target.checked ? { client_visible: true } : { client_visible: false, price: '0' })} />
                  <span>Client-visible (uncheck for an internal cost line)</span>
                </label>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className="a-btn est-add" onClick={() => set((x) => ({ ...x, manual: [...x.manual, emptyManual()] }))}>
        + Add manual line
      </button>
    </section>
  );
}
