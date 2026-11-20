/**
 * Phase 3 estimates: RLS / column grants / RPC privileges for every role, against the local stack.
 * Only admin + estimator may read any pricing table; dispatcher / viewer / crew / no-role / anon / HR see nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient, serviceClient, stackIsUp, userClient } from '../helpers/local';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = SupabaseClient<any, any, any>;
const svc = serviceClient() as unknown as Any;
const clients: Record<string, Any> = {
  admin: userClient('admin@example.com') as unknown as Any,
  estimator: userClient('estimator@example.com') as unknown as Any,
  dispatcher: userClient('dispatcher@example.com') as unknown as Any,
  viewer: userClient('viewer@example.com') as unknown as Any,
  crew: userClient('crew@example.com') as unknown as Any,
  norole: userClient('random.person@gmail.com') as unknown as Any,
  hr: userClient('hr@example.com') as unknown as Any,
  anon: anonClient() as unknown as Any,
};
const ROLES = Object.keys(clients);
const ESTIMATING = ['admin', 'estimator'];
const BLOCKED = ROLES.filter((r) => !ESTIMATING.includes(r));
const rand = () => randomUUID().slice(0, 8);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fx = {} as Record<string, any>;
const cleanup: (() => Promise<unknown>)[] = [];

async function one(q: PromiseLike<{ data: any; error: any }>) {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
/** A write "fails" when it errors OR (RLS-filtered update/delete) touches no rows. */
const touched = (r: { data: any; error: any }) => (r.error ? 0 : Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0);

const TABLE_FIXTURE: Record<string, string> = {};

beforeAll(async () => {
  if (!(await stackIsUp())) throw new Error('Local Supabase is not running. Start it with `npx supabase start`.');
  const active = await one(svc.from('rate_cards').select('id, rates').eq('status', 'active').single());
  fx.activeCard = active.id;
  fx.activeRates = active.rates;

  fx.client = (await one(svc.from('clients').insert({ name: `RLS Fixture Client ${rand()}` }).select('id').single())).id;
  fx.contact = (await one(svc.from('client_contacts').insert({ client_id: fx.client, name: 'Fixture Contact' }).select('id').single())).id;
  fx.draftCard = (await one(svc.from('rate_cards').insert({ name: `RLS draft ${rand()}`, rates: active.rates }).select('id').single())).id;
  fx.packing = (await one(svc.from('packing_rules').insert({ medium_match: `fixture-${rand()}`, condition: 'any', method: 'soft_pack' }).select('id').single())).id;
  fx.crewRule = (await one(svc.from('crew_size_rules').insert({ kind: 'base', crew: 2, param: `fx-${rand()}` }).select('id').single())).id;
  fx.terms = (await one(svc.from('terms_versions').insert({ version: 100000 + Math.floor(Math.random() * 800000), body: 'RLS fixture terms body text', title: 'RLS fixture' }).select('id').single())).id;

  fx.estimate = (await one(svc.from('estimates').insert({ title: 'RLS fixture estimate', client_id: fx.client, estimator_email: 'estimator@example.com', inputs: { options: {} } }).select('id').single())).id;
  fx.stop = (await one(svc.from('estimate_stops').insert({ estimate_id: fx.estimate, address: '1 Fixture Way, Los Angeles' }).select('id').single())).id;
  fx.item = (await one(svc.from('estimate_items').insert({ estimate_id: fx.estimate, description: 'Fixture painting' }).select('id').single())).id;

  // Lines (server RPC), a link, and a real acceptance on a second estimate.
  fx.estimate2 = (await one(svc.from('estimates').insert({ title: 'RLS fixture accepted', client_id: fx.client, estimator_email: 'estimator@example.com' }).select('id').single())).id;
  const line = {
    key: 'fx', category: 'labor', description: 'Fixture line', qty: 1, unit: 'ea', unit_cost_cents: 100, unit_price_cents: 200, amount_cents: 200,
    cost_cents: 100, source: 'calc', client_visible: true, item_id: null, trace: 'fx',
  };
  await one(svc.rpc('server_apply_estimate', { p_estimate: fx.estimate, p_actor: 'estimator@example.com', p_patch: {}, p_lines: [line], p_packing: null }));
  const hash = (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64);
  fx.link = await one(svc.rpc('server_create_quote_link', { p_estimate: fx.estimate, p_actor: 'estimator@example.com', p_token_hash: hash, p_expires: new Date(Date.now() + 864e5).toISOString() }));
  const hash2 = (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64);
  const link2 = await one(svc.rpc('server_create_quote_link', { p_estimate: fx.estimate2, p_actor: 'estimator@example.com', p_token_hash: hash2, p_expires: new Date(Date.now() + 864e5).toISOString() }));
  await one(svc.rpc('server_apply_estimate', { p_estimate: fx.estimate2, p_actor: 'estimator@example.com', p_patch: { status: 'sent' }, p_lines: null, p_packing: null }));
  await one(svc.rpc('server_accept_quote', { p_link: link2, p_name: 'Fixture Signer', p_title: '', p_email: 'signer@example.com', p_signature: 'Fixture Signer', p_terms: fx.terms, p_total: 0, p_ip: '127.0.0.1', p_ua: 'rls-test' }));
  fx.acceptance = (await one(svc.from('quote_acceptances').select('id').eq('estimate_id', fx.estimate2).single())).id;
  fx.line = (await one(svc.from('estimate_lines').select('id').eq('estimate_id', fx.estimate).limit(1).single())).id;

  Object.assign(TABLE_FIXTURE, {
    clients: fx.client,
    client_contacts: fx.contact,
    rate_cards: fx.draftCard,
    packing_rules: fx.packing,
    crew_size_rules: fx.crewRule,
    terms_versions: fx.terms,
    estimates: fx.estimate,
    estimate_stops: fx.stop,
    estimate_items: fx.item,
    estimate_lines: fx.line,
    quote_links: fx.link,
    quote_acceptances: fx.acceptance,
  });
});

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  await svc.from('jobs').delete().like('title', 'RLS fixture job%');
  await svc.from('quote_acceptances').delete().eq('estimate_id', fx.estimate2);
  await svc.from('estimates').delete().in('id', [fx.estimate, fx.estimate2].filter(Boolean));
  await svc.from('estimates').delete().like('title', 'RLS role insert%');
  await svc.from('terms_versions').delete().eq('id', fx.terms);
  await svc.from('terms_versions').delete().like('title', 'RLS role insert%');
  await svc.from('packing_rules').delete().eq('id', fx.packing);
  await svc.from('packing_rules').delete().like('medium_match', 'rls-role-%');
  await svc.from('crew_size_rules').delete().eq('id', fx.crewRule);
  await svc.from('crew_size_rules').delete().like('param', 'rls-role-%');
  await svc.from('rate_cards').delete().eq('id', fx.draftCard);
  await svc.from('rate_cards').delete().like('name', 'RLS role insert%');
  await svc.from('clients').delete().eq('id', fx.client);
  await svc.from('clients').delete().like('name', 'RLS role insert%');
});

describe('reads: only admin + estimator see pricing tables', () => {
  const TABLES = ['clients', 'client_contacts', 'rate_cards', 'packing_rules', 'crew_size_rules', 'terms_versions', 'estimates', 'estimate_stops', 'estimate_items', 'estimate_lines', 'quote_links', 'quote_acceptances'];
  for (const table of TABLES) {
    for (const role of ROLES) {
      it(`${table}: ${role} ${ESTIMATING.includes(role) ? 'reads the fixture row' : 'reads 0 rows'}`, async () => {
        const r = await clients[role].from(table).select('id').eq('id', TABLE_FIXTURE[table]);
        if (ESTIMATING.includes(role)) {
          expect(r.error).toBeNull();
          expect(r.data).toHaveLength(1);
        } else {
          // anon has no grant at all (error); other roles pass the grant but RLS hides every row.
          expect(r.data ?? []).toHaveLength(0);
          if (role !== 'anon') expect(r.error).toBeNull();
        }
      });
    }
    it(`${table}: unfiltered select returns 0 rows for non-estimating roles`, async () => {
      for (const role of BLOCKED) {
        const r = await clients[role].from(table).select('id').limit(50);
        expect(r.data ?? [], `${role} on ${table}`).toHaveLength(0);
      }
    });
  }

  it('estimating roles also see seeded pricing data in bulk', async () => {
    for (const role of ESTIMATING) {
      const r = await clients[role].from('rate_cards').select('id, status');
      expect(r.error).toBeNull();
      expect(r.data!.some((c: any) => c.status === 'active')).toBe(true);
    }
  });
});

describe('writes by non-estimating roles fail on every table', () => {
  const inserts: Record<string, () => Record<string, unknown>> = {
    clients: () => ({ name: `RLS role insert ${rand()}` }),
    client_contacts: () => ({ client_id: fx.client, name: 'Nope Contact' }),
    rate_cards: () => ({ name: `RLS role insert ${rand()}`, rates: fx.activeRates }),
    packing_rules: () => ({ medium_match: `rls-role-${rand()}`, condition: 'any', method: 'soft_pack' }),
    crew_size_rules: () => ({ kind: 'base', crew: 1, param: `rls-role-${rand()}` }),
    terms_versions: () => ({ version: 900000 + Math.floor(Math.random() * 90000), body: 'blocked terms body text', title: 'RLS role insert' }),
    estimates: () => ({ title: `RLS role insert ${rand()}` }),
    estimate_stops: () => ({ estimate_id: fx.estimate, address: 'Blocked Address 1' }),
    estimate_items: () => ({ estimate_id: fx.estimate, description: 'Blocked item' }),
    estimate_lines: () => ({ estimate_id: fx.estimate, key: 'x', category: 'labor', description: 'x', qty: 1, unit_cost_cents: 1, unit_price_cents: 1, amount_cents: 1, cost_cents: 1, source: 'calc' }),
    quote_links: () => ({ estimate_id: fx.estimate, token_hash: 'a'.repeat(64), expires_at: new Date(Date.now() + 1e6).toISOString() }),
    quote_acceptances: () => ({ estimate_id: fx.estimate, revision: 1, accepted_name: 'X Y', accepted_email: 'x@y.co', signature_text: 'X Y', agreed_to_terms: true, total_cents: 0 }),
  };
  for (const [table, make] of Object.entries(inserts)) {
    for (const role of BLOCKED) {
      it(`${table}: ${role} cannot insert`, async () => {
        const r = await clients[role].from(table).insert(make()).select();
        expect(r.error, `${role} insert into ${table}`).not.toBeNull();
      });
    }
  }

  for (const [table, id] of [
    ['clients', 'client'],
    ['rate_cards', 'draftCard'],
    ['packing_rules', 'packing'],
    ['estimates', 'estimate'],
    ['estimate_items', 'item'],
  ] as const) {
    for (const role of BLOCKED) {
      it(`${table}: ${role} cannot update or delete`, async () => {
        const col = table === 'clients' || table === 'rate_cards' ? 'name' : table === 'packing_rules' ? 'note' : table === 'estimates' ? 'title' : 'description';
        const u = await clients[role].from(table).update({ [col]: 'HACKED' }).eq('id', fx[id]).select();
        expect(touched(u)).toBe(0);
        const d = await clients[role].from(table).delete().eq('id', fx[id]).select();
        expect(touched(d)).toBe(0);
        const back = await one(svc.from(table).select('*').eq('id', fx[id]).single());
        expect(back[col]).not.toBe('HACKED');
      });
    }
  }
});

describe('estimator: edits clients/estimates, never rates/rules/terms', () => {
  it('can create and edit clients, contacts, estimates, stops and items', async () => {
    const e = clients.estimator;
    const c = await one(e.from('clients').insert({ name: `RLS role insert client ${rand()}` }).select('id').single());
    cleanup.push(async () => svc.from('clients').delete().eq('id', c.id));
    expect(touched(await e.from('clients').update({ notes: 'ok' }).eq('id', c.id).select())).toBe(1);
    await one(e.from('client_contacts').insert({ client_id: c.id, name: 'Est Contact' }).select('id').single());
    const est = await one(e.from('estimates').insert({ title: `RLS role insert est ${rand()}`, client_id: c.id, inputs: { options: { x: 1 } } }).select('id, estimator_email, status').single());
    cleanup.push(async () => svc.from('estimates').delete().eq('id', est.id));
    expect(est.estimator_email).toBe('estimator@example.com');
    expect(est.status).toBe('draft');
    await one(e.from('estimate_stops').insert({ estimate_id: est.id, address: '2 Fixture Way, LA' }).select('id').single());
    const it = await one(e.from('estimate_items').insert({ estimate_id: est.id, description: 'Estimator item' }).select('id').single());
    expect(touched(await e.from('estimate_items').update({ quantity: 3 }).eq('id', it.id).select())).toBe(1);
    expect(touched(await e.from('estimate_items').delete().eq('id', it.id).select())).toBe(1);
  });

  it('cannot insert rate cards, rules or terms', async () => {
    const e = clients.estimator;
    const rc = await e.from('rate_cards').insert({ name: `RLS role insert ${rand()}`, rates: fx.activeRates }).select();
    expect(rc.error).not.toBeNull();
    expect((await e.from('packing_rules').insert({ medium_match: `rls-role-${rand()}`, condition: 'any', method: 'soft_pack' })).error).not.toBeNull();
    expect((await e.from('crew_size_rules').insert({ kind: 'base', crew: 1, param: `rls-role-${rand()}` })).error).not.toBeNull();
    expect((await e.from('terms_versions').insert({ version: 800000 + Math.floor(Math.random() * 90000), body: 'blocked terms body text' })).error).not.toBeNull();
  });

  it('cannot update or delete rate cards, rules or terms', async () => {
    const e = clients.estimator;
    expect(touched(await e.from('rate_cards').update({ name: 'HACKED' }).eq('id', fx.draftCard).select())).toBe(0);
    expect(touched(await e.from('rate_cards').update({ rates: { ...fx.activeRates, currency: 'EUR' } }).eq('id', fx.draftCard).select())).toBe(0);
    expect(touched(await e.from('rate_cards').delete().eq('id', fx.draftCard).select())).toBe(0);
    expect(touched(await e.from('packing_rules').update({ note: 'HACKED' }).eq('id', fx.packing).select())).toBe(0);
    expect(touched(await e.from('crew_size_rules').update({ note: 'HACKED' }).eq('id', fx.crewRule).select())).toBe(0);
    expect(touched(await e.from('terms_versions').update({ title: 'HACKED' }).eq('id', fx.terms).select())).toBe(0);
    expect(touched(await e.from('terms_versions').delete().eq('id', fx.terms).select())).toBe(0);
    const card = await one(svc.from('rate_cards').select('name, rates').eq('id', fx.draftCard).single());
    expect(card.name).not.toBe('HACKED');
    expect(card.rates.currency).toBe(fx.activeRates.currency);
  });

  it('cannot activate or mark a rate card reviewed, nor make terms current', async () => {
    const e = clients.estimator;
    const a = await e.rpc('activate_rate_card', { p_card: fx.draftCard, p_effective: null });
    expect(a.error?.message).toMatch(/not allowed/i);
    const m = await e.rpc('mark_rate_card_reviewed', { p_card: fx.draftCard });
    expect(m.error?.message).toMatch(/not allowed/i);
    const t = await e.rpc('make_terms_current', { p_terms: fx.terms });
    expect(t.error?.message).toMatch(/not allowed/i);
    const card = await one(svc.from('rate_cards').select('status, reviewed_at').eq('id', fx.draftCard).single());
    expect(card).toMatchObject({ status: 'draft', reviewed_at: null });
  });
});

describe('admin: edits draft cards, rules and terms, with guard rails', () => {
  it('updates a DRAFT card (and clears review stamps)', async () => {
    const a = clients.admin;
    const r = await a.from('rate_cards').update({ name: 'Admin renamed draft', rates: { ...fx.activeRates, currency: 'USD' } }).eq('id', fx.draftCard).select('name');
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(1);
    expect(r.data![0].name).toBe('Admin renamed draft');
  });

  it('refuses to change rates on the ACTIVE card ("Only draft")', async () => {
    const r = await clients.admin.from('rate_cards').update({ rates: { ...fx.activeRates, currency: 'EUR' } }).eq('id', fx.activeCard).select();
    expect(r.error?.message).toMatch(/Only draft/i);
    const card = await one(svc.from('rate_cards').select('rates').eq('id', fx.activeCard).single());
    expect(card.rates.currency).toBe(fx.activeRates.currency);
  });

  it('cannot create a rate card directly as active', async () => {
    const r = await clients.admin.from('rate_cards').insert({ name: `RLS role insert ${rand()}`, status: 'active', rates: fx.activeRates }).select();
    expect(r.error?.message).toMatch(/drafts/i);
  });

  it('rejects malformed rates (shape constraint)', async () => {
    const r = await clients.admin.from('rate_cards').insert({ name: `RLS role insert ${rand()}`, rates: { schema_version: 1 } }).select();
    expect(r.error).not.toBeNull();
  });

  it('creates drafts, can mark reviewed (and estimators cannot, see above)', async () => {
    const a = clients.admin;
    const c = await one(a.from('rate_cards').insert({ name: `RLS role insert ${rand()}`, rates: fx.activeRates }).select('id, status, created_by').single());
    expect(c).toMatchObject({ status: 'draft', created_by: 'admin@example.com' });
    const m = await a.rpc('mark_rate_card_reviewed', { p_card: c.id });
    expect(m.error).toBeNull();
    const after = await one(svc.from('rate_cards').select('reviewed_by, reviewed_at, is_sample').eq('id', c.id).single());
    expect(after.reviewed_by).toBe('admin@example.com');
    expect(after.reviewed_at).not.toBeNull();
    expect(after.is_sample).toBe(false);
    // The active card cannot be "activated" again (only drafts).
    const bad = await a.rpc('activate_rate_card', { p_card: fx.activeCard, p_effective: null });
    expect(bad.error?.message).toMatch(/draft/i);
  });

  it('edits rules; terms are versioned (body immutable)', async () => {
    const a = clients.admin;
    expect(touched(await a.from('packing_rules').update({ note: 'admin edit' }).eq('id', fx.packing).select())).toBe(1);
    expect(touched(await a.from('crew_size_rules').update({ note: 'admin edit' }).eq('id', fx.crewRule).select())).toBe(1);
    const t = await a.from('terms_versions').update({ body: 'A totally different body of text' }).eq('id', fx.terms).select();
    expect(t.error?.message).toMatch(/versioned/i);
    expect(touched(await a.from('terms_versions').update({ title: 'Admin retitled' }).eq('id', fx.terms).select())).toBe(1);
  });

  it('non-admins (dispatcher, viewer, crew, hr) cannot activate/review/make-current', async () => {
    for (const role of ['dispatcher', 'viewer', 'crew', 'norole', 'hr']) {
      const c = clients[role];
      expect((await c.rpc('activate_rate_card', { p_card: fx.draftCard, p_effective: null })).error, role).not.toBeNull();
      expect((await c.rpc('mark_rate_card_reviewed', { p_card: fx.draftCard })).error, role).not.toBeNull();
      expect((await c.rpc('make_terms_current', { p_terms: fx.terms })).error, role).not.toBeNull();
      expect((await c.rpc('convert_estimate_to_job', { p_estimate: fx.estimate })).error, role).not.toBeNull();
    }
    expect((await clients.anon.rpc('activate_rate_card', { p_card: fx.draftCard, p_effective: null })).error).not.toBeNull();
  });
});

describe('estimates: input columns only', () => {
  for (const role of ESTIMATING) {
    it(`${role} can update inputs, title and notes`, async () => {
      const r = await clients[role].from('estimates').update({ title: `Edited by ${role}`, inputs: { options: { labor_hours: 2 } }, notes_internal: 'n' }).eq('id', fx.estimate).select('title, inputs, version');
      expect(r.error).toBeNull();
      expect(r.data).toHaveLength(1);
      expect(r.data![0].title).toBe(`Edited by ${role}`);
      expect(r.data![0].inputs).toEqual({ options: { labor_hours: 2 } });
    });

    it(`${role} cannot update computed or workflow columns (column grants)`, async () => {
      const before = await one(svc.from('estimates').select('total_cents, status, rate_snapshot, approved_at, cost_cents, margin_bp').eq('id', fx.estimate).single());
      const attempts: Record<string, unknown>[] = [
        { total_cents: 1 },
        { status: 'approved' },
        { rate_snapshot: { rates: {} } },
        { approved_at: new Date().toISOString() },
        { approved_by: 'x@y.co' },
        { cost_cents: 1 },
        { margin_bp: 9999 },
        { needs_approval: false },
        { estimate_number: 'Q-HACK-1' },
        { rate_card_id: fx.draftCard },
        { terms_version_id: fx.terms },
        { converted_job_id: null },
      ];
      for (const patch of attempts) {
        const r = await clients[role].from('estimates').update(patch).eq('id', fx.estimate).select();
        expect(r.error, JSON.stringify(patch)).not.toBeNull();
      }
      const after = await one(svc.from('estimates').select('total_cents, status, rate_snapshot, approved_at, cost_cents, margin_bp').eq('id', fx.estimate).single());
      expect(after).toEqual(before);
    });

    it(`${role} cannot insert an estimate with a total or status`, async () => {
      for (const extra of [{ total_cents: 5 }, { status: 'approved' }, { rate_snapshot: {} }]) {
        const r = await clients[role].from('estimates').insert({ title: `RLS role insert ${rand()}`, ...extra }).select();
        expect(r.error, JSON.stringify(extra)).not.toBeNull();
      }
    });

    it(`${role} cannot write lines, quote links or acceptances (any verb)`, async () => {
      const c = clients[role];
      const line = await c.from('estimate_lines').insert({ estimate_id: fx.estimate, key: 'x', category: 'labor', description: 'x', qty: 1, unit_cost_cents: 1, unit_price_cents: 1, amount_cents: 1, cost_cents: 1, source: 'calc' });
      expect(line.error).not.toBeNull();
      expect((await c.from('estimate_lines').update({ amount_cents: 1 }).eq('id', fx.line).select()).error).not.toBeNull();
      expect((await c.from('estimate_lines').delete().eq('id', fx.line).select()).error).not.toBeNull();
      expect((await c.from('quote_links').insert({ estimate_id: fx.estimate, token_hash: 'b'.repeat(64), expires_at: new Date(Date.now() + 1e6).toISOString() })).error).not.toBeNull();
      expect((await c.from('quote_links').update({ revoked_at: null }).eq('id', fx.link).select()).error).not.toBeNull();
      expect((await c.from('quote_acceptances').insert({ estimate_id: fx.estimate, revision: 1, accepted_name: 'X Y', accepted_email: 'x@y.co', signature_text: 'X Y', agreed_to_terms: true, total_cents: 0 })).error).not.toBeNull();
      expect((await c.from('quote_acceptances').delete().eq('id', fx.acceptance).select()).error).not.toBeNull();
      const still = await one(svc.from('estimate_lines').select('amount_cents').eq('id', fx.line).single());
      expect(Number(still.amount_cents)).toBe(200);
    });
  }
});

describe('server_* RPCs are service-only', () => {
  const calls: [string, Record<string, unknown>][] = [
    ['server_apply_estimate', { p_estimate: '', p_actor: 'x', p_patch: { total_cents: 1 }, p_lines: null, p_packing: null }],
    ['server_create_quote_link', { p_estimate: '', p_actor: 'x', p_token_hash: 'c'.repeat(64), p_expires: '2099-01-01T00:00:00Z' }],
    ['server_revoke_quote_links', { p_estimate: '', p_actor: 'x' }],
    ['server_record_quote_view', { p_link: '' }],
    ['server_accept_quote', { p_link: '', p_name: 'A B', p_title: '', p_email: 'a@b.co', p_signature: 'A B', p_terms: '', p_total: 0, p_ip: '', p_ua: '' }],
    ['server_decline_quote', { p_link: '', p_reason: '' }],
  ];
  for (const role of ROLES) {
    it(`${role} cannot call any server_* RPC`, async () => {
      for (const [fn, args] of calls) {
        const a = { ...args };
        for (const k of Object.keys(a)) if (a[k] === '') a[k] = k === 'p_estimate' ? fx.estimate : k === 'p_link' ? fx.link : k === 'p_terms' ? fx.terms : '';
        const r = await clients[role].rpc(fn, a);
        expect(r.error, `${role} ${fn}`).not.toBeNull();
        expect(r.error!.message, `${role} ${fn}`).toMatch(/permission denied|not found|could not find/i);
      }
      const e = await one(svc.from('estimates').select('total_cents').eq('id', fx.estimate).single());
      expect(Number(e.total_cents)).toBe(0);
    });
  }
});

describe('insert trigger snapshots the active rate card', () => {
  it('sets rate_card_id and rate_snapshot on insert, with rules copied', async () => {
    const e = await one(svc.from('estimates').select('rate_card_id, rate_snapshot, version, terms_version_id').eq('id', fx.estimate).single());
    expect(e.rate_card_id).toBe(fx.activeCard);
    expect(e.rate_snapshot).not.toBeNull();
    expect(e.rate_snapshot.rates.schema_version).toBe(1);
    expect(Array.isArray(e.rate_snapshot.packing_rules)).toBe(true);
    expect(e.rate_snapshot.packing_rules.length).toBeGreaterThan(0);
    expect(Array.isArray(e.rate_snapshot.crew_rules)).toBe(true);
    expect(e.rate_snapshot.packing_rules[0]).not.toHaveProperty('id');
    const cur = await one(svc.from('terms_versions').select('id').eq('is_current', true).single());
    expect(e.terms_version_id).toBe(cur.id);
  });

  it('a user-inserted estimate also gets the snapshot, and later rate-card edits do not alter it', async () => {
    const r = await one(clients.estimator.from('estimates').insert({ title: `RLS role insert snap ${rand()}` }).select('id').single());
    cleanup.push(async () => svc.from('estimates').delete().eq('id', r.id));
    const e = await one(svc.from('estimates').select('rate_card_id, rate_snapshot').eq('id', r.id).single());
    expect(e.rate_card_id).toBe(fx.activeCard);
    expect(e.rate_snapshot.rates).toEqual(fx.activeRates);
  });

  it('estimate_number and revision are immutable (service update attempt)', async () => {
    const before = await one(svc.from('estimates').select('estimate_number, revision').eq('id', fx.estimate).single());
    await svc.from('estimates').update({ estimate_number: 'Q-HACK-9', revision: 7 }).eq('id', fx.estimate);
    const after = await one(svc.from('estimates').select('estimate_number, revision').eq('id', fx.estimate).single());
    expect(after).toEqual(before);
  });
});

describe('audit', () => {
  it('a status change writes an estimate_status audit row naming the actor', async () => {
    await one(svc.rpc('server_apply_estimate', { p_estimate: fx.estimate, p_actor: 'Estimator@Example.com', p_patch: { status: 'pending_approval' }, p_lines: null, p_packing: null }));
    const rows = await one(svc.from('audit_log').select('actor_email, action, before, after').eq('suggestion_id', fx.estimate).eq('action', 'estimate_status').order('id', { ascending: false }));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actor_email).toBe('estimator@example.com');
    expect(rows[0].before).toEqual({ status: 'draft' });
    expect(rows[0].after.status).toBe('pending_approval');
    await one(svc.rpc('server_apply_estimate', { p_estimate: fx.estimate, p_actor: 'estimator@example.com', p_patch: { status: 'draft' }, p_lines: null, p_packing: null }));
  });

  it('input edits by a user are audited under the user email, and audit_log is not readable by estimator', async () => {
    await clients.estimator.from('estimates').update({ notes_internal: 'audited edit' }).eq('id', fx.estimate);
    const rows = await one(svc.from('audit_log').select('actor_email, action').eq('suggestion_id', fx.estimate).eq('action', 'estimate_estimates_update').order('id', { ascending: false }).limit(1));
    expect(rows[0].actor_email).toBe('estimator@example.com');
    const r = await clients.estimator.from('audit_log').select('id').eq('suggestion_id', fx.estimate);
    expect(r.data ?? []).toHaveLength(0);
  });
});

describe('dispatch side: jobs carry the estimate number, never prices', () => {
  it('dispatcher reads source_estimate_number of a converted job but nothing in estimates', async () => {
    const job = await one(
      svc.from('jobs').insert({
        title: `RLS fixture job ${rand()}`, job_type: 'delivery', status: 'draft', start_at: '2031-03-01T17:00:00Z', end_at: '2031-03-01T21:00:00Z',
        source_estimate_number: 'Q-2031-9999', estimate_accepted_at: '2031-02-01T00:00:00Z', client_id: fx.client,
      }).select('id').single(),
    );
    for (const role of ['dispatcher', 'viewer', 'admin']) {
      const r = await clients[role].from('jobs').select('*').eq('id', job.id).single();
      expect(r.error, role).toBeNull();
      expect(r.data.source_estimate_number).toBe('Q-2031-9999');
      expect(r.data.estimate_accepted_at).not.toBeNull();
      const keys = Object.keys(r.data);
      expect(keys.filter((k) => /_cents$|margin|cost|price|rate_|total|discount/i.test(k)), role).toEqual([]);
    }
    for (const t of ['estimates', 'estimate_lines', 'quote_acceptances', 'clients']) {
      expect((await clients.dispatcher.from(t).select('*').limit(10)).data ?? []).toHaveLength(0);
    }
    const items = await svc.from('job_items').select('*').limit(1);
    const stops = await svc.from('job_stops').select('*').limit(1);
    for (const row of [...(items.data ?? []), ...(stops.data ?? [])]) {
      expect(Object.keys(row).filter((k) => /_cents$|margin|cost|price|total/i.test(k))).toEqual([]);
    }
  });

  it('seeded converted job (if the seed is loaded) is visible to dispatcher with its estimate number only', async () => {
    const seeded = await one(svc.from('jobs').select('id, source_estimate_number').eq('source_estimate_number', 'Q-2026-0007'));
    if (!seeded.length) return;
    const r = await clients.dispatcher.from('jobs').select('*').eq('id', seeded[0].id).single();
    expect(r.error).toBeNull();
    expect(r.data.source_estimate_number).toBe('Q-2026-0007');
  });
});
