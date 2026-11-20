/**
 * Estimates data layer. Everything runs as the signed-in user under RLS. Users edit
 * estimate INPUTS (title, client, inputs jsonb, stops, items); totals, lines and status
 * are written by the server (/api/estimate/:id/:action) and only read here.
 */
import { ratesSchema, crewRuleSchema, packingRuleSchema, type Rates, type RateSnapshot } from '../../shared/estimate';
import type { Database } from '../../shared/database.types';
import { supabase } from '../supabase';

type T = Database['public']['Tables'];
export type EstimateRow = T['estimates']['Row'];
export type EstimateStopRow = T['estimate_stops']['Row'];
export type EstimateItemRow = T['estimate_items']['Row'];
export type EstimateLineRow = T['estimate_lines']['Row'];
export type ClientRow = T['clients']['Row'];
export type ContactRow = T['client_contacts']['Row'];

export const ESTIMATE_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];
export const STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Needs approval',
  approved: 'Approved',
  sent: 'Sent',
  viewed: 'Viewed',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  converted: 'Converted',
};
/** Statuses where inputs can still change (matches the server's EDITABLE list). */
export const EDITABLE_STATUSES: string[] = ['draft', 'pending_approval', 'approved'];
export const isEditable = (status: string) => EDITABLE_STATUSES.includes(status);

export const CLIENT_KINDS = ['museum', 'gallery', 'collector', 'designer', 'corporate', 'other'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
export const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  museum: 'Museum',
  gallery: 'Gallery',
  collector: 'Collector',
  designer: 'Designer',
  corporate: 'Corporate',
  other: 'Other',
};

export class EstimateError extends Error {
  constructor(
    message: string,
    public code?: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export class StaleEstimateError extends EstimateError {
  constructor() {
    super('Someone else changed this estimate. Reload to see the latest version.', 'stale');
  }
}

function check<D>(r: { data: D | null; error: { message: string; code?: string } | null }): D {
  if (r.error) throw new EstimateError(r.error.message, r.error.code);
  return r.data as D;
}

// ── Estimates ────────────────────────────────────────────────────────────────
const LIST_COLS =
  'id, estimate_number, revision, title, status, total_cents, margin_bp, needs_approval, approval_reasons, valid_until, is_template, template_name, created_at, requested_date, estimator_email, client_id, converted_job_id, version';

export interface EstimateListRow {
  id: string;
  estimate_number: string;
  revision: number;
  title: string;
  status: EstimateStatus;
  total_cents: number;
  margin_bp: number;
  needs_approval: boolean;
  approval_reasons: string[];
  valid_until: string | null;
  is_template: boolean;
  template_name: string | null;
  created_at: string;
  requested_date: string | null;
  estimator_email: string | null;
  client_id: string | null;
  converted_job_id: string | null;
  version: number;
  client: { name: string } | null;
  /** Target margin (bp) from the rate card the estimate was priced with. */
  target_bp: string | number | null;
}

export interface EstimateFilters {
  status?: EstimateStatus[];
  client_id?: string;
  estimator_email?: string;
  from?: string;
  to?: string;
}

const TARGET = 'target_bp:rate_snapshot->rates->policy->>target_margin_bp';

export async function listEstimates(f: EstimateFilters = {}): Promise<EstimateListRow[]> {
  let q = supabase
    .from('estimates')
    .select(`${LIST_COLS}, client:clients(name), ${TARGET}`)
    .is('deleted_at', null)
    .eq('is_template', false)
    .order('created_at', { ascending: false })
    .order('revision', { ascending: false })
    .limit(500);
  if (f.status?.length) q = q.in('status', f.status);
  if (f.client_id) q = q.eq('client_id', f.client_id);
  if (f.estimator_email) q = q.eq('estimator_email', f.estimator_email);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00`);
  if (f.to) q = q.lte('created_at', `${f.to}T23:59:59`);
  return check(await q) as unknown as EstimateListRow[];
}

export async function listTemplates(): Promise<EstimateListRow[]> {
  const r = await supabase
    .from('estimates')
    .select(`${LIST_COLS}, client:clients(name), ${TARGET}`)
    .is('deleted_at', null)
    .eq('is_template', true)
    .order('template_name');
  return check(r) as unknown as EstimateListRow[];
}

export async function listEstimators(): Promise<string[]> {
  const r = await supabase.from('estimates').select('estimator_email').is('deleted_at', null).limit(1000);
  const rows = check(r) as { estimator_email: string | null }[];
  return [...new Set(rows.map((x) => x.estimator_email).filter((x): x is string => !!x))].sort();
}

export type EstimateFull = EstimateRow & {
  stops: EstimateStopRow[];
  items: EstimateItemRow[];
  lines: EstimateLineRow[];
};

export async function getEstimate(id: string): Promise<EstimateFull | null> {
  const r = await supabase
    .from('estimates')
    .select('*, stops:estimate_stops(*), items:estimate_items(*), lines:estimate_lines(*)')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  const row = check(r) as EstimateFull | null;
  if (!row) return null;
  row.stops.sort((a, b) => a.position - b.position);
  row.items.sort((a, b) => a.position - b.position);
  row.lines.sort((a, b) => a.sort - b.sort);
  return row;
}

/** Just the estimate row (cheap refresh after a recompute). */
export async function getEstimateRow(id: string): Promise<EstimateRow | null> {
  return check(await supabase.from('estimates').select('*').eq('id', id).is('deleted_at', null).maybeSingle()) as EstimateRow | null;
}

export interface EstimateInputsPatch {
  title: string;
  client_id: string | null;
  contact_id: string | null;
  service_type: Database['public']['Enums']['job_type'];
  requested_date: string | null;
  inputs: Record<string, unknown>;
  notes_internal: string | null;
  notes_client: string | null;
}

/** Saves inputs under the optimistic lock. Zero rows updated means someone else changed it. */
export async function saveEstimateInputs(id: string, version: number, patch: EstimateInputsPatch): Promise<EstimateRow> {
  const r = await supabase
    .from('estimates')
    .update({ ...patch, inputs: patch.inputs as never })
    .eq('id', id)
    .eq('version', version)
    .select('*');
  const rows = check(r) as EstimateRow[];
  if (!rows.length) throw new StaleEstimateError();
  return rows[0];
}

export type StopInput = Omit<EstimateStopRow, 'id' | 'estimate_id' | 'position'>;
export type ItemInput = Omit<EstimateItemRow, 'estimate_id' | 'position' | 'packing_suggested'>;

export async function saveEstimateStops(estimateId: string, stops: StopInput[]) {
  check(await supabase.from('estimate_stops').delete().eq('estimate_id', estimateId));
  if (stops.length) check(await supabase.from('estimate_stops').insert(stops.map((s, i) => ({ ...s, estimate_id: estimateId, position: i }))));
}

/** Items keep their ids (line keys and overrides refer to them): upsert, then drop the removed ones. */
export async function saveEstimateItems(estimateId: string, items: ItemInput[]) {
  const keep = items.map((i) => i.id);
  const del = supabase.from('estimate_items').delete().eq('estimate_id', estimateId);
  check(await (keep.length ? del.not('id', 'in', `(${keep.join(',')})`) : del));
  if (items.length) check(await supabase.from('estimate_items').upsert(items.map((it, i) => ({ ...it, estimate_id: estimateId, position: i })), { onConflict: 'id' }));
}

export async function createEstimate(input: {
  title: string;
  client_id: string | null;
  service_type: Database['public']['Enums']['job_type'];
  requested_date?: string | null;
}): Promise<string> {
  const r = await supabase
    .from('estimates')
    .insert({
      title: input.title,
      client_id: input.client_id,
      service_type: input.service_type,
      requested_date: input.requested_date ?? null,
      inputs: { options: { service_type: input.service_type }, overrides: {}, manual_lines: [] } as never,
    })
    .select('id')
    .single();
  return (check(r) as { id: string }).id;
}

// ── Server actions ───────────────────────────────────────────────────────────
export type EstimateAction = 'recompute' | 'submit' | 'approve' | 'reject' | 'send' | 'revoke' | 'reprice' | 'revise' | 'duplicate' | 'convert';

export interface ActionResponse {
  ok: boolean;
  id?: string;
  job_id?: string;
  path?: string;
  valid_until?: string;
  status?: string;
  result?: unknown;
}

export async function callAction(id: string, action: EstimateAction, body: Record<string, unknown> = {}): Promise<ActionResponse> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new EstimateError('Please sign in again.', 'auth');
  let res: Response;
  try {
    res = await fetch(`/api/estimate/${id}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new EstimateError('Couldn’t reach the server. Check your connection and try again.', 'network');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new EstimateError(String(json.error ?? 'Something went wrong.'), typeof json.code === 'string' ? json.code : undefined, json);
  }
  return json as unknown as ActionResponse;
}

// ── Rates ────────────────────────────────────────────────────────────────────
export function parseSnapshot(raw: unknown): RateSnapshot | null {
  const s = raw as { rates?: unknown; packing_rules?: unknown[]; crew_rules?: unknown[] } | null;
  const rates = ratesSchema.safeParse(s?.rates);
  if (!rates.success) return null;
  try {
    const packing = (s?.packing_rules ?? []).map((r) => packingRuleSchema.parse(r));
    const crew = (s?.crew_rules ?? []).map((r) => crewRuleSchema.parse({ ...(r as object), equipment_key: (r as { equipment_key?: string | null }).equipment_key ?? undefined }));
    return { rates: rates.data, packing_rules: packing, crew_rules: crew };
  } catch {
    return null;
  }
}

/** Rates on the card that is active right now (what a new estimate will snapshot). */
export async function activeRates(): Promise<Rates | null> {
  const r = await supabase.from('rate_cards').select('rates').eq('status', 'active').maybeSingle();
  const row = check(r) as { rates: unknown } | null;
  if (!row) return null;
  const p = ratesSchema.safeParse(row.rates);
  return p.success ? p.data : null;
}

// ── Approvals ────────────────────────────────────────────────────────────────
export interface ApprovalRow extends EstimateListRow {
  below_target: boolean;
}

/** Pending approvals, plus open estimates whose margin sits under their rate card's target. */
export async function approvalQueue(): Promise<ApprovalRow[]> {
  const r = await supabase
    .from('estimates')
    .select(`${LIST_COLS}, client:clients(name), ${TARGET}`)
    .is('deleted_at', null)
    .eq('is_template', false)
    .in('status', ['draft', 'pending_approval', 'approved'])
    .order('created_at', { ascending: false });
  const rows = check(r) as unknown as EstimateListRow[];
  return rows
    .map((e) => ({ ...e, below_target: isBelowTarget(e) }))
    .filter((e) => e.status === 'pending_approval' || e.below_target)
    .sort((a, b) => Number(b.status === 'pending_approval') - Number(a.status === 'pending_approval'));
}

export function isBelowTarget(e: { margin_bp: number; target_bp: string | number | null; total_cents: number }): boolean {
  const t = e.target_bp == null ? null : Number(e.target_bp);
  return t != null && Number.isFinite(t) && e.total_cents > 0 && e.margin_bp < t;
}

// ── Clients ──────────────────────────────────────────────────────────────────
export async function listClients(): Promise<ClientRow[]> {
  return check(await supabase.from('clients').select('*').order('name')) as ClientRow[];
}
export async function getClient(id: string): Promise<ClientRow | null> {
  return check(await supabase.from('clients').select('*').eq('id', id).maybeSingle()) as ClientRow | null;
}
export type ClientInput = Pick<ClientRow, 'name' | 'kind' | 'billing_address' | 'default_discount_bp' | 'notes' | 'active'>;
export async function saveClient(id: string | null, input: ClientInput): Promise<ClientRow> {
  const r = id
    ? await supabase.from('clients').update(input).eq('id', id).select('*').single()
    : await supabase.from('clients').insert(input).select('*').single();
  return check(r) as ClientRow;
}

export async function listContacts(clientId: string): Promise<ContactRow[]> {
  return check(await supabase.from('client_contacts').select('*').eq('client_id', clientId).order('created_at')) as ContactRow[];
}
export type ContactInput = Pick<ContactRow, 'name' | 'role' | 'email' | 'phone'>;
export async function saveContact(clientId: string, id: string | null, input: ContactInput): Promise<ContactRow> {
  const r = id
    ? await supabase.from('client_contacts').update(input).eq('id', id).select('*').single()
    : await supabase.from('client_contacts').insert({ ...input, client_id: clientId }).select('*').single();
  return check(r) as ContactRow;
}
export async function deleteContact(id: string) {
  check(await supabase.from('client_contacts').delete().eq('id', id));
}
/** Only one primary per client: clear the others first (the unique index enforces it). */
export async function setPrimaryContact(clientId: string, id: string) {
  check(await supabase.from('client_contacts').update({ is_primary: false }).eq('client_id', clientId).neq('id', id));
  check(await supabase.from('client_contacts').update({ is_primary: true }).eq('id', id));
}

export interface ClientHistory {
  estimates: Pick<EstimateRow, 'id' | 'estimate_number' | 'revision' | 'title' | 'status' | 'total_cents'>[];
  jobs: { id: string; job_number: string; title: string; status: string }[];
  jobsError: boolean;
}
export async function clientHistory(clientId: string): Promise<ClientHistory> {
  const [e, j] = await Promise.all([
    supabase
      .from('estimates')
      .select('id, estimate_number, revision, title, status, total_cents')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .eq('is_template', false)
      .order('created_at', { ascending: false }),
    supabase.from('jobs').select('id, job_number, title, status').eq('client_id', clientId).is('deleted_at', null).order('created_at', { ascending: false }),
  ]);
  return {
    estimates: check(e) as ClientHistory['estimates'],
    jobs: j.error ? [] : ((j.data ?? []) as ClientHistory['jobs']),
    jobsError: !!j.error,
  };
}
