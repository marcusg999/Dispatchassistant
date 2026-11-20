/**
 * POST /api/estimate/:id/:action: every pricing write goes through here.
 * The caller's session decides who they are; the server re-prices with the shared
 * engine and refuses totals that don't match. Never trusts client-side totals.
 *
 * actions: recompute · submit · approve · reject · send · revoke · reprice · revise · duplicate · convert
 */
import type { Config, Context } from '@netlify/functions';
import { randomBytes, createHash } from 'node:crypto';
import { db } from '../lib/db';
import { isSameOrigin, json, logEvent } from '../lib/http';
import { HttpError, addDays, apply, errorResponse, loadEstimate, officeToday, price, requireStaff, resultPatch } from '../lib/estimateServer';

const EDITABLE = ['draft', 'pending_approval', 'approved'];

export default async function handler(req: Request, context?: Partial<Context>): Promise<Response> {
  if (req.method !== 'POST') return json(405, { ok: false }, { allow: 'POST' });
  if (!isSameOrigin(req)) return json(403, { ok: false });
  const parts = new URL(req.url).pathname.split('/');
  const id = context?.params?.id ?? parts[3];
  const action = context?.params?.action ?? parts[4];
  if (!/^[0-9a-f-]{36}$/.test(id ?? '')) return json(400, { ok: false, error: 'Bad estimate id.' });
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

  try {
    const staff = await requireStaff(req, action === 'approve' || action === 'reject' ? ['admin'] : ['admin', 'estimator']);
    const actor = staff.email;
    const l = await loadEstimate(db(), id);
    const est = l.est;

    if (typeof body.expected_version === 'number' && body.expected_version !== est.version)
      throw new HttpError(409, 'Someone else changed this estimate. Reload to see the latest version.', { code: 'stale' });

    const priceAndCheck = () => {
      const r = price(l);
      if (typeof body.client_total_cents === 'number' && body.client_total_cents !== r.totals.total_cents)
        throw new HttpError(409, 'The totals on screen don’t match the server’s calculation. Reload and try again.', {
          code: 'totals_mismatch',
          server_total_cents: r.totals.total_cents,
        });
      return r;
    };

    switch (action) {
      case 'recompute': {
        if (!EDITABLE.includes(est.status)) throw new HttpError(409, 'This estimate is locked. Start a new revision to change it.');
        const r = priceAndCheck();
        const patch: Record<string, unknown> = resultPatch(r);
        // A changed price voids an earlier approval.
        if (est.status === 'approved' && est.approved_total_cents !== r.totals.total_cents) Object.assign(patch, { status: 'draft', approved_at: null, approved_by: null, approved_total_cents: null });
        if (est.status === 'pending_approval' && !r.flags.needs_approval) patch.status = 'draft';
        await apply(id, actor, patch, r);
        return json(200, { ok: true, result: r });
      }
      case 'submit': {
        if (!EDITABLE.includes(est.status)) throw new HttpError(409, 'This estimate is locked.');
        const r = priceAndCheck();
        if (!r.flags.needs_approval) throw new HttpError(409, 'This estimate doesn’t need approval. You can send it.');
        await apply(id, actor, { ...resultPatch(r), status: 'pending_approval' }, r);
        return json(200, { ok: true, status: 'pending_approval' });
      }
      case 'approve': {
        if (est.status !== 'pending_approval') throw new HttpError(409, 'Only an estimate waiting for approval can be approved.');
        const r = priceAndCheck();
        await apply(id, actor, { ...resultPatch(r), status: 'approved', approved_by: actor, approved_at: new Date().toISOString(), approved_total_cents: r.totals.total_cents, approval_note: String(body.note ?? '').slice(0, 1000) || null }, r);
        return json(200, { ok: true, status: 'approved' });
      }
      case 'reject': {
        if (est.status !== 'pending_approval') throw new HttpError(409, 'Only an estimate waiting for approval can be rejected.');
        const note = String(body.note ?? '').trim();
        if (note.length < 3) throw new HttpError(400, 'Add a short note explaining what to change.');
        await apply(id, actor, { status: 'draft', approval_note: note.slice(0, 1000) });
        return json(200, { ok: true, status: 'draft' });
      }
      case 'send': {
        if (!['draft', 'approved', 'sent', 'viewed'].includes(est.status)) throw new HttpError(409, 'This estimate can’t be sent in its current status.');
        if (est.is_template) throw new HttpError(409, 'Templates can’t be sent. Duplicate it first.');
        if (!l.items.length) throw new HttpError(409, 'Add at least one item before sending.');
        const r = priceAndCheck();
        const approvedNow = est.approved_at && est.approved_total_cents === r.totals.total_cents;
        if (r.flags.needs_approval && !approvedNow) throw new HttpError(409, 'This estimate needs an admin’s approval before it can be sent.', { code: 'needs_approval', reasons: r.flags.approval_reasons });
        const { data: terms } = await db().from('terms_versions').select('id').eq('is_current', true).maybeSingle();
        if (!terms) throw new HttpError(409, 'Add quote terms (Estimates → Terms) before sending.');
        const today = await officeToday();
        const validDays = r.totals && (l.est.rate_snapshot as { rates?: { policy?: { quote_validity_days?: number } } })?.rates?.policy?.quote_validity_days;
        const validUntil = addDays(today, validDays ?? 30);
        const token = randomBytes(16).toString('base64url'); // 128-bit
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const { error } = await db().rpc('server_create_quote_link', { p_estimate: id, p_actor: actor, p_token_hash: tokenHash, p_expires: `${addDays(validUntil, 1)}T12:00:00Z` });
        if (error) throw new HttpError(500, 'Couldn’t create the quote link.');
        await apply(id, actor, { ...resultPatch(r), status: 'sent', sent_at: new Date().toISOString(), valid_until: validUntil, terms_version_id: terms.id }, r);
        logEvent('estimate', 'sent');
        return json(200, { ok: true, status: 'sent', path: `/q/${token}`, valid_until: validUntil });
      }
      case 'revoke': {
        const { error } = await db().rpc('server_revoke_quote_links', { p_estimate: id, p_actor: actor });
        if (error) throw new HttpError(500, 'Couldn’t revoke the link.');
        return json(200, { ok: true });
      }
      case 'reprice': {
        if (!EDITABLE.includes(est.status)) throw new HttpError(409, 'This estimate is locked. Start a new revision to reprice it.');
        const snapshot = await currentSnapshot();
        l.est = { ...est, rate_snapshot: snapshot.snapshot, rate_card_id: snapshot.id };
        const r = price(l);
        await apply(id, actor, { ...resultPatch(r), rate_card_id: snapshot.id, rate_snapshot: snapshot.snapshot, status: est.status === 'approved' ? 'draft' : est.status }, r);
        return json(200, { ok: true, result: r });
      }
      case 'revise':
      case 'duplicate': {
        const revise = action === 'revise';
        if (revise && est.is_template) throw new HttpError(409, 'Templates aren’t revised. Duplicate it instead.');
        const newId = await copyEstimate(l, revise, actor, body.as_template === true);
        if (revise) await db().rpc('server_revoke_quote_links', { p_estimate: id, p_actor: actor });
        return json(200, { ok: true, id: newId });
      }
      case 'convert': {
        const { data, error } = await staff.asUser.rpc('convert_estimate_to_job', { p_estimate: id });
        if (error) throw new HttpError(409, error.message);
        return json(200, { ok: true, job_id: data });
      }
      default:
        throw new HttpError(400, 'Unknown action.');
    }
  } catch (e) {
    return errorResponse(e, json);
  }
}

async function currentSnapshot() {
  const s = db();
  const { data: card } = await s.from('rate_cards').select('id, rates').eq('status', 'active').maybeSingle();
  if (!card) throw new HttpError(409, 'No active rate card.');
  const [{ data: pr }, { data: cr }] = await Promise.all([
    s.from('packing_rules').select('medium_match, condition, method, note, position').order('position'),
    s.from('crew_size_rules').select('kind, crew, param, equipment_key, note, position').order('position'),
  ]);
  return { id: card.id, snapshot: { rates: card.rates, packing_rules: pr ?? [], crew_rules: cr ?? [] } };
}

/** New revision (same number, revision + 1, fresh rates) or duplicate (new number). */
async function copyEstimate(l: Awaited<ReturnType<typeof loadEstimate>>, revise: boolean, actor: string, asTemplate: boolean): Promise<string> {
  const s = db();
  const e = l.est;
  if (revise) {
    const { data: latest } = await s.from('estimates').select('revision').eq('estimate_number', e.estimate_number).order('revision', { ascending: false }).limit(1).single();
    if (latest && latest.revision !== e.revision) throw new HttpError(409, `Revision ${latest.revision} already exists. Revise the latest one.`);
  }
  const snap = await currentSnapshot();
  const { data: row, error } = await s
    .from('estimates')
    .insert({
      ...(revise ? { estimate_number: e.estimate_number, revision: e.revision + 1 } : {}),
      title: revise ? e.title : `${e.title} (copy)`,
      client_id: e.client_id,
      contact_id: e.contact_id,
      service_type: e.service_type,
      requested_date: e.requested_date,
      inputs: e.inputs,
      notes_internal: e.notes_internal,
      notes_client: e.notes_client,
      is_template: asTemplate,
      template_name: asTemplate ? e.title : null,
      estimator_email: actor,
      rate_card_id: snap.id,
      rate_snapshot: snap.snapshot,
    })
    .select('id')
    .single();
  if (error || !row) throw new HttpError(500, 'Couldn’t copy the estimate.');
  const idMap = new Map<string, string>();
  for (const it of l.items) {
    const { id: oldId, estimate_id: _e, ...rest } = it;
    const { data: ni } = await s.from('estimate_items').insert({ ...rest, estimate_id: row.id }).select('id').single();
    if (ni) idMap.set(oldId, ni.id);
  }
  if (l.stops.length) await s.from('estimate_stops').insert(l.stops.map(({ id: _i, estimate_id: _e, ...st }) => ({ ...st, estimate_id: row.id })));
  // Overrides/manual lines are keyed by item id in some line keys; remap them.
  const inputs = JSON.parse(JSON.stringify(e.inputs ?? {}).replace(/[0-9a-f-]{36}/g, (m) => idMap.get(m) ?? m));
  await s.from('estimates').update({ inputs }).eq('id', row.id);
  const copy = await loadEstimate(s, row.id);
  const r = price(copy);
  await apply(row.id, actor, resultPatch(r), r);
  return row.id;
}

export const config: Config = {
  path: '/api/estimate/:id/:action',
  method: ['POST'],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
