/**
 * Server-side estimate helpers shared by the estimate and quote functions.
 * Loads with the service client (after the caller's permission is checked),
 * rebuilds the engine input, and re-prices with the SAME engine the browser uses.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/shared/database.types';
import {
  computeEstimate,
  crewRuleSchema,
  packingRuleSchema,
  ratesSchema,
  type EstimateInput,
  type EstimateResult,
  type RateSnapshot,
} from '../../src/shared/estimate';
import { db, type Db } from './db';

export type EstimateRow = Database['public']['Tables']['estimates']['Row'];

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Verify the caller's Supabase session and staff role. Returns their email and role. */
export async function requireStaff(req: Request, roles: string[]) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new HttpError(401, 'Please sign in again.');
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user?.email) throw new HttpError(401, 'Please sign in again.');
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new HttpError(500, 'Server misconfigured.');
  const asUser = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: role } = await asUser.rpc('my_staff_role');
  if (!role || !roles.includes(role)) throw new HttpError(403, 'Your role can’t do that.');
  return { email: data.user.email.toLowerCase(), role, asUser };
}

export function parseSnapshot(raw: unknown): RateSnapshot {
  const s = raw as { rates?: unknown; packing_rules?: unknown[]; crew_rules?: unknown[] } | null;
  const rates = ratesSchema.safeParse(s?.rates);
  if (!rates.success) throw new HttpError(409, 'This estimate’s rate card is invalid. Reprice it with the current rate card.');
  const packing = (s?.packing_rules ?? []).map((r) => packingRuleSchema.parse(r));
  const crew = (s?.crew_rules ?? []).map((r) => crewRuleSchema.parse({ ...(r as object), equipment_key: (r as { equipment_key?: string | null }).equipment_key ?? undefined }));
  return { rates: rates.data, packing_rules: packing, crew_rules: crew };
}

export interface Loaded {
  est: EstimateRow;
  items: Database['public']['Tables']['estimate_items']['Row'][];
  stops: Database['public']['Tables']['estimate_stops']['Row'][];
  clientName: string | null;
  clientDiscountBp: number;
}

export async function loadEstimate(client: Db, id: string): Promise<Loaded> {
  const { data: est } = await client.from('estimates').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!est) throw new HttpError(404, 'Estimate not found.');
  const [items, stops, cl] = await Promise.all([
    client.from('estimate_items').select('*').eq('estimate_id', id).order('position'),
    client.from('estimate_stops').select('*').eq('estimate_id', id).order('position'),
    est.client_id ? client.from('clients').select('name, default_discount_bp').eq('id', est.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    est,
    items: items.data ?? [],
    stops: stops.data ?? [],
    clientName: cl.data?.name ?? null,
    clientDiscountBp: cl.data?.default_discount_bp ?? 0,
  };
}

export function engineInput(l: Loaded): EstimateInput {
  const inputs = (l.est.inputs ?? {}) as Partial<EstimateInput> & { options?: EstimateInput['options'] };
  return {
    options: { ...(inputs.options ?? {}), service_type: l.est.service_type },
    overrides: inputs.overrides ?? {},
    manual_lines: inputs.manual_lines ?? [],
    client_default_discount_bp: l.clientDiscountBp,
    stops: l.stops.map((s) => ({ miles_from_previous: s.miles_from_previous == null ? null : Number(s.miles_from_previous) })),
    items: l.items.map((i) => ({
      id: i.id,
      description: i.description,
      medium: i.medium,
      height_in: i.height_in == null ? null : Number(i.height_in),
      width_in: i.width_in == null ? null : Number(i.width_in),
      depth_in: i.depth_in == null ? null : Number(i.depth_in),
      weight_lbs: i.weight_lbs == null ? null : Number(i.weight_lbs),
      quantity: i.quantity,
      declared_value_cents: i.declared_value_cents == null ? null : Number(i.declared_value_cents),
      handling_flags: i.handling_flags,
      packing_method: (i.packing_method as EstimateInput['items'][number]['packing_method']) ?? null,
    })),
  };
}

export function price(l: Loaded): EstimateResult {
  if (!l.est.rate_snapshot) throw new HttpError(409, 'No active rate card. An admin needs to activate one.');
  return computeEstimate(engineInput(l), parseSnapshot(l.est.rate_snapshot));
}

/** Patch for server_apply_estimate from an engine result. */
export function resultPatch(r: EstimateResult) {
  return {
    subtotal_cents: r.totals.subtotal_cents,
    discount_bp: r.totals.discount_bp,
    discount_cents: r.totals.discount_cents,
    tax_cents: r.totals.tax_cents,
    total_cents: r.totals.total_cents,
    cost_cents: r.totals.cost_cents,
    margin_cents: r.totals.margin_cents,
    margin_bp: r.totals.margin_bp,
    suggested_crew: r.crew.applied,
    needs_approval: r.flags.needs_approval,
    approval_reasons: r.flags.approval_reasons,
  };
}

export async function apply(estimateId: string, actor: string, patch: Record<string, unknown>, r?: EstimateResult) {
  const { error } = await db().rpc('server_apply_estimate', {
    p_estimate: estimateId,
    p_actor: actor,
    p_patch: patch as never,
    p_lines: (r ? r.lines : null) as never,
    p_packing: (r ? r.packing : null) as never,
  });
  if (error) throw new HttpError(500, 'Couldn’t save the estimate.', { code: error.code });
}

/** Today in the office time zone (yyyy-mm-dd). */
export async function officeToday(): Promise<string> {
  const { data } = await db().from('app_settings').select('value').eq('key', 'timezone').maybeSingle();
  const tz = data?.value ?? 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function errorResponse(e: unknown, json: (s: number, b: unknown) => Response) {
  if (e instanceof HttpError) return json(e.status, { ok: false, error: e.message, ...e.body });
  console.error('[estimate] unexpected', (e as Error).message);
  return json(500, { ok: false, error: 'Something went wrong.' });
}
