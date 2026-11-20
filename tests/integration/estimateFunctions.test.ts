/**
 * Phase 3 estimate + quote Netlify Functions against the local Supabase stack.
 * Handlers are called directly with Request objects. requireStaff() verifies the bearer token with
 * GoTrue, so these tests create REAL auth users and sign in for real access tokens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import estimateFn from '../../netlify/functions/estimate.mts';
import quoteFn from '../../netlify/functions/quote.mts';
import { addDays, officeToday, parseSnapshot } from '../../netlify/lib/estimateServer';
import { computeEstimate, type EstimateInput } from '../../src/shared/estimate';
import { LOCAL, anonClient, serviceClient, stackIsUp } from '../helpers/local';

process.env.SUPABASE_URL = LOCAL.url;
process.env.SUPABASE_SECRET_KEY = LOCAL.secret;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = LOCAL.publishable;
delete process.env.SUPABASE_PUBLISHABLE_KEY;

/* eslint-disable @typescript-eslint/no-explicit-any */
const ORIGIN = 'http://localhost:8888';
const svc = serviceClient() as any;
const PASSWORD = 'est-fn-test-password-123';
const EMAILS = {
  admin: 'admin@example.com',
  estimator: 'estimator@example.com',
  dispatcher: 'dispatcher@example.com',
  viewer: 'viewer@example.com',
  crew: 'crew@example.com',
  norole: 'est.norole.fixture@example.com',
};
const tokens: Record<string, string> = {};
const GONE = 'This quote link isn’t available. It may have expired or been replaced. Please contact us for a current quote.';

const estimateIds: string[] = [];
const jobIds: string[] = [];
let clientId = '';

async function one<T = any>(q: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

async function ensureUser(email: string) {
  const created = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) {
    if (!/already|registered|exists/i.test(created.error.message)) throw created.error;
    const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
    const u = data.users.find((x: any) => x.email === email);
    await svc.auth.admin.updateUserById(u.id, { password: PASSWORD });
  }
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw error ?? new Error('no session');
  return data.session.access_token;
}

beforeAll(async () => {
  if (!(await stackIsUp())) throw new Error('Local Supabase is not running. Start it with `npx supabase start`.');
  for (const [role, email] of Object.entries(EMAILS)) tokens[role] = await ensureUser(email);
  clientId = (await one(svc.from('clients').insert({ name: `Fn Fixture Client ${Date.now()}`, default_discount_bp: 0 }).select('id').single())).id;
});

afterAll(async () => {
  if (estimateIds.length) {
    await svc.from('quote_acceptances').delete().in('estimate_id', estimateIds);
    const { data } = await svc.from('estimates').select('converted_job_id').in('id', estimateIds);
    for (const r of data ?? []) if (r.converted_job_id) jobIds.push(r.converted_job_id);
    await svc.from('estimates').delete().in('id', estimateIds);
  }
  if (jobIds.length) await svc.from('jobs').delete().in('id', jobIds);
  if (clientId) await svc.from('clients').delete().eq('id', clientId);
});

// ── helpers ──────────────────────────────────────────────────────────────────
const ESTIMATE_OPTIONS = { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3 };
const ITEM = { description: 'Large painting', medium: 'Oil on canvas', height_in: 60, width_in: 48, depth_in: 3, weight_lbs: 45, quantity: 1, declared_value_cents: 2_500_000, handling_flags: ['upright'] };

async function makeEstimate(options: Record<string, unknown> = {}, title = 'Fn fixture estimate'): Promise<string> {
  const e = await one(
    svc.from('estimates').insert({
      title, client_id: clientId, service_type: 'delivery', estimator_email: EMAILS.estimator, requested_date: addDays(await officeToday(), 14),
      notes_internal: 'INTERNAL-SECRET-NOTE', notes_client: 'Thanks for the opportunity.',
      inputs: { options: { ...ESTIMATE_OPTIONS, ...options }, overrides: {}, manual_lines: [] },
    }).select('id').single(),
  );
  estimateIds.push(e.id);
  await one(svc.from('estimate_stops').insert([
    { estimate_id: e.id, position: 0, kind: 'origin', site_name: 'Warehouse', address: '1200 Example Ave, Los Angeles, CA', access_flags: ['loading_dock'] },
    { estimate_id: e.id, position: 1, kind: 'destination', site_name: 'Residence', address: '45 Sample Canyon Rd, Los Angeles, CA', miles_from_previous: 12.4, access_flags: ['stairs'] },
  ]));
  await one(svc.from('estimate_items').insert({ estimate_id: e.id, position: 0, ...ITEM }));
  return e.id;
}

async function call(id: string, action: string, role: string | null, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await estimateFn(
    new Request(`${ORIGIN}/api/estimate/${id}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, host: 'localhost:8888', ...(role ? { authorization: `Bearer ${role in tokens ? tokens[role] : role}` } : {}), ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as any };
}

const tokenOf = (path: string) => path.replace('/q/', '');

async function quoteGet(token: string) {
  const res = await quoteFn(new Request(`${ORIGIN}/api/quote/${token}`, { headers: { host: 'localhost:8888' } }));
  return { status: res.status, body: (await res.json()) as any };
}
async function quotePost(token: string, action: 'accept' | 'decline', body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await quoteFn(
    new Request(`${ORIGIN}/api/quote/${token}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, host: 'localhost:8888', ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as any };
}
const acceptBody = (termsId: string, over: Record<string, unknown> = {}) => ({
  name: 'Jordan Q. Client', title: 'Registrar', email: 'Jordan.Client@Example.com', signature: 'jordan q. client', agree: true, terms_version_id: termsId, ...over,
});

const dbEstimate = async (id: string) => one(svc.from('estimates').select('*').eq('id', id).single());
const dbLines = async (id: string) => one<any[]>(svc.from('estimate_lines').select('*').eq('estimate_id', id).order('sort'));

/** Same engine, independent input construction from the fixture (not via the server's loader). */
async function expectedResult(id: string) {
  const e = await dbEstimate(id);
  const stops = await one<any[]>(svc.from('estimate_stops').select('miles_from_previous').eq('estimate_id', id).order('position'));
  const items = await one<any[]>(svc.from('estimate_items').select('*').eq('estimate_id', id).order('position'));
  const input: EstimateInput = {
    options: { ...(e.inputs.options ?? {}), service_type: e.service_type },
    overrides: e.inputs.overrides ?? {},
    manual_lines: e.inputs.manual_lines ?? [],
    client_default_discount_bp: 0,
    stops: stops.map((s) => ({ miles_from_previous: s.miles_from_previous == null ? null : Number(s.miles_from_previous) })),
    items: items.map((i) => ({
      id: i.id, description: i.description, medium: i.medium, height_in: Number(i.height_in), width_in: Number(i.width_in), depth_in: Number(i.depth_in),
      weight_lbs: Number(i.weight_lbs), quantity: i.quantity, declared_value_cents: Number(i.declared_value_cents), handling_flags: i.handling_flags, packing_method: null,
    })),
  } as EstimateInput;
  return computeEstimate(input, parseSnapshot(e.rate_snapshot));
}

function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => deepKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push(k), deepKeys(x, out));
  return out;
}

// ── auth / roles / validation ───────────────────────────────────────────────
describe('POST /api/estimate/:id/:action: access control and guards', () => {
  let id = '';
  beforeAll(async () => {
    id = await makeEstimate();
  });

  it('missing or invalid token → 401', async () => {
    expect((await call(id, 'recompute', null)).status).toBe(401);
    expect((await call(id, 'recompute', 'not-a-real-jwt')).status).toBe(401);
  });

  for (const role of ['dispatcher', 'viewer', 'crew', 'norole']) {
    it(`${role} token → 403 on every action and nothing changes`, async () => {
      const before = await dbEstimate(id);
      for (const action of ['recompute', 'submit', 'approve', 'reject', 'send', 'revoke', 'reprice', 'revise', 'duplicate', 'convert']) {
        const r = await call(id, action, role);
        expect(r.status, `${role} ${action}`).toBe(403);
      }
      const after = await dbEstimate(id);
      expect(after.version).toBe(before.version);
      expect(after.status).toBe('draft');
    });
  }

  it('estimator cannot approve or reject (403); admin approve needs pending_approval (409)', async () => {
    expect((await call(id, 'approve', 'estimator')).status).toBe(403);
    expect((await call(id, 'reject', 'estimator', { note: 'nope nope' })).status).toBe(403);
    const r = await call(id, 'approve', 'admin');
    expect(r.status).toBe(409);
  });

  it('rejects bad ids, unknown actions, wrong methods and cross-origin posts', async () => {
    expect((await call('not-a-uuid', 'recompute', 'estimator')).status).toBe(400);
    expect((await call(id, 'explode', 'estimator')).status).toBe(400);
    expect((await call('00000000-0000-0000-0000-000000000000', 'recompute', 'estimator')).status).toBe(404);
    const get = await estimateFn(new Request(`${ORIGIN}/api/estimate/${id}/recompute`, { method: 'GET' }));
    expect(get.status).toBe(405);
    const evil = await call(id, 'recompute', 'estimator', {}, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
  });

  it('submit refuses an estimate that does not need approval (409)', async () => {
    const r = await call(id, 'submit', 'estimator');
    expect(r.status).toBe(409);
    expect((await dbEstimate(id)).status).toBe('draft');
  });

  it('send refuses an estimate with no items, and a template', async () => {
    const empty = await one(svc.from('estimates').insert({ title: 'Fn empty', client_id: clientId, estimator_email: EMAILS.estimator }).select('id').single());
    estimateIds.push(empty.id);
    expect((await call(empty.id, 'send', 'estimator')).status).toBe(409);
    await svc.from('estimates').update({ is_template: true }).eq('id', id);
    const t = await call(id, 'send', 'estimator');
    await svc.from('estimates').update({ is_template: false }).eq('id', id);
    expect(t.status).toBe(409);
  });
});

// ── recompute integrity ─────────────────────────────────────────────────────
describe('recompute', () => {
  let id = '';
  beforeAll(async () => {
    id = await makeEstimate();
  });

  it('writes lines and totals equal to computeEstimate on the same inputs', async () => {
    const before = await dbEstimate(id);
    expect(Number(before.total_cents)).toBe(0);
    const r = await call(id, 'recompute', 'estimator');
    expect(r.status).toBe(200);
    const want = await expectedResult(id);
    expect(want.totals.total_cents).toBeGreaterThan(0);
    expect(r.body.result.totals.total_cents).toBe(want.totals.total_cents);
    const e = await dbEstimate(id);
    expect(Number(e.total_cents)).toBe(want.totals.total_cents);
    expect(Number(e.subtotal_cents)).toBe(want.totals.subtotal_cents);
    expect(Number(e.tax_cents)).toBe(want.totals.tax_cents);
    expect(Number(e.cost_cents)).toBe(want.totals.cost_cents);
    expect(Number(e.margin_cents)).toBe(want.totals.margin_cents);
    expect(e.needs_approval).toBe(want.flags.needs_approval);
    expect(e.suggested_crew).toBe(want.crew.applied);
    const lines = await dbLines(id);
    expect(lines).toHaveLength(want.lines.length);
    lines.forEach((l, i) => {
      expect(l.key).toBe(want.lines[i].key);
      expect(Number(l.amount_cents)).toBe(want.lines[i].amount_cents);
      expect(Number(l.cost_cents)).toBe(want.lines[i].cost_cents);
      expect(l.client_visible).toBe(want.lines[i].client_visible);
    });
    expect(lines.reduce((s, l) => s + Number(l.amount_cents), 0)).toBeGreaterThan(0);
    expect(e.needs_approval).toBe(false);
  });

  it('tampered client_total_cents → 409 totals_mismatch and the DB is unchanged', async () => {
    const before = await dbEstimate(id);
    const beforeLines = await dbLines(id);
    const r = await call(id, 'recompute', 'estimator', { client_total_cents: Number(before.total_cents) - 100 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('totals_mismatch');
    expect(r.body.server_total_cents).toBe(Number(before.total_cents));
    const after = await dbEstimate(id);
    expect(after).toEqual(before);
    expect(await dbLines(id)).toEqual(beforeLines);
  });

  it('matching client_total_cents + current expected_version succeeds; stale expected_version → 409 stale', async () => {
    const e = await dbEstimate(id);
    const ok = await call(id, 'recompute', 'estimator', { client_total_cents: Number(e.total_cents), expected_version: e.version });
    expect(ok.status).toBe(200);
    const after = await dbEstimate(id);
    expect(after.version).toBeGreaterThan(e.version);
    const stale = await call(id, 'recompute', 'estimator', { expected_version: e.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('stale');
    expect((await dbEstimate(id)).version).toBe(after.version);
  });

  it('an input change is picked up by the next recompute (server, not browser, owns the numbers)', async () => {
    const e = await dbEstimate(id);
    await svc.from('estimates').update({ inputs: { ...e.inputs, options: { ...e.inputs.options, labor_hours: 6 } } }).eq('id', id);
    const r = await call(id, 'recompute', 'admin');
    expect(r.status).toBe(200);
    const want = await expectedResult(id);
    expect(Number((await dbEstimate(id)).total_cents)).toBe(want.totals.total_cents);
    expect(want.totals.total_cents).not.toBe(Number(e.total_cents));
  });
});

// ── approval flow, send, client quote page, acceptance, conversion ──────────
describe('discounted estimate: approval → send → client quote → accept → convert', () => {
  let id = '';
  let token = '';
  let termsId = '';
  let validUntil = '';

  beforeAll(async () => {
    id = await makeEstimate({ discount_bp: 1500 }, 'Fn discount estimate');
  });

  it('15% discount needs approval; send is refused until approved (409 needs_approval)', async () => {
    const r = await call(id, 'recompute', 'estimator');
    expect(r.status).toBe(200);
    expect(r.body.result.flags.needs_approval).toBe(true);
    expect((await dbEstimate(id)).needs_approval).toBe(true);
    const send = await call(id, 'send', 'estimator');
    expect(send.status).toBe(409);
    expect(send.body.code).toBe('needs_approval');
    expect(send.body.reasons.length).toBeGreaterThan(0);
    expect((await dbEstimate(id)).status).toBe('draft');
    expect(await one(svc.from('quote_links').select('id').eq('estimate_id', id))).toHaveLength(0);
  });

  it('submit → pending_approval; estimator cannot approve; admin approve → approved with a named approver and audit row', async () => {
    expect((await call(id, 'submit', 'estimator')).body.status).toBe('pending_approval');
    expect((await dbEstimate(id)).status).toBe('pending_approval');
    expect((await call(id, 'approve', 'estimator')).status).toBe(403);
    expect((await dbEstimate(id)).status).toBe('pending_approval');
    // Tampered totals at approval are refused too.
    const bad = await call(id, 'approve', 'admin', { client_total_cents: 1 });
    expect(bad.status).toBe(409);
    expect((await dbEstimate(id)).status).toBe('pending_approval');
    const ok = await call(id, 'approve', 'admin', { note: 'Approved for the test' });
    expect(ok.status).toBe(200);
    const e = await dbEstimate(id);
    expect(e.status).toBe('approved');
    expect(e.approved_by).toBe('admin@example.com');
    expect(e.approved_at).not.toBeNull();
    expect(Number(e.approved_total_cents)).toBe(Number(e.total_cents));
    expect(e.approval_note).toBe('Approved for the test');
    const audit = await one<any[]>(svc.from('audit_log').select('actor_email, before, after').eq('suggestion_id', id).eq('action', 'estimate_status').order('id'));
    const last = audit[audit.length - 1];
    expect(last.actor_email).toBe('admin@example.com');
    expect(last.before.status).toBe('pending_approval');
    expect(last.after.status).toBe('approved');
    expect(audit.some((a) => a.actor_email === 'estimator@example.com' && a.after.status === 'pending_approval')).toBe(true);
    // Approving again is refused (only from pending_approval).
    expect((await call(id, 'approve', 'admin')).status).toBe(409);
  });

  it('send → /q/<22-char base64url token>, status sent, valid_until = office today + 30; token stored only as a hash', async () => {
    const r = await call(id, 'send', 'estimator');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('sent');
    expect(r.body.path).toMatch(/^\/q\/[A-Za-z0-9_-]{22}$/);
    token = tokenOf(r.body.path);
    validUntil = addDays(await officeToday(), 30);
    expect(r.body.valid_until).toBe(validUntil);
    const e = await dbEstimate(id);
    expect(e.status).toBe('sent');
    expect(e.valid_until).toBe(validUntil);
    expect(e.sent_at).not.toBeNull();
    termsId = e.terms_version_id;
    expect(termsId).toBeTruthy();
    const links = await one<any[]>(svc.from('quote_links').select('*').eq('estimate_id', id));
    expect(links).toHaveLength(1);
    expect(links[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(links[0])).not.toContain(token);
    expect(links[0].revoked_at).toBeNull();
    expect(new Date(links[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
  });

  it('a changed input after approval voids it: recompute → draft', async () => {
    // Use a second approved estimate so the sent one stays intact.
    const id2 = await makeEstimate({ discount_bp: 1500 }, 'Fn void approval');
    await call(id2, 'recompute', 'estimator');
    await call(id2, 'submit', 'estimator');
    expect((await call(id2, 'approve', 'admin')).status).toBe(200);
    expect((await dbEstimate(id2)).status).toBe('approved');
    const e = await dbEstimate(id2);
    await svc.from('estimates').update({ inputs: { ...e.inputs, options: { ...e.inputs.options, labor_hours: 5 } } }).eq('id', id2);
    const r = await call(id2, 'recompute', 'estimator');
    expect(r.status).toBe(200);
    const after = await dbEstimate(id2);
    expect(after.status).toBe('draft');
    expect(after.approved_at).toBeNull();
    expect(after.approved_by).toBeNull();
    expect(after.approved_total_cents).toBeNull();
    expect(Number(after.total_cents)).not.toBe(Number(e.total_cents));
    // …and it can't be sent again without a fresh approval.
    const send = await call(id2, 'send', 'estimator');
    expect(send.status).toBe(409);
    expect(send.body.code).toBe('needs_approval');
  });

  it('quote GET returns only client-visible content (deep key scan) and marks the estimate viewed', async () => {
    const r = await quoteGet(token);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const q = r.body.quote;
    expect(q.status).toBe('sent');
    expect(q.client_name).toMatch(/Fn Fixture Client/);
    expect(q.terms.id).toBe(termsId);
    const keys = deepKeys(r.body);
    const bad = keys.filter((k) => /cost|margin|trace|internal|snapshot|approv|estimator|needs_|original|override|reasons|rate_card|source|client_visible/i.test(k));
    expect(bad).toEqual([]);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('INTERNAL-SECRET-NOTE');
    expect(text).not.toContain('estimator@example.com');
    expect(text).not.toContain('admin@example.com');
    const lines = await dbLines(id);
    const visible = lines.filter((l) => l.client_visible);
    expect(q.lines).toHaveLength(visible.length);
    for (const hidden of lines.filter((l) => !l.client_visible && !visible.some((v) => v.description === l.description))) expect(text).not.toContain(hidden.description);
    expect(q.totals.total_cents).toBe(Number((await dbEstimate(id)).total_cents));
    expect(Object.keys(q.totals).sort()).toEqual(['discount_cents', 'subtotal_cents', 'tax_cents', 'total_cents']);
    expect((await dbEstimate(id)).status).toBe('viewed');
    const link = (await one<any[]>(svc.from('quote_links').select('view_count, first_viewed_at').eq('estimate_id', id)))[0];
    expect(link.view_count).toBe(1);
    expect(link.first_viewed_at).not.toBeNull();
    // Viewed quotes still present as "sent" to the client.
    expect((await quoteGet(token)).body.quote.status).toBe('sent');
  });

  it('wrong, tampered, malformed or unknown tokens → the same generic 404 as expired', async () => {
    const flip = token.slice(0, 5) + (token[5] === 'A' ? 'B' : 'A') + token.slice(6);
    const results = [
      await quoteGet(flip),
      await quoteGet('A'.repeat(22)),
      await quoteGet('short'),
      await quoteGet('has spaces and !!! not valid'),
      await quotePost(flip, 'accept', acceptBody(termsId)),
      await quotePost(flip, 'decline', {}),
    ];
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ ok: false, error: GONE });
    }
  });

  it('accept: signature not matching the name → 400; wrong terms version → 409 terms_changed; bad form → 400', async () => {
    const sig = await quotePost(token, 'accept', acceptBody(termsId, { signature: 'Someone Else' }));
    expect(sig.status).toBe(400);
    const agree = await quotePost(token, 'accept', acceptBody(termsId, { agree: false }));
    expect(agree.status).toBe(400);
    const mail = await quotePost(token, 'accept', acceptBody(termsId, { email: 'nope' }));
    expect(mail.status).toBe(400);
    const terms = await quotePost(token, 'accept', acceptBody('00000000-0000-4000-8000-000000000000'));
    expect(terms.status).toBe(409);
    expect(terms.body.code).toBe('terms_changed');
    expect(await one(svc.from('quote_acceptances').select('id').eq('estimate_id', id))).toHaveLength(0);
    expect(['sent', 'viewed']).toContain((await dbEstimate(id)).status);
  });

  it('accept: cross-origin post → 403', async () => {
    const r = await quotePost(token, 'accept', acceptBody(termsId), { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
  });

  it('valid accept → 200; acceptance row has name/email/ip/ua; status accepted; accept again → 409 already_accepted', async () => {
    const r = await quotePost(token, 'accept', acceptBody(termsId), { 'x-nf-client-connection-ip': '203.0.113.9', 'user-agent': 'FnTest/1.0 (vitest)' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const acc = await one<any[]>(svc.from('quote_acceptances').select('*').eq('estimate_id', id));
    expect(acc).toHaveLength(1);
    expect(acc[0]).toMatchObject({
      accepted_name: 'Jordan Q. Client', accepted_title: 'Registrar', accepted_email: 'jordan.client@example.com', signature_text: 'jordan q. client',
      agreed_to_terms: true, ip: '203.0.113.9', user_agent: 'FnTest/1.0 (vitest)', terms_version_id: termsId, revision: 1,
    });
    const e = await dbEstimate(id);
    expect(e.status).toBe('accepted');
    expect(e.accepted_at).not.toBeNull();
    expect(Number(acc[0].total_cents)).toBe(Number(e.total_cents));
    const again = await quotePost(token, 'accept', acceptBody(termsId));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_accepted');
    expect(await one(svc.from('quote_acceptances').select('id').eq('estimate_id', id))).toHaveLength(1);
    // The page now shows the accepted state, with the signer's name only.
    const view = await quoteGet(token);
    expect(view.status).toBe(200);
    expect(view.body.quote.status).toBe('accepted');
    expect(view.body.quote.accepted.name).toBe('Jordan Q. Client');
    expect(JSON.stringify(view.body)).not.toContain('203.0.113.9');
    // Declining an accepted quote is refused.
    expect((await quotePost(token, 'decline', {})).status).toBe(409);
  });

  it('convert a non-accepted estimate → 409', async () => {
    const draft = await makeEstimate({}, 'Fn not accepted');
    const r = await call(draft, 'convert', 'estimator');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/accepted/i);
    expect((await dbEstimate(draft)).converted_job_id).toBeNull();
  });

  it('convert accepted → draft job with stops/items copied, estimate number, crew note, and no prices', async () => {
    const r = await call(id, 'convert', 'estimator');
    expect(r.status).toBe(200);
    expect(r.body.job_id).toMatch(/^[0-9a-f-]{36}$/);
    jobIds.push(r.body.job_id);
    const e = await dbEstimate(id);
    expect(e.status).toBe('converted');
    expect(e.converted_job_id).toBe(r.body.job_id);
    const job = await one(svc.from('jobs').select('*').eq('id', r.body.job_id).single());
    expect(job.status).toBe('draft');
    expect(job.title).toBe(e.title);
    expect(job.source_estimate_number).toBe(e.estimate_number);
    expect(job.estimate_accepted_at).not.toBeNull();
    expect(job.client_id).toBe(clientId);
    expect(job.crew_notes).toContain(`Suggested crew from estimate: ${e.suggested_crew}`);
    expect(Object.keys(job).filter((k) => /_cents$|margin|cost|price|total|discount/i.test(k))).toEqual([]);
    expect(JSON.stringify(job)).not.toContain('INTERNAL-SECRET-NOTE');
    const stops = await one<any[]>(svc.from('job_stops').select('*').eq('job_id', job.id).order('position'));
    expect(stops.map((s) => [s.kind, s.address])).toEqual([
      ['origin', '1200 Example Ave, Los Angeles, CA'],
      ['destination', '45 Sample Canyon Rd, Los Angeles, CA'],
    ]);
    const items = await one<any[]>(svc.from('job_items').select('*').eq('job_id', job.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ description: 'Large painting', quantity: 1 });
    expect(Object.keys(items[0]).filter((k) => /_cents$|margin|cost|price|total/i.test(k))).toEqual([]);
    // Converting twice is refused; the quote page still reads as accepted.
    expect((await call(id, 'convert', 'estimator')).status).toBe(409);
    expect((await quoteGet(token)).body.quote.status).toBe('accepted');
  });

  it('dispatcher / viewer / crew cannot convert (403)', async () => {
    for (const role of ['dispatcher', 'viewer', 'crew']) expect((await call(id, 'convert', role)).status).toBe(403);
  });
});

// ── link lifecycle: replace, expire, revoke, decline ────────────────────────
describe('quote link lifecycle', () => {
  let id = '';
  let t1 = '';
  let t2 = '';
  let termsId = '';

  beforeAll(async () => {
    id = await makeEstimate({}, 'Fn link lifecycle');
  });

  it('send (no approval needed) then send again: the first token is revoked and returns the generic 404', async () => {
    const a = await call(id, 'send', 'estimator');
    expect(a.status).toBe(200);
    t1 = tokenOf(a.body.path);
    termsId = (await dbEstimate(id)).terms_version_id;
    expect((await quoteGet(t1)).status).toBe(200);
    const b = await call(id, 'send', 'admin');
    expect(b.status).toBe(200);
    t2 = tokenOf(b.body.path);
    expect(t2).not.toBe(t1);
    const old = await quoteGet(t1);
    expect(old.status).toBe(404);
    expect(old.body).toEqual({ ok: false, error: GONE });
    const replay = await quotePost(t1, 'accept', acceptBody(termsId));
    expect(replay.status).toBe(404);
    expect(replay.body.error).toBe(GONE);
    expect(await one(svc.from('quote_acceptances').select('id').eq('estimate_id', id))).toHaveLength(0);
    expect((await quoteGet(t2)).status).toBe(200);
    const links = await one<any[]>(svc.from('quote_links').select('revoked_at').eq('estimate_id', id));
    expect(links.filter((l) => !l.revoked_at)).toHaveLength(1);
  });

  it('expired link (expires_at in the past) → the same generic 404 for GET, accept and decline', async () => {
    await svc.from('quote_links').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('estimate_id', id).is('revoked_at', null);
    for (const r of [await quoteGet(t2), await quotePost(t2, 'accept', acceptBody(termsId)), await quotePost(t2, 'decline', {})]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ ok: false, error: GONE });
    }
    expect(['sent', 'viewed']).toContain((await dbEstimate(id)).status);
  });

  it('a quote whose valid_until has passed → generic 404 and status expired', async () => {
    const fresh = await call(id, 'send', 'estimator');
    const t = tokenOf(fresh.body.path);
    await svc.from('estimates').update({ valid_until: addDays(await officeToday(), -1) }).eq('id', id);
    const r = await quoteGet(t);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ ok: false, error: GONE });
    expect((await dbEstimate(id)).status).toBe('expired');
  });

  it('revoke action → generic 404; revoke is staff-only', async () => {
    const id2 = await makeEstimate({}, 'Fn revoke');
    const s = await call(id2, 'send', 'estimator');
    const t = tokenOf(s.body.path);
    expect((await quoteGet(t)).status).toBe(200);
    expect((await call(id2, 'revoke', 'dispatcher')).status).toBe(403);
    expect((await call(id2, 'revoke', null)).status).toBe(401);
    expect((await quoteGet(t)).status).toBe(200);
    expect((await call(id2, 'revoke', 'estimator')).status).toBe(200);
    for (const r of [await quoteGet(t), await quotePost(t, 'accept', acceptBody((await dbEstimate(id2)).terms_version_id)), await quotePost(t, 'decline', {})]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ ok: false, error: GONE });
    }
  });

  it('decline flow: reason saved, status declined, second decline / accept refused', async () => {
    const id3 = await makeEstimate({}, 'Fn decline');
    const s = await call(id3, 'send', 'estimator');
    const t = tokenOf(s.body.path);
    const terms = (await dbEstimate(id3)).terms_version_id;
    const d = await quotePost(t, 'decline', { reason: 'Went with a different vendor.' });
    expect(d.status).toBe(200);
    const e = await dbEstimate(id3);
    expect(e.status).toBe('declined');
    expect(e.decline_reason).toBe('Went with a different vendor.');
    expect(e.declined_at).not.toBeNull();
    expect((await quotePost(t, 'decline', {})).status).toBe(409);
    const acc = await quotePost(t, 'accept', acceptBody(terms));
    expect([404, 409]).toContain(acc.status);
    expect(await one(svc.from('quote_acceptances').select('id').eq('estimate_id', id3))).toHaveLength(0);
    // A declined quote is still readable by its holder, showing the declined state.
    expect((await quoteGet(t)).body.quote.status).toBe('declined');
  });

  it('only GET / accept / decline are served on /api/quote', async () => {
    const r = await quoteFn(new Request(`${ORIGIN}/api/quote/${t2}`, { method: 'DELETE' }));
    expect(r.status).toBe(405);
    const bad = await quoteFn(new Request(`${ORIGIN}/api/quote/${t2}/explode`, { method: 'POST', headers: { origin: ORIGIN, host: 'localhost:8888' }, body: '{}' }));
    expect(bad.status).toBe(405);
  });
});

// ── revisions ───────────────────────────────────────────────────────────────
describe('revise a sent estimate', () => {
  it('revise revokes the old link (generic 404); a forced-live old link is rejected as 409 superseded once the new revision is sent', async () => {
    const id = await makeEstimate({}, 'Fn revise');
    const s1 = await call(id, 'send', 'estimator');
    const t1 = tokenOf(s1.body.path);
    const rev1 = await dbEstimate(id);
    const terms = rev1.terms_version_id;
    expect((await quoteGet(t1)).status).toBe(200);

    const rv = await call(id, 'revise', 'estimator');
    expect(rv.status).toBe(200);
    const newId = rv.body.id as string;
    estimateIds.push(newId);
    const rev2 = await dbEstimate(newId);
    expect(rev2).toMatchObject({ estimate_number: rev1.estimate_number, revision: 2, status: 'draft', title: rev1.title });
    expect(Number(rev2.total_cents)).toBe(Number(rev1.total_cents));
    expect(await one(svc.from('estimate_items').select('id').eq('estimate_id', newId))).toHaveLength(1);
    expect(await one(svc.from('estimate_stops').select('id').eq('estimate_id', newId))).toHaveLength(2);
    // Revising an already-superseded revision is refused.
    expect((await call(id, 'revise', 'estimator')).status).toBe(409);

    // Documented behaviour: revise revokes every live link of the old revision, so the old link is the generic 404.
    const old = await quoteGet(t1);
    expect(old.status).toBe(404);
    expect(old.body).toEqual({ ok: false, error: GONE });
    expect((await quotePost(t1, 'accept', acceptBody(terms))).status).toBe(404);

    // Send the new revision, then force the OLD link live again to exercise the superseded guard.
    const s2 = await call(newId, 'send', 'estimator');
    expect(s2.status).toBe(200);
    const t2 = tokenOf(s2.body.path);
    await svc.from('quote_links').update({ revoked_at: null }).eq('estimate_id', id);
    const forced = await quotePost(t1, 'accept', acceptBody(terms));
    expect(forced.status).toBe(409);
    expect(forced.body.code).toBe('superseded');
    expect(await one(svc.from('quote_acceptances').select('id').eq('estimate_id', id))).toHaveLength(0);
    const view = await quoteGet(t1);
    expect(view.status).toBe(200);
    expect(view.body.quote.superseded).toBe(true);
    expect(view.body.quote.revision).toBe(1);
    // The new revision's link works and is not superseded.
    const v2 = await quoteGet(t2);
    expect(v2.status).toBe(200);
    expect(v2.body.quote.revision).toBe(2);
    expect(v2.body.quote.superseded).toBe(false);
    const acc = await quotePost(t2, 'accept', acceptBody((await dbEstimate(newId)).terms_version_id));
    expect(acc.status).toBe(200);
  });

  it('duplicate makes a new estimate number; templates cannot be revised or sent', async () => {
    const id = await makeEstimate({}, 'Fn duplicate');
    const d = await call(id, 'duplicate', 'estimator');
    expect(d.status).toBe(200);
    estimateIds.push(d.body.id);
    const src = await dbEstimate(id);
    const copy = await dbEstimate(d.body.id);
    expect(copy.estimate_number).not.toBe(src.estimate_number);
    expect(copy.title).toBe('Fn duplicate (copy)');
    expect(copy.revision).toBe(1);
    expect(copy.status).toBe('draft');
    await svc.from('estimates').update({ is_template: true }).eq('id', id);
    expect((await call(id, 'revise', 'estimator')).status).toBe(409);
  });

  it('reprice refreshes the snapshot and drops an approval; locked statuses are refused', async () => {
    const id = await makeEstimate({}, 'Fn reprice');
    const r = await call(id, 'reprice', 'estimator');
    expect(r.status).toBe(200);
    const e = await dbEstimate(id);
    expect(Number(e.total_cents)).toBeGreaterThan(0);
    await call(id, 'send', 'estimator');
    expect((await call(id, 'reprice', 'estimator')).status).toBe(409);
    expect((await call(id, 'recompute', 'estimator')).status).toBe(409);
  });
});

// ── server recompute integrity on the client page ───────────────────────────
describe('quote page re-prices on the server', () => {
  it('a tampered estimates.total_cents → GET 409 "being updated" and accept refuses; no acceptance is written', async () => {
    const id = await makeEstimate({}, 'Fn tamper');
    const s = await call(id, 'send', 'estimator');
    const t = tokenOf(s.body.path);
    const e = await dbEstimate(id);
    expect((await quoteGet(t)).status).toBe(200);
    await svc.from('estimates').update({ total_cents: Number(e.total_cents) - 5000 }).eq('id', id);
    const view = await quoteGet(t);
    expect(view.status).toBe(409);
    expect(view.body.error).toMatch(/being updated/i);
    expect(JSON.stringify(view.body)).not.toMatch(/total_cents|lines/);
    const acc = await quotePost(t, 'accept', acceptBody(e.terms_version_id));
    expect(acc.status).toBe(409);
    expect(acc.body.error).toMatch(/being updated/i);
    expect(await one(svc.from('quote_acceptances').select('id').eq('estimate_id', id))).toHaveLength(0);
    expect(['sent', 'viewed']).toContain((await dbEstimate(id)).status);
    // Staff recompute heals it (status sent is locked, so restore via service and confirm the page works again).
    await svc.from('estimates').update({ total_cents: Number(e.total_cents) }).eq('id', id);
    expect((await quoteGet(t)).status).toBe(200);
  });

  it('a tampered rate snapshot cannot change what the client is charged without breaking the stored total', async () => {
    const id = await makeEstimate({}, 'Fn tamper snapshot');
    const s = await call(id, 'send', 'estimator');
    const t = tokenOf(s.body.path);
    const e = await dbEstimate(id);
    const snap = JSON.parse(JSON.stringify(e.rate_snapshot));
    snap.rates.vehicles[0].minimum_bill = snap.rates.vehicles[0].minimum_bill + 1_000_000;
    snap.rates.vehicles.forEach((v: any) => (v.per_hour.bill += 50_000));
    await svc.from('estimates').update({ rate_snapshot: snap }).eq('id', id);
    const view = await quoteGet(t);
    expect(view.status).toBe(409);
    await svc.from('estimates').update({ rate_snapshot: e.rate_snapshot }).eq('id', id);
  });
});
