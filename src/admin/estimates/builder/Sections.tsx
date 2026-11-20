/** Form sections of the estimate builder. Each edits the shared Draft through `set`. */
import type { ReactNode } from 'react';
import {
  ACCESS_KEYS,
  ADDON_KEYS,
  PACKING_LABEL,
  PACKING_METHODS,
  type EstimateResult,
  type PackingMethod,
  type Rates,
} from '../../../shared/estimate';
import {
  ACCESS_FLAGS,
  ACCESS_FLAG_LABEL,
  HANDLING_FLAGS,
  HANDLING_FLAG,
  JOB_TYPES,
  JOB_TYPE_LABEL,
  STOP_KINDS,
  STOP_KIND_LABEL,
  formatPhone,
  toE164,
  type StopKind,
} from '../../../shared/dispatch';
import { Link } from '../../router';
import type { ClientRow, ContactRow } from '../data';
import { emptyItem, emptyStop, type Draft, type Errors, type ItemForm, type StopForm } from './model';
import { Field } from './shared';

export type SetDraft = (fn: (d: Draft) => Draft) => void;

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="a-panel est-section">
      <div className="est-section-head">
        <h2 id={`${id}-h`} className="est-h2">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

// ── Client, service, basics ──────────────────────────────────────────────────
export function BasicsSection({
  d,
  set,
  errors,
  clients,
  contacts,
}: {
  d: Draft;
  set: SetDraft;
  errors: Errors;
  clients: ClientRow[];
  contacts: ContactRow[];
}) {
  const client = clients.find((c) => c.id === d.client_id);
  return (
    <Section id="basics" title="Client and service">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Title" error={errors.title} className="md:col-span-2">
          <input className="a-input" value={d.title} maxLength={140} onChange={(e) => set((x) => ({ ...x, title: e.target.value }))} />
        </Field>
        <Field label="Client">
          <select className="a-select" value={d.client_id} onChange={(e) => set((x) => ({ ...x, client_id: e.target.value, contact_id: '' }))}>
            <option value="">No client yet</option>
            {clients
              .filter((c) => c.active || c.id === d.client_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Contact" hint={d.client_id && !contacts.length ? 'This client has no contacts yet.' : undefined}>
          <select className="a-select" value={d.contact_id} disabled={!d.client_id} onChange={(e) => set((x) => ({ ...x, contact_id: e.target.value }))}>
            <option value="">No contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.role ? ` (${c.role})` : ''}
                {c.is_primary ? ' · primary' : ''}
              </option>
            ))}
          </select>
        </Field>
        <p className="est-hint md:col-span-2">
          {client ? (
            <>
              Client default discount: <strong>{(client.default_discount_bp / 100).toFixed(2)}%</strong>.{' '}
            </>
          ) : null}
          <Link href={client ? `/admin/estimates/clients/${client.id}` : '/admin/estimates/clients/new'} className="underline">
            {client ? 'Edit this client' : 'Add a new client'}
          </Link>{' '}
          (opens the client page; come back here afterwards).
        </p>
        <Field label="Service type">
          <select className="a-select" value={d.service_type} onChange={(e) => set((x) => ({ ...x, service_type: e.target.value as Draft['service_type'] }))}>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {JOB_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Requested date">
          <input className="a-input" type="date" value={d.requested_date} onChange={(e) => set((x) => ({ ...x, requested_date: e.target.value }))} />
        </Field>
        <Field label="Internal notes (never shown to the client)">
          <textarea className="a-textarea" value={d.notes_internal} maxLength={4000} onChange={(e) => set((x) => ({ ...x, notes_internal: e.target.value }))} />
        </Field>
        <Field label="Notes for the client (shown on the quote)">
          <textarea className="a-textarea" value={d.notes_client} maxLength={4000} onChange={(e) => set((x) => ({ ...x, notes_client: e.target.value }))} />
        </Field>
      </div>
    </Section>
  );
}

// ── Stops ────────────────────────────────────────────────────────────────────
export function StopsSection({ d, set, errors, result }: { d: Draft; set: SetDraft; errors: Errors; result: EstimateResult | null }) {
  const patch = (i: number, p: Partial<StopForm>) => set((x) => ({ ...x, stops: x.stops.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const move = (i: number, dir: -1 | 1) =>
    set((x) => {
      const j = i + dir;
      if (j < 0 || j >= x.stops.length) return x;
      const stops = [...x.stops];
      [stops[i], stops[j]] = [stops[j], stops[i]];
      return { ...x, stops };
    });
  return (
    <Section
      id="stops"
      title="Stops"
      aside={
        result ? (
          <p className="est-summary" aria-live="polite">
            Total distance <strong className="est-money">{result.distance.total_miles} mi</strong> · Distance tier <strong>{result.distance.tier_label}</strong>
          </p>
        ) : null
      }
    >
      {d.stops.length === 0 ? <p className="text-muted">No stops yet. Add the pickup and delivery addresses.</p> : null}
      <ol className="space-y-3">
        {d.stops.map((st, i) => (
          <li key={i} className="est-card">
            <div className="est-card-head">
              <h3 className="font-bold">Stop {i + 1}</h3>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="a-btn a-btn-sm est-tap" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move stop ${i + 1} up`}>
                  ↑ Up
                </button>
                <button type="button" className="a-btn a-btn-sm est-tap" onClick={() => move(i, 1)} disabled={i === d.stops.length - 1} aria-label={`Move stop ${i + 1} down`}>
                  ↓ Down
                </button>
                <button type="button" className="a-btn a-btn-sm a-btn-danger est-tap" onClick={() => set((x) => ({ ...x, stops: x.stops.filter((_, j) => j !== i) }))}>
                  Remove stop {i + 1}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <Field label="Kind" className="md:col-span-2">
                <select className="a-select" value={st.kind} onChange={(e) => patch(i, { kind: e.target.value as StopKind })}>
                  {STOP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {STOP_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Site name" className="md:col-span-4">
                <input className="a-input" value={st.site_name} maxLength={140} onChange={(e) => patch(i, { site_name: e.target.value })} />
              </Field>
              <Field label="Address" error={errors[`stop.${i}.address`]} className="md:col-span-6">
                <input className="a-input" value={st.address} maxLength={300} onChange={(e) => patch(i, { address: e.target.value })} />
              </Field>
              <Field label="Contact name" className="md:col-span-3">
                <input className="a-input" value={st.contact_name} maxLength={100} onChange={(e) => patch(i, { contact_name: e.target.value })} />
              </Field>
              <Field
                label="Contact phone"
                error={errors[`stop.${i}.phone`]}
                hint={st.contact_phone && toE164(st.contact_phone) ? formatPhone(toE164(st.contact_phone)) : undefined}
                className="md:col-span-3"
              >
                <input className="a-input" inputMode="tel" value={st.contact_phone} onChange={(e) => patch(i, { contact_phone: e.target.value })} />
              </Field>
              <Field
                label="Miles from previous stop"
                error={errors[`stop.${i}.miles`]}
                hint={i === 0 ? 'The first stop has no previous stop.' : 'Enter driving miles, 0 to 5,000 (one decimal).'}
                className="md:col-span-3"
              >
                <input
                  className="a-input est-num"
                  inputMode="decimal"
                  value={i === 0 ? '' : st.miles}
                  disabled={i === 0}
                  placeholder={i === 0 ? 'Not needed' : '0.0'}
                  onChange={(e) => patch(i, { miles: e.target.value })}
                />
              </Field>
              <Field label="Access notes" className="md:col-span-3">
                <input className="a-input" value={st.access_notes} maxLength={2000} onChange={(e) => patch(i, { access_notes: e.target.value })} />
              </Field>
              <fieldset className="md:col-span-6">
                <legend className="a-label">Access flags at this stop</legend>
                <div className="flex flex-wrap gap-1.5">
                  {ACCESS_FLAGS.map((f) => (
                    <button key={f} type="button" className="a-toggle est-tap" aria-pressed={st.access_flags.includes(f)} onClick={() => patch(i, { access_flags: toggle(st.access_flags, f) })}>
                      {ACCESS_FLAG_LABEL[f]}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="a-btn est-add"
        onClick={() => set((x) => ({ ...x, stops: [...x.stops, emptyStop(x.stops.length === 0 ? 'origin' : 'destination')] }))}
      >
        + Add stop
      </button>
    </Section>
  );
}

// ── Items ────────────────────────────────────────────────────────────────────
export function ItemsSection({ d, set, errors, result }: { d: Draft; set: SetDraft; errors: Errors; result: EstimateResult | null }) {
  const patch = (id: string, p: Partial<ItemForm>) => set((x) => ({ ...x, items: x.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
  return (
    <Section id="items" title="Items">
      {d.items.length === 0 ? <p className="text-muted">No items yet. Add each artwork or object being moved.</p> : null}
      <ol className="space-y-3">
        {d.items.map((it, n) => {
          const k = `item.${it.id}`;
          const pk = result?.packing.find((p) => p.item_id === it.id);
          const sugg = pk?.suggested;
          return (
            <li key={it.id} className="est-card">
              <div className="est-card-head">
                <h3 className="font-bold">Item {n + 1}</h3>
                <button type="button" className="a-btn a-btn-sm a-btn-danger est-tap" onClick={() => set((x) => ({ ...x, items: x.items.filter((y) => y.id !== it.id) }))}>
                  Remove item {n + 1}
                </button>
              </div>
              <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-6">
                <Field label="Description" error={errors[`${k}.description`]} className="col-span-2 md:col-span-3">
                  <input className="a-input" value={it.description} maxLength={300} onChange={(e) => patch(it.id, { description: e.target.value })} />
                </Field>
                <Field label="Artist / title" className="col-span-2 md:col-span-3">
                  <input className="a-input" value={it.artist_title} maxLength={200} onChange={(e) => patch(it.id, { artist_title: e.target.value })} />
                </Field>
                <Field label="Medium (drives packing)" className="col-span-2 md:col-span-2">
                  <input className="a-input" value={it.medium} maxLength={120} onChange={(e) => patch(it.id, { medium: e.target.value })} />
                </Field>
                <Field label="Height (in)" error={errors[`${k}.height_in`]}>
                  <input className="a-input est-num" inputMode="decimal" value={it.height_in} onChange={(e) => patch(it.id, { height_in: e.target.value })} />
                </Field>
                <Field label="Width (in)" error={errors[`${k}.width_in`]}>
                  <input className="a-input est-num" inputMode="decimal" value={it.width_in} onChange={(e) => patch(it.id, { width_in: e.target.value })} />
                </Field>
                <Field label="Depth (in)" error={errors[`${k}.depth_in`]}>
                  <input className="a-input est-num" inputMode="decimal" value={it.depth_in} onChange={(e) => patch(it.id, { depth_in: e.target.value })} />
                </Field>
                <Field label="Weight (lb)" error={errors[`${k}.weight_lbs`]}>
                  <input className="a-input est-num" inputMode="decimal" value={it.weight_lbs} onChange={(e) => patch(it.id, { weight_lbs: e.target.value })} />
                </Field>
                <Field label="Quantity" error={errors[`${k}.quantity`]}>
                  <input className="a-input est-num" inputMode="numeric" value={it.quantity} onChange={(e) => patch(it.id, { quantity: e.target.value })} />
                </Field>
                <Field label="Declared value ($)" error={errors[`${k}.declared`]} className="col-span-2">
                  <input className="a-input est-num" inputMode="decimal" value={it.declared} onChange={(e) => patch(it.id, { declared: e.target.value })} />
                </Field>
                <fieldset className="col-span-2 md:col-span-6">
                  <legend className="a-label">Handling flags</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {HANDLING_FLAGS.map((f) => (
                      <button key={f} type="button" className="a-toggle est-tap" aria-pressed={it.handling_flags.includes(f)} onClick={() => patch(it.id, { handling_flags: toggle(it.handling_flags, f) })}>
                        <span aria-hidden="true">{HANDLING_FLAG[f].glyph}&nbsp;</span>
                        {HANDLING_FLAG[f].label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="col-span-2 md:col-span-6 est-pack">
                  <p className="est-suggest" aria-live="polite">
                    <strong>Suggested packing:</strong> {sugg ? PACKING_LABEL[sugg as PackingMethod] : 'add a medium and size'}
                    {pk ? <span className="text-muted"> — {pk.reason}</span> : null}
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label="Packing method" error={errors[`${k}.packing`]}>
                      <select
                        className="a-select"
                        value={it.packing_method}
                        onChange={(e) => {
                          const v = e.target.value as ItemForm['packing_method'];
                          patch(it.id, v === sugg ? { packing_method: '', packing_override_reason: '' } : { packing_method: v, packing_override_reason: v ? it.packing_override_reason : '' });
                        }}
                      >
                        <option value="">Use the suggestion{sugg ? ` (${PACKING_LABEL[sugg as PackingMethod]})` : ''}</option>
                        {PACKING_METHODS.filter((m) => m !== sugg).map((m) => (
                          <option key={m} value={m}>
                            {PACKING_LABEL[m]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {it.packing_method ? (
                      <Field label="Reason for changing the packing method (required)" error={errors[`${k}.reason`]}>
                        <input className="a-input" value={it.packing_override_reason} maxLength={300} onChange={(e) => patch(it.id, { packing_override_reason: e.target.value })} />
                      </Field>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" className="a-btn est-add" onClick={() => set((x) => ({ ...x, items: [...x.items, emptyItem()] }))}>
        + Add item
      </button>
    </Section>
  );
}

// ── Crew, labor, vehicle ─────────────────────────────────────────────────────
export function CrewSection({ d, set, errors, rates, result }: { d: Draft; set: SetDraft; errors: Errors; rates: Rates; result: EstimateResult | null }) {
  const crew = result?.crew;
  return (
    <Section id="crew" title="Crew and labor">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Labor hours" error={errors.labor_hours} hint="On-site and driving hours for the job.">
          <input className="a-input est-num" inputMode="decimal" value={d.labor_hours} onChange={(e) => set((x) => ({ ...x, labor_hours: e.target.value }))} />
        </Field>
        <Field label="Vehicle">
          <select className="a-select" value={d.vehicle_key} onChange={(e) => set((x) => ({ ...x, vehicle_key: e.target.value }))}>
            <option value="">No vehicle</option>
            {rates.vehicles.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vehicle hours" error={errors.vehicle_hours}>
          <input className="a-input est-num" inputMode="decimal" value={d.vehicle_hours} disabled={!d.vehicle_key} onChange={(e) => set((x) => ({ ...x, vehicle_hours: e.target.value }))} />
        </Field>
      </div>
      <div className="est-pack mt-3">
        <p className="est-suggest" aria-live="polite">
          <strong>Suggested crew:</strong> {crew ? `${crew.suggested} ${crew.suggested === 1 ? 'person' : 'people'}` : 'not available yet'}
          {crew?.overridden ? (
            <span>
              {' '}
              · <strong>Applied (override): {crew.applied}</strong>
            </span>
          ) : null}
        </p>
        {crew?.reasons.length ? (
          <ul className="est-reasons">
            {crew.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Override crew count" error={errors.crew_count} hint="Leave blank to use the suggestion.">
            <input className="a-input est-num" inputMode="numeric" value={d.crew_count} onChange={(e) => set((x) => ({ ...x, crew_count: e.target.value }))} />
          </Field>
          {d.crew_count.trim() !== '' ? (
            <Field label="Reason for the override (required)" error={errors.crew_reason} className="md:col-span-2">
              <input className="a-input" value={d.crew_reason} maxLength={300} onChange={(e) => set((x) => ({ ...x, crew_reason: e.target.value }))} />
            </Field>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

// ── Equipment, access, add-ons, premiums, discount ───────────────────────────
export function ExtrasSection({ d, set, errors, rates, result, clientDefaultBp }: { d: Draft; set: SetDraft; errors: Errors; rates: Rates; result: EstimateResult | null; clientDefaultBp: number }) {
  const setQty = (group: 'access' | 'addons', key: string, v: string) => set((x) => ({ ...x, [group]: { ...x[group], [key]: v } }));
  const surchargeInputs = (group: 'access' | 'addons', keys: readonly string[], table: Rates['access'] | Rates['addons']) =>
    keys.map((k) => {
      const sc = (table as Record<string, Rates['access'][keyof Rates['access']]>)[k];
      if (!sc) return null;
      const on = Number(d[group][k] ?? 0) > 0;
      return sc.mode === 'flat' ? (
        <label key={k} className="est-check">
          <input type="checkbox" checked={on} onChange={(e) => setQty(group, k, e.target.checked ? '1' : '')} />
          <span>{sc.label}</span>
        </label>
      ) : (
        <Field key={k} label={`${sc.label}: quantity`} error={errors[`qty.${k}`]}>
          <input className="a-input est-num" inputMode="decimal" value={d[group][k] ?? ''} onChange={(e) => setQty(group, k, e.target.value)} />
        </Field>
      );
    });
  return (
    <>
      <Section id="equipment" title="Equipment">
        {result?.required_equipment.length ? (
          <p className="est-hint">
            Added automatically for the heavy or tall items: <strong>{result.required_equipment.map((k) => rates.equipment.find((e) => e.key === k)?.label ?? k).join(', ')}</strong>.
          </p>
        ) : null}
        <ul className="space-y-2">
          {d.equipment.map((eq, i) => (
            <li key={i} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
              <Field label="Extra equipment">
                <select className="a-select" value={eq.key} onChange={(e) => set((x) => ({ ...x, equipment: x.equipment.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)) }))}>
                  {rates.equipment.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Days" error={errors[`equipment.${i}`]}>
                <input className="a-input est-num" inputMode="decimal" value={eq.days} onChange={(e) => set((x) => ({ ...x, equipment: x.equipment.map((y, j) => (j === i ? { ...y, days: e.target.value } : y)) }))} />
              </Field>
              <button type="button" className="a-btn a-btn-danger" onClick={() => set((x) => ({ ...x, equipment: x.equipment.filter((_, j) => j !== i) }))} aria-label={`Remove equipment row ${i + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {rates.equipment.length ? (
          <button type="button" className="a-btn est-add" onClick={() => set((x) => ({ ...x, equipment: [...x.equipment, { key: rates.equipment[0].key, days: '1' }] }))}>
            + Add equipment
          </button>
        ) : null}
      </Section>

      <Section id="access" title="Access and add-ons">
        <fieldset>
          <legend className="a-label">Access surcharges</legend>
          <div className="est-checks">{surchargeInputs('access', ACCESS_KEYS, rates.access)}</div>
        </fieldset>
        <fieldset className="mt-3">
          <legend className="a-label">Add-ons</legend>
          <div className="est-checks">{surchargeInputs('addons', ADDON_KEYS, rates.addons)}</div>
        </fieldset>
        <fieldset className="mt-3">
          <legend className="a-label">Timing and premiums</legend>
          <div className="est-checks">
            <label className="est-check">
              <input type="checkbox" checked={d.after_hours} onChange={(e) => set((x) => ({ ...x, after_hours: e.target.checked }))} />
              <span>After hours</span>
            </label>
            <label className="est-check">
              <input type="checkbox" checked={d.weekend} onChange={(e) => set((x) => ({ ...x, weekend: e.target.checked }))} />
              <span>Weekend</span>
            </label>
            <label className="est-check">
              <input type="checkbox" checked={d.rush} onChange={(e) => set((x) => ({ ...x, rush: e.target.checked }))} />
              <span>Rush</span>
            </label>
          </div>
        </fieldset>
        <div className="mt-3 max-w-xs">
          <Field label="Discount (%)" error={errors.discount_pct} hint={`Leave blank to use the client default (${(clientDefaultBp / 100).toFixed(2)}%).`}>
            <input className="a-input est-num" inputMode="decimal" value={d.discount_pct} placeholder={(clientDefaultBp / 100).toFixed(2)} onChange={(e) => set((x) => ({ ...x, discount_pct: e.target.value }))} />
          </Field>
        </div>
      </Section>
    </>
  );
}
