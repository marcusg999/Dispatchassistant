/**
 * Client quote page API (sessionless; the 128-bit token in the URL is the only key).
 *   GET  /api/quote/:token          → client-visible quote
 *   POST /api/quote/:token/accept   → named acceptance (business record)
 *   POST /api/quote/:token/decline  → optional reason
 *
 * Expired, revoked, unknown or tampered tokens all get the SAME generic answer.
 * Every response re-prices with the shared engine and refuses to show or accept a
 * quote whose stored total doesn't match. Costs, margins, internal notes and traces
 * are never returned. Tokens and request bodies are never logged.
 */
import type { Config, Context } from '@netlify/functions';
import { createHash } from 'node:crypto';
import * as z from 'zod/mini';
import { clientView, PACKING_LABEL, type PackingMethod } from '../../src/shared/estimate';
import { db } from '../lib/db';
import { isSameOrigin, json, logEvent } from '../lib/http';
import { HttpError, apply, loadEstimate, officeToday, price } from '../lib/estimateServer';

const GONE = 'This quote link isn’t available. It may have expired or been replaced. Please contact us for a current quote.';
const OPEN = ['sent', 'viewed'];

const acceptSchema = z.object({
  name: z.string().check(z.trim(), z.minLength(2, 'Enter your full name.'), z.maxLength(120)),
  title: z.optional(z.string().check(z.trim(), z.maxLength(120))),
  email: z.string().check(z.trim(), z.regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email.'), z.maxLength(200)),
  signature: z.string().check(z.trim(), z.minLength(2, 'Type your name to sign.'), z.maxLength(120)),
  agree: z.literal(true, 'Please agree to the terms.'),
  terms_version_id: z.string().check(z.regex(/^[0-9a-f-]{36}$/)),
});

async function resolve(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, GONE);
  const hash = createHash('sha256').update(token).digest('hex');
  const { data: link } = await db().from('quote_links').select('*').eq('token_hash', hash).maybeSingle();
  if (!link || link.revoked_at || new Date(link.expires_at) <= new Date()) throw new HttpError(404, GONE);
  const l = await loadEstimate(db(), link.estimate_id).catch(() => {
    throw new HttpError(404, GONE);
  });
  // Is there a newer revision of this quote that has been sent?
  const { data: newer } = await db()
    .from('estimates')
    .select('revision, status')
    .eq('estimate_number', l.est.estimate_number)
    .gt('revision', l.est.revision)
    .in('status', ['sent', 'viewed', 'accepted', 'converted'])
    .limit(1);
  return { link, l, superseded: (newer ?? []).length > 0 };
}

export default async function handler(req: Request, context?: Partial<Context>): Promise<Response> {
  const parts = new URL(req.url).pathname.split('/');
  const token = context?.params?.token ?? parts[3] ?? '';
  const action = context?.params?.action ?? parts[4] ?? '';
  try {
    if (req.method === 'GET' && !action) return await view(token);
    if (req.method === 'POST' && (action === 'accept' || action === 'decline')) {
      if (!isSameOrigin(req)) return json(403, { ok: false });
      const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
      return action === 'accept' ? await accept(req, token, body) : await decline(token, body);
    }
    return json(405, { ok: false });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { ok: false, error: e.message, ...e.body });
    console.error('[quote] unexpected', (e as Error).message);
    return json(500, { ok: false, error: 'Something went wrong. Please try again.' });
  }
}

async function view(token: string) {
  const { link, l, superseded } = await resolve(token);
  const e = l.est;
  if (OPEN.includes(e.status) && e.valid_until && e.valid_until < (await officeToday())) {
    await apply(e.id, 'system', { status: 'expired' });
    throw new HttpError(404, GONE);
  }
  if (!['sent', 'viewed', 'accepted', 'declined', 'converted'].includes(e.status)) throw new HttpError(404, GONE);
  const r = price(l);
  if (r.totals.total_cents !== Number(e.total_cents)) throw new HttpError(409, 'This quote is being updated. Please try again shortly.');
  if (OPEN.includes(e.status) && !superseded) await db().rpc('server_record_quote_view', { p_link: link.id });

  const [{ data: terms }, { data: contact }, { data: acc }] = await Promise.all([
    e.terms_version_id ? db().from('terms_versions').select('id, version, title, body').eq('id', e.terms_version_id).maybeSingle() : Promise.resolve({ data: null }),
    e.contact_id ? db().from('client_contacts').select('name').eq('id', e.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    db().from('quote_acceptances').select('accepted_name, accepted_at').eq('estimate_id', e.id).maybeSingle(),
  ]);
  const cv = clientView(r);
  return json(200, {
    ok: true,
    quote: {
      estimate_number: e.estimate_number,
      revision: e.revision,
      title: e.title,
      client_name: l.clientName,
      contact_name: contact?.name ?? null,
      requested_date: e.requested_date,
      valid_until: e.valid_until,
      status: e.status === 'converted' ? 'accepted' : e.status === 'viewed' ? 'sent' : e.status,
      superseded,
      notes_client: e.notes_client,
      stops: l.stops.map((s) => ({ kind: s.kind, site_name: s.site_name, address: s.address })),
      items: l.items.map((i) => ({
        description: i.description,
        artist_title: i.artist_title,
        medium: i.medium,
        height_in: i.height_in == null ? null : Number(i.height_in),
        width_in: i.width_in == null ? null : Number(i.width_in),
        depth_in: i.depth_in == null ? null : Number(i.depth_in),
        quantity: i.quantity,
        packing: PACKING_LABEL[(i.packing_method ?? r.packing.find((p) => p.item_id === i.id)?.chosen ?? 'standard_crate') as PackingMethod],
      })),
      lines: cv.lines,
      totals: cv.totals,
      terms: terms ?? null,
      accepted: acc ? { name: acc.accepted_name, at: acc.accepted_at } : null,
    },
  }, { 'cache-control': 'no-store' });
}

async function accept(req: Request, token: string, body: Record<string, unknown>) {
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the form.' });
  const f = parsed.data;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm(f.signature) !== norm(f.name)) return json(400, { ok: false, error: 'Type your full name exactly as entered above to sign.' });

  const { link, l, superseded } = await resolve(token);
  const e = l.est;
  if (superseded) throw new HttpError(409, 'A newer version of this quote was sent. Please use the most recent link we sent you.', { code: 'superseded' });
  if (e.status === 'accepted' || e.status === 'converted') throw new HttpError(409, 'This quote has already been accepted.', { code: 'already_accepted' });
  if (!OPEN.includes(e.status)) throw new HttpError(404, GONE);
  if (e.valid_until && e.valid_until < (await officeToday())) throw new HttpError(404, GONE);
  if (f.terms_version_id !== e.terms_version_id) throw new HttpError(409, 'The terms changed. Please reload the page and review them.', { code: 'terms_changed' });
  const r = price(l);
  if (r.totals.total_cents !== Number(e.total_cents)) throw new HttpError(409, 'This quote is being updated. Please try again shortly.');

  const ip = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const { error } = await db().rpc('server_accept_quote', {
    p_link: link.id,
    p_name: f.name,
    p_title: f.title ?? '',
    p_email: f.email,
    p_signature: f.signature,
    p_terms: e.terms_version_id!,
    p_total: r.totals.total_cents,
    p_ip: ip as string,
    p_ua: (req.headers.get('user-agent') ?? '').slice(0, 500),
  });
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'This quote has already been accepted.', { code: 'already_accepted' });
    throw new HttpError(409, 'This quote can’t be accepted right now. Please contact us.');
  }
  logEvent('quote', 'accepted');
  return json(200, { ok: true });
}

async function decline(token: string, body: Record<string, unknown>) {
  const { link, l } = await resolve(token);
  if (!OPEN.includes(l.est.status)) throw new HttpError(409, 'This quote is no longer open.');
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 1000) : '';
  const { error } = await db().rpc('server_decline_quote', { p_link: link.id, p_reason: reason });
  if (error) throw new HttpError(409, 'This quote is no longer open.');
  logEvent('quote', 'declined');
  return json(200, { ok: true });
}

export const config: Config = {
  path: ['/api/quote/:token', '/api/quote/:token/:action'],
  method: ['GET', 'POST'],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
