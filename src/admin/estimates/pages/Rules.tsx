import { useCallback, useEffect, useState } from 'react';
import * as z from 'zod/mini';
import {
  ACCESS_KEYS,
  CREW_RULE_KINDS,
  PACKING_LABEL,
  PACKING_METHODS,
  crewRuleSchema,
  packingRuleSchema,
  type PackingRule,
} from '../../../shared/estimate';
import { ErrorNote } from '../../components/ui';
import { supabase } from '../../supabase';
import { getActiveRateCard } from '../rates/data';

type PRow = PackingRule & { id?: string; uid: string };
type CRow = { id?: string; uid: string; kind: (typeof CREW_RULE_KINDS)[number]; crew: number; param: string; equipment_key: string; note: string; position: number };

const CONDITIONS: { value: PackingRule['condition']; label: string }[] = [
  { value: 'any', label: 'Any trip' },
  { value: 'local', label: 'Local trip (within the first distance tier)' },
  { value: 'long_haul', label: 'Long-haul trip (beyond the first distance tier)' },
  { value: 'glazed', label: 'Glazed or framed (item has the glass flag)' },
  { value: 'heavy', label: 'Heavy item (at or above the heavy-item weight)' },
  { value: 'small', label: 'Small item (at or below the small-item size)' },
];

const CREW_KIND_INFO: Record<(typeof CREW_RULE_KINDS)[number], { label: string; help: string; paramLabel: string; paramUnit: string; crewLabel: string }> = {
  base: { label: 'Starting crew', help: 'Every move starts with this many people. Put it first.', paramLabel: '', paramUnit: '', crewLabel: 'Crew' },
  min_if_flat_over_sqft: { label: 'At least this many for large flat works', help: 'Raises the crew to at least this number when a flat work (2D, shallow) is bigger than the size below.', paramLabel: 'Larger than', paramUnit: 'square feet', crewLabel: 'At least (people)' },
  add_per_weight_band: { label: 'Add people by weight', help: 'Adds this many people for every full weight band of the heaviest item (250 lb band: a 600 lb item adds 2).', paramLabel: 'Per band of', paramUnit: 'lb', crewLabel: 'Add (people per band)' },
  min_if_flag: { label: 'At least this many when an item has a handling flag', help: 'Raises the crew to at least this number if any item carries the flag (for example two_person, top_heavy).', paramLabel: 'Handling flag', paramUnit: 'flag name', crewLabel: 'At least (people)' },
  add_if_access: { label: 'Add people for an access problem', help: 'Adds this many people when the estimate has the access surcharge below (stairs, long carry, and so on).', paramLabel: 'Access surcharge', paramUnit: '', crewLabel: 'Add (people)' },
  equipment_over_weight: { label: 'Require equipment for heavy items', help: 'Adds the equipment below to the estimate when the heaviest item weighs at least this much. Does not change the crew.', paramLabel: 'Heaviest item at least', paramUnit: 'lb', crewLabel: 'Crew (unused)' },
};

let seq = 0;
const uid = () => `r${++seq}`;

export function Rules() {
  const [packing, setPacking] = useState<PRow[] | null>(null);
  const [crew, setCrew] = useState<CRow[] | null>(null);
  const [removedP, setRemovedP] = useState<string[]>([]);
  const [removedC, setRemovedC] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<{ key: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'packing' | 'crew' | null>(null);

  const load = useCallback(async () => {
    const [p, c, a] = await Promise.all([
      supabase.from('packing_rules').select('*').order('position'),
      supabase.from('crew_size_rules').select('*').order('position'),
      getActiveRateCard(),
    ]);
    if (p.error || c.error) return setError((p.error ?? c.error)!.message);
    setPacking((p.data ?? []).map((r) => ({ ...(r as unknown as PackingRule), id: r.id, uid: uid() })));
    setCrew((c.data ?? []).map((r) => ({ id: r.id, uid: uid(), kind: r.kind as CRow['kind'], crew: r.crew, param: r.param, equipment_key: r.equipment_key ?? '', note: r.note, position: r.position })));
    setRemovedP([]);
    setRemovedC([]);
    setEquipment((a?.rates.equipment ?? []).map((e) => ({ key: e.key, label: e.label })));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  };

  async function savePacking() {
    if (!packing) return;
    setError(null);
    setNotice(null);
    const rows = packing.map((r, i) => ({ medium_match: r.medium_match.trim(), condition: r.condition, method: r.method, note: r.note, position: i + 1 }));
    for (let i = 0; i < rows.length; i++) {
      const v = z.safeParse(packingRuleSchema, rows[i]);
      if (!v.success) return setError(`Packing rule ${i + 1}: ${v.error.issues[0].message}. Medium keyword is required.`);
    }
    setBusy('packing');
    try {
      if (removedP.length) {
        const d = await supabase.from('packing_rules').delete().in('id', removedP);
        if (d.error) throw new Error(d.error.message);
      }
      for (let i = 0; i < packing.length; i++) {
        const r = packing[i];
        const res = r.id ? await supabase.from('packing_rules').update(rows[i]).eq('id', r.id) : await supabase.from('packing_rules').insert(rows[i]);
        if (res.error) throw new Error(res.error.message);
      }
      setNotice('Packing rules saved. They apply to new estimates and to drafts you reprice.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveCrew() {
    if (!crew) return;
    setError(null);
    setNotice(null);
    const rows = crew.map((r, i) => ({
      kind: r.kind,
      crew: r.crew,
      param: r.param.trim(),
      equipment_key: r.kind === 'equipment_over_weight' ? r.equipment_key : null,
      note: r.note,
      position: i + 1,
    }));
    for (let i = 0; i < rows.length; i++) {
      const v = z.safeParse(crewRuleSchema, { ...rows[i], equipment_key: rows[i].equipment_key ?? undefined });
      if (!v.success) return setError(`Crew rule ${i + 1}: ${v.error.issues[0].message}`);
      const r = rows[i];
      if (r.kind === 'equipment_over_weight' && !r.equipment_key) return setError(`Crew rule ${i + 1}: choose the equipment to require.`);
      if (['min_if_flat_over_sqft', 'add_per_weight_band', 'equipment_over_weight'].includes(r.kind) && !(Number(r.param) > 0)) return setError(`Crew rule ${i + 1}: enter a number greater than 0.`);
      if (['min_if_flag', 'add_if_access'].includes(r.kind) && !r.param) return setError(`Crew rule ${i + 1}: ${r.kind === 'min_if_flag' ? 'enter the handling flag' : 'choose the access surcharge'}.`);
    }
    setBusy('crew');
    try {
      if (removedC.length) {
        const d = await supabase.from('crew_size_rules').delete().in('id', removedC);
        if (d.error) throw new Error(d.error.message);
      }
      for (let i = 0; i < crew.length; i++) {
        const r = crew[i];
        const res = r.id ? await supabase.from('crew_size_rules').update(rows[i]).eq('id', r.id) : await supabase.from('crew_size_rules').insert(rows[i]);
        if (res.error) throw new Error(res.error.message);
      }
      setNotice('Crew rules saved. They apply to new estimates and to drafts you reprice.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-[800] tracking-tight">Packing &amp; crew rules</h1>
        <p role="note" className="mt-2 max-w-3xl border-l-4 border-ink bg-paper p-3">
          Changes here apply to <strong>new estimates</strong> and to <strong>drafts you reprice</strong>. Every estimate keeps its own snapshot of the rules it was priced with, so quotes already sent do not change.
        </p>
        <ErrorNote error={error} />
        {notice && (
          <p role="status" className="mt-2 border-l-4 border-ink pl-3 font-semibold">
            {notice}
          </p>
        )}
      </div>

      <section className="a-panel p-5" aria-labelledby="pack-h">
        <h2 id="pack-h" className="text-lg font-bold">
          Packing rules
        </h2>
        <p className="mt-1 max-w-3xl text-muted">
          The first rule that matches an item decides how it is packed. The medium keyword matches any part of the item&rsquo;s medium, ignoring capitals (&ldquo;paper&rdquo; matches &ldquo;Graphite on paper&rdquo;). If nothing matches, the rate card&rsquo;s default method is used. Order matters: put specific rules above general ones.
        </p>
        <div className="mt-4 overflow-x-auto border border-line">
          <table className="a-table">
            <caption className="sr-only">Packing rules in the order they are checked</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Medium contains</th>
                <th scope="col">Condition</th>
                <th scope="col">Packing method</th>
                <th scope="col">Note shown on estimate</th>
                <th scope="col"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody className="[&_tr]:!cursor-default">
              {packing?.map((r, i) => {
                const n = `Packing rule ${i + 1}`;
                const upd = (patch: Partial<PRow>) => setPacking((l) => l!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={r.uid}>
                    <td>
                      <div className="flex items-center gap-1">
                        <span className="w-5 tabular-nums">{i + 1}</span>
                        <button type="button" className="a-btn a-btn-sm !px-2" aria-label={`Move ${n} up`} disabled={i === 0} onClick={() => setPacking((l) => move(l!, i, -1))}>{'↑'}</button>
                        <button type="button" className="a-btn a-btn-sm !px-2" aria-label={`Move ${n} down`} disabled={i === packing.length - 1} onClick={() => setPacking((l) => move(l!, i, 1))}>{'↓'}</button>
                      </div>
                    </td>
                    <td><input className="a-input w-40" aria-label={`${n} medium keyword`} value={r.medium_match} maxLength={80} onChange={(e) => upd({ medium_match: e.currentTarget.value })} /></td>
                    <td>
                      <select className="a-select w-60" aria-label={`${n} condition`} value={r.condition} onChange={(e) => upd({ condition: e.currentTarget.value as PRow['condition'] })}>
                        {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="a-select w-52" aria-label={`${n} packing method`} value={r.method} onChange={(e) => upd({ method: e.currentTarget.value as PRow['method'] })}>
                        {PACKING_METHODS.map((m) => <option key={m} value={m}>{PACKING_LABEL[m]}</option>)}
                      </select>
                    </td>
                    <td><input className="a-input w-72" aria-label={`${n} note`} value={r.note} maxLength={200} onChange={(e) => upd({ note: e.currentTarget.value })} /></td>
                    <td>
                      <button type="button" className="a-btn a-btn-sm a-btn-danger" aria-label={`Remove ${n}`} onClick={() => { if (r.id) setRemovedP((x) => [...x, r.id!]); setPacking((l) => l!.filter((_, j) => j !== i)); }}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="a-btn a-btn-sm" onClick={() => setPacking((l) => [...(l ?? []), { uid: uid(), medium_match: '', condition: 'any', method: 'standard_crate', note: '', position: (l?.length ?? 0) + 1 }])}>
            + Add packing rule
          </button>
          <button type="button" className="a-btn a-btn-primary" disabled={busy !== null} onClick={savePacking}>
            {busy === 'packing' ? 'Saving…' : 'Save packing rules'}
          </button>
        </div>
      </section>

      <section className="a-panel p-5" aria-labelledby="crew-h">
        <h2 id="crew-h" className="text-lg font-bold">
          Crew size rules
        </h2>
        <p className="mt-1 max-w-3xl text-muted">
          Rules run top to bottom to suggest a crew size. Start with a &ldquo;Starting crew&rdquo; rule, then raise or add people for heavy, large or hard-to-reach work. An estimator can still override the crew with a reason.
        </p>
        <ol className="mt-4 space-y-4">
          {crew?.map((r, i) => {
            const info = CREW_KIND_INFO[r.kind];
            const n = `Crew rule ${i + 1}`;
            const upd = (patch: Partial<CRow>) => setCrew((l) => l!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            const eqOpts = equipment.some((e) => e.key === r.equipment_key) || !r.equipment_key ? equipment : [...equipment, { key: r.equipment_key, label: `${r.equipment_key} (not on the active card)` }];
            return (
              <li key={r.uid} className="border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">{n}: {info.label}</h3>
                  <div className="flex gap-1">
                    <button type="button" className="a-btn a-btn-sm !px-2" aria-label={`Move ${n} up`} disabled={i === 0} onClick={() => setCrew((l) => move(l!, i, -1))}>{'↑'}</button>
                    <button type="button" className="a-btn a-btn-sm !px-2" aria-label={`Move ${n} down`} disabled={i === crew.length - 1} onClick={() => setCrew((l) => move(l!, i, 1))}>{'↓'}</button>
                    <button type="button" className="a-btn a-btn-sm a-btn-danger" aria-label={`Remove ${n}`} onClick={() => { if (r.id) setRemovedC((x) => [...x, r.id!]); setCrew((l) => l!.filter((_, j) => j !== i)); }}>Remove</button>
                  </div>
                </div>
                <p className="mt-1 text-[0.8125rem] text-muted">{info.help}</p>
                <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label htmlFor={`ck-${r.uid}`} className="a-label">Rule type</label>
                    <select id={`ck-${r.uid}`} className="a-select" value={r.kind} onChange={(e) => upd({ kind: e.currentTarget.value as CRow['kind'], param: '' })}>
                      {CREW_RULE_KINDS.map((k) => <option key={k} value={k}>{CREW_KIND_INFO[k].label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`cc-${r.uid}`} className="a-label">{info.crewLabel}</label>
                    <div className="flex items-center gap-1.5">
                      <input id={`cc-${r.uid}`} type="number" min={0} max={20} step={1} className="a-input w-24" value={r.crew} onChange={(e) => upd({ crew: Math.max(0, Math.min(20, Math.trunc(Number(e.currentTarget.value) || 0))) })} />
                      <span className="text-muted">people</span>
                    </div>
                  </div>
                  {r.kind !== 'base' && (
                    <div>
                      <label htmlFor={`cp-${r.uid}`} className="a-label">{info.paramLabel}</label>
                      {r.kind === 'add_if_access' ? (
                        <select id={`cp-${r.uid}`} className="a-select" value={r.param} onChange={(e) => upd({ param: e.currentTarget.value })}>
                          <option value="">Choose…</option>
                          {ACCESS_KEYS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
                        </select>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input id={`cp-${r.uid}`} className={`a-input ${r.kind === 'min_if_flag' ? 'w-44' : 'w-28 text-right'}`} inputMode={r.kind === 'min_if_flag' ? 'text' : 'decimal'} value={r.param} maxLength={60} onChange={(e) => upd({ param: e.currentTarget.value })} />
                          <span className="text-muted">{info.paramUnit}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {r.kind === 'equipment_over_weight' && (
                    <div>
                      <label htmlFor={`ce-${r.uid}`} className="a-label">Equipment to require</label>
                      <select id={`ce-${r.uid}`} className="a-select" value={r.equipment_key} onChange={(e) => upd({ equipment_key: e.currentTarget.value })}>
                        <option value="">Choose…</option>
                        {eqOpts.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <label htmlFor={`cn-${r.uid}`} className="a-label">Note shown as the reason</label>
                    <input id={`cn-${r.uid}`} className="a-input" value={r.note} maxLength={200} onChange={(e) => upd({ note: e.currentTarget.value })} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="a-btn a-btn-sm" onClick={() => setCrew((l) => [...(l ?? []), { uid: uid(), kind: 'add_if_access', crew: 1, param: '', equipment_key: '', note: '', position: (l?.length ?? 0) + 1 }])}>
            + Add crew rule
          </button>
          <button type="button" className="a-btn a-btn-primary" disabled={busy !== null} onClick={saveCrew}>
            {busy === 'crew' ? 'Saving…' : 'Save crew rules'}
          </button>
        </div>
      </section>
    </div>
  );
}
