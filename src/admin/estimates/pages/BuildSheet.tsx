import { useEffect, useState } from 'react';
import { displayName } from '../../../brand/brand.config';
import { HANDLING_FLAG, type HandlingFlag } from '../../../shared/dispatch';
import {
  PACKING_LABEL,
  computeEstimate,
  crewRuleSchema,
  packingRuleSchema,
  ratesSchema,
  type CrateTakeoff,
  type EstimateInput,
  type EstimateResult,
  type RateSnapshot,
} from '../../../shared/estimate';
import { ErrorNote } from '../../components/ui';
import { Link } from '../../router';
import { supabase } from '../../supabase';

/**
 * Shop crate build sheet: one block per crate, NO PRICES anywhere. Dimensions, materials takeoff,
 * cushioning spec by medium, orientation / handling flags and the stencil text for the lid.
 * Print / Save as PDF is the deliverable; printing is audited. Black on white on screen and paper.
 */

interface Loaded {
  number: string;
  revision: number;
  title: string;
  result: EstimateResult;
  snap: RateSnapshot;
  items: Map<string, { h: number | null; w: number | null; d: number | null; weight: number | null }>;
  itemNames: Map<string, string>;
}

// Same mapping as netlify/lib/estimateServer.ts (parseSnapshot + engineInput), minus the server-only bits.
function parseSnapshot(raw: unknown): RateSnapshot {
  const s = raw as { rates?: unknown; packing_rules?: unknown[]; crew_rules?: unknown[] } | null;
  const rates = ratesSchema.safeParse(s?.rates);
  if (!rates.success) throw new Error('This estimate’s rate card is invalid. Reprice it with the current rate card.');
  const packing = (s?.packing_rules ?? []).map((r) => packingRuleSchema.parse(r));
  const crew = (s?.crew_rules ?? []).map((r) => crewRuleSchema.parse({ ...(r as object), equipment_key: (r as { equipment_key?: string | null }).equipment_key ?? undefined }));
  return { rates: rates.data, packing_rules: packing, crew_rules: crew };
}

const n = (v: number | string | null) => (v == null ? null : Number(v));

async function load(id: string): Promise<Loaded> {
  const { data: est, error } = await supabase.from('estimates').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!est) throw new Error('Estimate not found.');
  if (!est.rate_snapshot) throw new Error('This estimate has no rate card yet, so there is nothing to size crates from.');
  const [items, stops, cl] = await Promise.all([
    supabase.from('estimate_items').select('*').eq('estimate_id', id).order('position'),
    supabase.from('estimate_stops').select('*').eq('estimate_id', id).order('position'),
    est.client_id ? supabase.from('clients').select('default_discount_bp').eq('id', est.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (items.error) throw new Error(items.error.message);
  if (stops.error) throw new Error(stops.error.message);
  const inputs = (est.inputs ?? {}) as Partial<EstimateInput>;
  const input: EstimateInput = {
    options: { ...(inputs.options ?? {}), service_type: est.service_type } as EstimateInput['options'],
    overrides: inputs.overrides ?? {},
    manual_lines: inputs.manual_lines ?? [],
    client_default_discount_bp: cl.data?.default_discount_bp ?? 0,
    stops: (stops.data ?? []).map((s) => ({ miles_from_previous: n(s.miles_from_previous) })),
    items: (items.data ?? []).map((i) => ({
      id: i.id,
      description: i.description,
      medium: i.medium,
      height_in: n(i.height_in),
      width_in: n(i.width_in),
      depth_in: n(i.depth_in),
      weight_lbs: n(i.weight_lbs),
      quantity: i.quantity,
      declared_value_cents: n(i.declared_value_cents),
      handling_flags: i.handling_flags,
      packing_method: (i.packing_method as EstimateInput['items'][number]['packing_method']) ?? null,
    })),
  };
  const snap = parseSnapshot(est.rate_snapshot);
  return {
    number: est.estimate_number,
    revision: est.revision,
    title: est.title,
    result: computeEstimate(input, snap),
    snap,
    items: new Map((items.data ?? []).map((i) => [i.id, { h: n(i.height_in), w: n(i.width_in), d: n(i.depth_in), weight: n(i.weight_lbs) }])),
    itemNames: new Map((items.data ?? []).map((i) => [i.id, i.description])),
  };
}

/** Cushioning spec: the packing method wins, then the medium. */
export function cushionSpec(c: Pick<CrateTakeoff, 'method' | 'medium'>, foamIn: number): string[] {
  const m = (c.medium ?? '').toLowerCase();
  const foam = `${foamIn}-inch foam on all inner faces`;
  if (c.method === 'skid_bracing') return ['Blocking and bracing on a skid: no foam lining', 'Cross-brace at the center of gravity; strap to the skid', 'Pad every contact point'];
  if (c.method === 'double_boxed' || /ceramic|glass|porcelain|vitrine/.test(m)) return ['Double box: inner box floated in foam inside the outer crate', foam, 'Wrap the work in glassine or poly, then foam-in-place or cut foam nests'];
  if (/paper|drawing|print|photo|watercolor|pastel|etching|lithograph/.test(m)) return ['Glassine wrap against the work, then acid-free board', foam, 'Frame corners protected; glazing taped (X-tape) if glazed'];
  if (/canvas|oil|acrylic|paint/.test(m)) return ['Corner blocks and foam; canvas face never touches foam or crate wall', foam, 'Stretcher-bar supports; use a glassine face sheet'];
  if (/sculpt|bronze|stone|marble|steel|metal|wood|resin|plaster/.test(m)) return ['Blocking and bracing; contact points padded', 'Support at the base and center of gravity; no load on projections', foam];
  return [foam, 'Wrap in glassine or poly before foam; no bare contact with crate walls'];
}

/** Stencil lines for the lid and ends. */
export function stencilLines(flags: string[]): string[] {
  const has = (...f: string[]) => f.some((x) => flags.includes(x));
  const out: string[] = [];
  if (has('upright', 'top_heavy')) out.push('THIS SIDE UP');
  if (has('fragile', 'glass')) out.push('FRAGILE');
  if (has('no_stack')) out.push('DO NOT STACK');
  if (has('keep_flat')) out.push('KEEP FLAT');
  return out;
}

const dims = (d: [number, number, number]) => `${d[0]} × ${d[1]} × ${d[2]} in`;
const flagText = (flags: string[]) => flags.map((f) => HANDLING_FLAG[f as HandlingFlag]?.label ?? f);

function orientation(flags: string[]): string {
  if (flags.includes('keep_flat')) return 'Ride flat. Do not tip on edge.';
  if (flags.includes('upright') || flags.includes('top_heavy')) return flags.includes('top_heavy') ? 'Ride upright. Top-heavy: keep the heavy end down and strap.' : 'Ride upright, on the long edge.';
  return 'No orientation restriction; follow the arrows on the lid.';
}

export function BuildSheet({ id }: { id: unknown }) {
  const estimateId = String(id);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    load(estimateId)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [estimateId]);

  async function print() {
    const { error: err } = await supabase.rpc('log_estimate_export', { p_estimate: estimateId, p_format: 'build_sheet', p_internal: false });
    if (err) {
      setError(`Couldn’t log this export: ${err.message}`);
      return;
    }
    window.print();
  }

  const crated = new Set(data?.result.crates.map((c) => c.item_id));
  const notCrated = data ? [...data.itemNames.entries()].filter(([k]) => !crated.has(k)) : [];
  const packOf = (itemId: string) => data?.result.packing.find((p) => p.item_id === itemId)?.chosen;

  return (
    <div>
      <div className="no-print a-panel mb-5 flex flex-wrap items-center gap-3 p-4">
        <div className="mr-auto">
          <h1 className="text-xl font-[800] tracking-tight">Crate build sheet</h1>
          <p className="text-muted">For the shop. No prices.</p>
        </div>
        <button type="button" className="a-btn a-btn-primary" onClick={() => void print()} disabled={!data}>
          Print / Save as PDF
        </button>
        <Link href={`/admin/estimates/${estimateId}`} className="a-btn">
          Back to estimate
        </Link>
      </div>
      <ErrorNote error={error} />
      {!data && !error && <p className="text-muted">Loading…</p>}

      {data && (
        <article aria-label="Crate build sheet" className="mx-auto max-w-[56rem] bg-white p-6 text-black print:max-w-none print:p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-black pb-2">
            <span className="stencil">{displayName()}</span>
            <span className="text-[0.9rem]">
              Crate build sheet · <strong>{data.number}</strong> rev {data.revision}
            </span>
          </div>
          <h2 className="mt-3 text-[1.4rem] font-[800] leading-tight">{data.title}</h2>
          <p className="mt-1 text-[0.9rem]">
            {data.result.crates.length} crated item{data.result.crates.length === 1 ? '' : 's'} · {data.result.crates.reduce((s, c) => s + c.quantity, 0)} crate{data.result.crates.reduce((s, c) => s + c.quantity, 0) === 1 ? '' : 's'} total
          </p>

          {data.result.crates.length === 0 && <p className="mt-6 border-2 border-black p-4">No crates on this estimate. Nothing to build.</p>}

          {data.result.crates.map((c, i) => {
            const art = data.items.get(c.item_id);
            const stencil = stencilLines(c.handling_flags);
            const flags = flagText(c.handling_flags);
            return (
              <section key={c.item_id} className="mt-6 break-inside-avoid border-2 border-black p-4 print:mt-4" aria-labelledby={`crate-${i}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id={`crate-${i}`} className="text-[1.15rem] font-[800]">
                    Crate {i + 1}: {c.description}
                  </h3>
                  <span className="text-[1rem] font-[800]">{c.quantity > 1 ? `BUILD ×${c.quantity}` : 'BUILD ×1'}</span>
                </div>
                <p className="text-[0.9rem]">
                  {PACKING_LABEL[c.method]} · {c.medium || 'Medium not given'}
                  {art && art.h != null ? ` · Artwork ${art.h} × ${art.w} × ${art.d} in` : ''}
                  {art?.weight != null ? ` · ${art.weight} lb` : ''}
                </p>

                <div className="mt-3 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
                  <div>
                    <h4 className="text-[0.75rem] font-[800] uppercase tracking-widest">Dimensions (H × W × D)</h4>
                    <dl className="mt-1 text-[0.95rem]">
                      <div className="flex justify-between gap-3 border-b border-black py-1">
                        <dt>Inner</dt>
                        <dd className="font-[700] tabular-nums">{dims(c.inner_in)}</dd>
                      </div>
                      <div className="flex justify-between gap-3 border-b border-black py-1">
                        <dt>Outer</dt>
                        <dd className="font-[700] tabular-nums">{dims(c.outer_in)}</dd>
                      </div>
                      <div className="flex justify-between gap-3 py-1">
                        <dt>Size class</dt>
                        <dd className="tabular-nums">
                          {c.size_class} · {c.shop_hours} shop hr
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div>
                    <h4 className="text-[0.75rem] font-[800] uppercase tracking-widest">Materials (per crate{c.quantity > 1 ? `, ×${c.quantity} total` : ''})</h4>
                    <table className="mt-1 w-full text-[0.95rem]">
                      <caption className="sr-only">Materials takeoff</caption>
                      <thead className="sr-only">
                        <tr>
                          <th scope="col">Material</th>
                          <th scope="col">Per crate</th>
                          <th scope="col">Total</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {(
                          [
                            ['Plywood, 4 × 8 sheets', c.plywood_sheets],
                            ['Lumber, linear feet', c.lumber_lf],
                            ['Foam, board feet', c.foam_bf],
                            ['Hardware kit', c.hardware_kits],
                          ] as const
                        ).map(([label, v]) => (
                          <tr key={label} className="border-b border-black last:border-0">
                            <th scope="row" className="py-1 text-left font-[400]">
                              {label}
                            </th>
                            <td className="py-1 text-right font-[700]">{v}</td>
                            <td className="py-1 pl-3 text-right">{c.quantity > 1 ? `${v * c.quantity} total` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
                  <div>
                    <h4 className="text-[0.75rem] font-[800] uppercase tracking-widest">Cushioning</h4>
                    <ul className="mt-1 list-disc pl-5 text-[0.95rem]">
                      {cushionSpec(c, data.snap.rates.crating.foam_thickness_in).map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-[0.75rem] font-[800] uppercase tracking-widest">Orientation and handling</h4>
                    <p className="mt-1 text-[0.95rem]">{orientation(c.handling_flags)}</p>
                    {flags.length > 0 && <p className="mt-1 text-[0.95rem]">Flags: {flags.join('; ')}.</p>}
                  </div>
                </div>

                <div className="mt-3">
                  <h4 className="text-[0.75rem] font-[800] uppercase tracking-widest">Stencil (lid and both ends)</h4>
                  {stencil.length ? (
                    <p className="mt-1 flex flex-wrap gap-2">
                      {stencil.map((s) => (
                        <span key={s} className="border-2 border-black px-3 py-1 text-[1.05rem] font-[800] tracking-[0.12em]">
                          {s}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="mt-1 text-[0.95rem]">Standard markings only (no special stencil).</p>
                  )}
                </div>
              </section>
            );
          })}

          {notCrated.length > 0 && (
            <section className="mt-6 break-inside-avoid" aria-labelledby="not-crated">
              <h3 id="not-crated" className="text-[0.75rem] font-[800] uppercase tracking-widest">
                Not crated (no build needed)
              </h3>
              <ul className="mt-1 list-disc pl-5 text-[0.95rem]">
                {notCrated.map(([itemId, name]) => (
                  <li key={itemId}>
                    {name}: {packOf(itemId) ? PACKING_LABEL[packOf(itemId)!] : 'packing not set'}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mt-6 text-[0.8rem]">Sizes come from the estimate’s saved rate card. If the items or packing change, reprice the estimate and print a new sheet.</p>
        </article>
      )}
    </div>
  );
}
