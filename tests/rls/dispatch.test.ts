/**
 * Phase 2 dispatch: RLS / grants / RPCs for every role, against the local stack.
 * Roles: admin, dispatcher, viewer, crew, signed-in with no role, anon (+ HR-only).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LOCAL, anonClient, serviceClient, stackIsUp, userClient } from '../helpers/local';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = SupabaseClient<any, any, any>;
const svc = serviceClient() as unknown as Any;
const clients: Record<string, Any> = {
  admin: userClient('admin@example.com') as unknown as Any,
  dispatcher: userClient('dispatcher@example.com') as unknown as Any,
  viewer: userClient('viewer@example.com') as unknown as Any,
  crew: userClient('crew@example.com') as unknown as Any,
  norole: userClient('random.person@gmail.com') as unknown as Any,
  anon: anonClient() as unknown as Any,
};
const hr = userClient('hr@example.com') as unknown as Any;
const crew2 = userClient('crew2@example.com') as unknown as Any;
const ROLES = Object.keys(clients);
const OFFICE = ['admin', 'dispatcher', 'viewer'];
const rand = () => randomUUID().slice(0, 8);

const fx = {} as Record<string, string>;

async function one(q: PromiseLike<{ data: any; error: any }>) {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

beforeAll(async () => {
  if (!(await stackIsUp())) throw new Error('Local Supabase is not running. Start it with `npx supabase start`.');
  fx.avery = (await one(svc.from('crew_members').select('id').eq('email', 'crew@example.com').single())).id;
  fx.gray = (await one(svc.from('crew_members').select('id').eq('email', 'crew2@example.com').single())).id;
  fx.crew = (await one(svc.from('crew_members').insert({ display_name: 'Fixture Person', phone: '+13235559999', office_notes: 'OFFICE-SECRET-CREW' }).select('id').single())).id;
  await one(svc.from('crew_skills').insert({ crew_member_id: fx.crew, skill: 'art_handler' }));
  fx.cert = (await one(svc.from('crew_certifications').insert({ crew_member_id: fx.crew, type: 'forklift', expires_on: '2031-12-31' }).select('id').single())).id;
  fx.timeOff = (await one(svc.from('time_off').insert({ crew_member_id: fx.crew, start_date: '2031-02-01', end_date: '2031-02-02', note: 'OFFICE-SECRET-TO' }).select('id').single())).id;
  fx.asset = (await one(svc.from('assets').insert({ kind: 'van', name: `Fixture Van ${rand()}` }).select('id').single())).id;
  fx.template = (await one(svc.from('checklist_templates').insert({ job_type: 'storage_out', label: `Fixture template ${rand()}`, position: 50 }).select('id').single())).id;
  const job = (n: string) => ({
    title: `Fixture job ${n}`,
    job_type: 'delivery',
    status: 'scheduled',
    start_at: '2031-01-15T17:00:00Z',
    end_at: '2031-01-15T20:00:00Z',
    client_name: 'CLIENT-SECRET',
    office_notes: 'OFFICE-SECRET-JOB',
    crew_notes: 'Bring blankets',
  });
  fx.job1 = (await one(svc.from('jobs').insert({ ...job('1'), team_lead_id: fx.avery }).select('id').single())).id;
  fx.job2 = (await one(svc.from('jobs').insert({ ...job('2'), start_at: '2031-01-16T17:00:00Z', end_at: '2031-01-16T20:00:00Z' }).select('id').single())).id;
  await one(svc.from('job_assignments').insert([
    { job_id: fx.job1, crew_member_id: fx.avery },
    { job_id: fx.job1, crew_member_id: fx.gray },
    { job_id: fx.job1, crew_member_id: fx.crew },
    { job_id: fx.job2, crew_member_id: fx.gray },
  ]));
  await one(svc.from('job_assets').insert({ job_id: fx.job1, asset_id: fx.asset }));
  fx.stop = (await one(svc.from('job_stops').insert({ job_id: fx.job1, address: '1 Fixture St, Los Angeles, CA', contact_phone: '+13235550000' }).select('id').single())).id;
  fx.item = (await one(svc.from('job_items').insert({ job_id: fx.job1, description: 'Fixture painting', handling_flags: ['glass'] }).select('id').single())).id;
  fx.check1 = (await one(svc.from('job_checklist_items').select('id').eq('job_id', fx.job1).order('position').limit(1).single())).id;
  fx.check2 = (await one(svc.from('job_checklist_items').select('id').eq('job_id', fx.job2).order('position').limit(1).single())).id;
  fx.incident = (await one(svc.from('incident_reports').insert({ job_id: fx.job1, occurred_at: '2031-01-15T18:00:00Z', description: 'Fixture incident description', reported_by: 'dispatcher@example.com' }).select('id').single())).id;
  fx.photoPath = `${fx.incident}/${randomUUID()}.webp`;
  await one(svc.storage.from('incident-photos').upload(fx.photoPath, new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), { contentType: 'image/webp' }));
  fx.photo = (await one(svc.from('incident_photos').insert({ incident_id: fx.incident, path: fx.photoPath }).select('id').single())).id;
});

afterAll(async () => {
  await svc.storage.from('incident-photos').remove([fx.photoPath]);
  await svc.from('incident_reports').delete().in('job_id', [fx.job1, fx.job2].filter(Boolean));
  await svc.from('jobs').delete().in('id', [fx.job1, fx.job2].filter(Boolean));
  await svc.from('crew_members').delete().eq('id', fx.crew);
  await svc.from('assets').delete().eq('id', fx.asset);
  await svc.from('checklist_templates').delete().eq('id', fx.template);
});

// ── Table specs ──────────────────────────────────────────────────────────────
interface Spec {
  table: string;
  /** fresh row for insert / delete tests */
  make: () => Record<string, unknown>;
  /** primary-key filter for a row */
  key: (row: any) => Record<string, unknown>;
  /** fixture row filter + harmless patch for update tests */
  fixture: () => Record<string, unknown>;
  patch: Record<string, unknown> | (() => Record<string, unknown>);
}
const ID = (r: any) => ({ id: r.id });
const SPECS: Spec[] = [
  { table: 'app_settings', make: () => ({ key: `t_${rand()}`, value: 'x' }), key: (r) => ({ key: r.key }), fixture: () => ({ key: 'timezone' }), patch: { value: 'America/Los_Angeles' } },
  { table: 'skills', make: () => ({ slug: `t_${rand()}`, label: 'Test skill' }), key: (r) => ({ slug: r.slug }), fixture: () => ({ slug: 'driver' }), patch: { label: 'Driver' } },
  { table: 'certification_types', make: () => ({ slug: `t_${rand()}`, label: 'Test cert' }), key: (r) => ({ slug: r.slug }), fixture: () => ({ slug: 'cdl' }), patch: { label: 'CDL' } },
  { table: 'crew_members', make: () => ({ display_name: `Temp ${rand()}` }), key: ID, fixture: () => ({ id: fx.crew }), patch: { lift_capacity_lbs: 60 } },
  { table: 'crew_skills', make: () => ({ crew_member_id: fx.crew, skill: 'forklift' }), key: (r) => ({ crew_member_id: r.crew_member_id, skill: r.skill }), fixture: () => ({ crew_member_id: fx.crew, skill: 'art_handler' }), patch: { skill: 'art_handler' } },
  { table: 'crew_certifications', make: () => ({ crew_member_id: fx.crew, type: 'osha_10' }), key: ID, fixture: () => ({ id: fx.cert }), patch: { expires_on: '2031-12-31' } },
  { table: 'time_off', make: () => ({ crew_member_id: fx.crew, start_date: '2031-03-01', end_date: '2031-03-01' }), key: ID, fixture: () => ({ id: fx.timeOff }), patch: { note: 'OFFICE-SECRET-TO' } },
  { table: 'assets', make: () => ({ kind: 'van', name: `Temp ${rand()}` }), key: ID, fixture: () => ({ id: fx.asset }), patch: { notes: 'ok' } },
  { table: 'jobs', make: () => ({ title: `Temp job ${rand()}`, job_type: 'pickup', start_at: '2031-04-01T17:00:00Z', end_at: '2031-04-01T18:00:00Z' }), key: ID, fixture: () => ({ id: fx.job2 }), patch: { crew_notes: 'Bring blankets' } },
  { table: 'job_stops', make: () => ({ job_id: fx.job1, address: '9 Temp St' }), key: ID, fixture: () => ({ id: fx.stop }), patch: { access_notes: 'ok' } },
  { table: 'job_items', make: () => ({ job_id: fx.job1, description: 'Temp item' }), key: ID, fixture: () => ({ id: fx.item }), patch: { medium: 'Oil' } },
  { table: 'job_assignments', make: () => ({ job_id: fx.job2, crew_member_id: fx.crew }), key: (r) => ({ job_id: r.job_id, crew_member_id: r.crew_member_id }), fixture: () => ({ job_id: fx.job1, crew_member_id: fx.crew }), patch: { role_on_job: 'helper' } },
  { table: 'job_assets', make: () => ({ job_id: fx.job2, asset_id: fx.asset }), key: (r) => ({ job_id: r.job_id, asset_id: r.asset_id }), fixture: () => ({ job_id: fx.job1, asset_id: fx.asset }), patch: () => ({ asset_id: fx.asset }) },
  { table: 'checklist_templates', make: () => ({ job_type: 'storage_out', label: `Temp ${rand()}` }), key: ID, fixture: () => ({ id: fx.template }), patch: { position: 50 } },
  { table: 'job_checklist_items', make: () => ({ job_id: fx.job2, label: `Temp ${rand()}` }), key: ID, fixture: () => ({ id: fx.check2 }), patch: { position: 0 } },
  { table: 'incident_reports', make: () => ({ job_id: fx.job2, occurred_at: '2031-01-16T18:00:00Z', description: 'Temporary incident text' }), key: ID, fixture: () => ({ id: fx.incident }), patch: { office_followup: 'ok' } },
  { table: 'incident_photos', make: () => ({ incident_id: fx.incident, path: `${fx.incident}/${randomUUID()}.jpg` }), key: ID, fixture: () => ({ id: fx.photo }), patch: () => ({ path: fx.photoPath }) },
  { table: 'staff_roles', make: () => ({ email: `temp-${rand()}@example.com`, role: 'viewer' }), key: (r) => ({ email: r.email }), fixture: () => ({ email: 'viewer@example.com' }), patch: { role: 'viewer' } },
];

const OFFICE_WRITE = ['crew_members', 'crew_skills', 'crew_certifications', 'time_off', 'assets', 'jobs', 'job_stops', 'job_items', 'job_assignments', 'job_assets', 'job_checklist_items', 'incident_reports'];

function canInsert(role: string, table: string) {
  if (role === 'admin') return table !== 'incident_photos';
  if (role === 'dispatcher') return OFFICE_WRITE.includes(table);
  return false;
}
const canUpdate = canInsert;
function canDelete(role: string, table: string) {
  if (role === 'admin') return table !== 'incident_photos';
  if (role === 'dispatcher') return OFFICE_WRITE.includes(table) && !['jobs', 'incident_reports'].includes(table);
  return false;
}

const match = (q: any, k: Record<string, unknown>) => Object.entries(k).reduce((acc, [c, v]) => acc.eq(c, v), q);
async function exists(table: string, k: Record<string, unknown>) {
  const { data } = await match(svc.from(table).select('*'), k);
  return (data ?? []).length > 0;
}

describe('reads', () => {
  for (const s of SPECS) {
    it(`${s.table}: office roles read, crew / no-role / anon / HR read nothing`, async () => {
      for (const role of ROLES) {
        const { data } = await clients[role].from(s.table).select('*').limit(50);
        if (OFFICE.includes(role) && s.table !== 'staff_roles') expect((data ?? []).length, `${role} ${s.table}`).toBeGreaterThan(0);
        else if (role === 'admin') expect((data ?? []).length).toBeGreaterThan(0);
        else expect(data ?? [], `${role} ${s.table}`).toHaveLength(0);
      }
      expect((await hr.from(s.table).select('*').limit(5)).data ?? [], `hr ${s.table}`).toHaveLength(0);
    });
  }
  it('staff_roles: only admins can list roles', async () => {
    expect(((await clients.admin.from('staff_roles').select('*')).data ?? []).length).toBeGreaterThan(0);
    for (const role of ['dispatcher', 'viewer', 'crew', 'norole', 'anon'])
      expect((await clients[role].from('staff_roles').select('*')).data ?? [], role).toHaveLength(0);
  });
});

describe('inserts', () => {
  for (const s of SPECS) {
    it(`${s.table}`, async () => {
      for (const role of ROLES) {
        const row = s.make();
        const { data, error } = await clients[role].from(s.table).insert(row).select('*');
        const ok = !error && (data ?? []).length > 0;
        expect(ok, `${role} insert ${s.table}: ${error?.message ?? ''}`).toBe(canInsert(role, s.table));
        if (ok) await match(svc.from(s.table).delete(), s.key(data![0]));
      }
    });
  }
});

describe('updates', () => {
  for (const s of SPECS) {
    it(`${s.table}`, async () => {
      for (const role of ROLES) {
        const patch = typeof s.patch === 'function' ? s.patch() : s.patch;
        const { data, error } = await match(clients[role].from(s.table).update(patch), s.fixture()).select('*');
        const ok = !error && (data ?? []).length > 0;
        expect(ok, `${role} update ${s.table}: ${error?.message ?? ''}`).toBe(canUpdate(role, s.table));
      }
    });
  }
});

describe('deletes', () => {
  for (const s of SPECS) {
    it(`${s.table}`, async () => {
      for (const role of ROLES) {
        const row = (await one(svc.from(s.table).insert(s.make()).select('*').single())) as any;
        const k = s.key(row);
        await match(clients[role].from(s.table).delete(), k);
        const gone = !(await exists(s.table, k));
        expect(gone, `${role} delete ${s.table}`).toBe(canDelete(role, s.table));
        if (!gone) await match(svc.from(s.table).delete(), k);
      }
    });
  }
});

describe('incident-photos bucket', () => {
  it('only office can sign/read; nobody but the service uploads', async () => {
    for (const role of ['crew', 'norole', 'anon']) {
      const b = clients[role].storage.from('incident-photos');
      expect((await b.createSignedUrl(fx.photoPath, 60)).error, role).not.toBeNull();
      expect((await b.download(fx.photoPath)).error, role).not.toBeNull();
      expect((await b.list(fx.incident)).data ?? [], role).toHaveLength(0);
    }
    expect((await hr.storage.from('incident-photos').createSignedUrl(fx.photoPath, 60)).error).not.toBeNull();
    for (const role of OFFICE) {
      const signed = await clients[role].storage.from('incident-photos').createSignedUrl(fx.photoPath, 300);
      expect(signed.error, role).toBeNull();
    }
    for (const role of ROLES) {
      const up = await clients[role].storage.from('incident-photos').upload(`${fx.incident}/${randomUUID()}.webp`, new Uint8Array([1]), { contentType: 'image/webp' });
      expect(up.error, role).not.toBeNull();
    }
    const pub = await fetch(`${LOCAL.url}/storage/v1/object/public/incident-photos/${fx.photoPath}`);
    expect(pub.status).toBeGreaterThanOrEqual(400);
  });
});

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keysDeep(x, out));
  return out;
}

describe('crew self-service', () => {
  it('my_jobs returns only assigned jobs, without office fields; teammates include phones', async () => {
    const r = await clients.crew.rpc('my_jobs', { p_from: '2031-01-01', p_to: '2031-01-31' });
    expect(r.error).toBeNull();
    const jobs = r.data as any[];
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain(fx.job1);
    expect(ids).not.toContain(fx.job2);
    const keys = keysDeep(jobs);
    for (const bad of ['office_notes', 'client_name', 'note', 'lift_capacity_lbs', 'sms_opt_in', 'email']) expect(keys.has(bad), bad).toBe(false);
    const raw = JSON.stringify(jobs);
    for (const s of ['OFFICE-SECRET', 'CLIENT-SECRET']) expect(raw).not.toContain(s);
    const j1 = jobs.find((j) => j.id === fx.job1);
    expect(j1.is_lead).toBe(true);
    expect(j1.teammates.length).toBe(3);
    expect(j1.teammates.every((t: any) => 'phone' in t)).toBe(true);
    expect(j1.teammates.some((t: any) => t.phone === '+13235559999')).toBe(true);
    expect(j1.items[0].handling_flags).toEqual(['glass']);
    // crew2 sees job2 too
    const r2 = (await crew2.rpc('my_jobs', { p_from: '2031-01-01', p_to: '2031-01-31' })).data as any[];
    expect(r2.map((j) => j.id).sort()).toEqual([fx.job1, fx.job2].sort());
  });

  it('non-crew roles get no jobs from my_jobs', async () => {
    for (const role of ['admin', 'dispatcher', 'viewer', 'norole']) {
      const r = await clients[role].rpc('my_jobs', { p_from: '2031-01-01', p_to: '2031-01-31' });
      expect(r.data ?? [], role).toEqual([]);
    }
    expect((await clients.anon.rpc('my_jobs', { p_from: '2031-01-01', p_to: '2031-01-31' })).error).not.toBeNull();
  });

  it('crew cannot read suggestions, admin notes, HR tables or audit', async () => {
    for (const t of ['suggestions', 'admin_notes', 'admins', 'hr_reports', 'hr_notes', 'hr_staff', 'audit_log'])
      expect((await clients.crew.from(t).select('*').limit(5)).data ?? [], t).toHaveLength(0);
    for (const role of ['dispatcher', 'viewer'])
      for (const t of ['hr_reports', 'hr_notes', 'hr_staff', 'suggestions', 'admin_notes'])
        expect((await clients[role].from(t).select('*').limit(5)).data ?? [], `${role} ${t}`).toHaveLength(0);
  });

  it('team lead ticks own checklist; non-lead and other-job crew are refused', async () => {
    expect((await clients.crew.rpc('crew_set_checklist', { p_item: fx.check1, p_checked: true })).error).toBeNull();
    const row = await one(svc.from('job_checklist_items').select('checked_at, checked_by').eq('id', fx.check1).single());
    expect(row.checked_at).not.toBeNull();
    expect(row.checked_by).toBe('crew@example.com');
    expect((await crew2.rpc('crew_set_checklist', { p_item: fx.check1, p_checked: false })).error).not.toBeNull();
    expect((await clients.crew.rpc('crew_set_checklist', { p_item: fx.check2, p_checked: true })).error).not.toBeNull();
    expect((await clients.viewer.rpc('crew_set_checklist', { p_item: fx.check1, p_checked: false })).error).not.toBeNull();
    expect((await clients.crew.rpc('crew_set_checklist', { p_item: fx.check1, p_checked: false })).error).toBeNull();
  });

  it('crew report named incidents on own jobs only; my_incidents shows own only', async () => {
    const args = (job: string) => ({
      p_job: job, p_item: fx.item, p_occurred_at: '2031-01-15T18:30:00Z', p_handlers: 'Avery, Gray',
      p_description: 'Corner of frame scuffed during carry', p_supervisor_notified: true, p_supervisor_name: 'Lead',
      p_fragments: false, p_packing: true,
    });
    const ok = await clients.crew.rpc('crew_report_incident', args(fx.job1));
    expect(ok.error).toBeNull();
    const inc = await one(svc.from('incident_reports').select('reported_by, status').eq('id', ok.data).single());
    expect(inc).toEqual({ reported_by: 'crew@example.com', status: 'open' });
    expect((await clients.crew.rpc('crew_report_incident', { ...args(fx.job2), p_item: null })).error).not.toBeNull();
    expect((await clients.norole.rpc('crew_report_incident', args(fx.job1))).error).not.toBeNull();
    const mine = (await clients.crew.rpc('my_incidents')).data as any[];
    expect(mine.map((m) => m.id)).toContain(ok.data);
    expect(mine.map((m) => m.id)).not.toContain(fx.incident);
    expect(((await crew2.rpc('my_incidents')).data as any[]).map((m) => m.id)).not.toContain(ok.data);
  });
});

describe('jobs: soft delete, hard delete, version', () => {
  it('dispatcher soft deletes but cannot hard delete; admin can hard delete', async () => {
    const j = await one(svc.from('jobs').insert({ title: 'Delete test', job_type: 'pickup', start_at: '2031-05-01T17:00:00Z', end_at: '2031-05-01T18:00:00Z' }).select('id').single());
    const soft = await clients.dispatcher.from('jobs').update({ deleted_at: new Date().toISOString() }).eq('id', j.id).select('id');
    expect(soft.data ?? []).toHaveLength(1);
    await clients.dispatcher.from('jobs').delete().eq('id', j.id);
    expect(await exists('jobs', { id: j.id })).toBe(true);
    await clients.admin.from('jobs').delete().eq('id', j.id);
    expect(await exists('jobs', { id: j.id })).toBe(false);
  });

  it('updates bump version; a stale version updates nothing', async () => {
    const before = await one(svc.from('jobs').select('version').eq('id', fx.job2).single());
    const r = await clients.dispatcher.from('jobs').update({ crew_notes: 'v-test' }).eq('id', fx.job2).eq('version', before.version).select('version');
    expect(r.data?.[0].version).toBe(before.version + 1);
    const stale = await clients.dispatcher.from('jobs').update({ crew_notes: 'stale' }).eq('id', fx.job2).eq('version', before.version).select('id');
    expect(stale.data ?? []).toHaveLength(0);
  });

  it('dispatch changes are audited; crew cannot read audit', async () => {
    const { data } = await svc.from('audit_log').select('action, actor_email').eq('suggestion_id', fx.job2).like('action', 'dispatch_%');
    expect((data ?? []).some((r: any) => r.action === 'dispatch_jobs_update' && r.actor_email === 'dispatcher@example.com')).toBe(true);
    expect((await clients.crew.from('audit_log').select('id').limit(5)).data ?? []).toHaveLength(0);
    expect((await clients.dispatcher.from('audit_log').select('id').limit(5)).data ?? []).toHaveLength(0);
  });
});

describe('staff roles', () => {
  it('only admins manage roles', async () => {
    for (const role of ['dispatcher', 'viewer', 'crew', 'norole']) {
      expect((await clients[role].from('staff_roles').insert({ email: `x-${rand()}@example.com`, role: 'admin' })).error, role).not.toBeNull();
      const upd = await clients[role].from('staff_roles').update({ role: 'admin' }).eq('email', 'dispatcher@example.com').select('*');
      expect(upd.data ?? [], role).toHaveLength(0);
    }
    expect((await clients.dispatcher.rpc('is_admin')).data).toBe(false);
    expect((await clients.admin.rpc('is_admin')).data).toBe(true);
    expect((await clients.dispatcher.rpc('my_staff_role')).data).toBe('dispatcher');
    expect((await clients.crew.rpc('my_staff_role')).data).toBe('crew');
    expect((await clients.admin.rpc('my_staff_role')).data).toBe('admin');
    expect((await clients.norole.rpc('my_staff_role')).data).toBeNull();
    expect((await hr.rpc('my_staff_role')).data).toBeNull();
  });

  it('staff_roles and admins stay in sync; last admin cannot be removed or demoted', async () => {
    const email = `sync-${rand()}@example.com`;
    const before = (await one(svc.from('admins').select('email'))).map((r: any) => r.email) as string[];
    try {
      expect((await clients.admin.from('staff_roles').insert({ email, role: 'admin' })).error).toBeNull();
      expect(await exists('admins', { email })).toBe(true);
      expect((await userClient(email).rpc('is_admin')).data).toBe(true);
      expect((await clients.admin.from('staff_roles').update({ role: 'viewer' }).eq('email', email)).error).toBeNull();
      expect(await exists('admins', { email })).toBe(false);
      expect((await userClient(email).rpc('is_admin')).data).toBe(false);
      await clients.admin.from('admins').insert({ email });
      expect((await one(svc.from('staff_roles').select('role').eq('email', email).single())).role).toBe('admin');
      await clients.admin.from('admins').delete().eq('email', email);
      expect(await exists('staff_roles', { email })).toBe(false);

      // Leave only admin@example.com, then try to remove/demote it.
      const others = before.filter((e) => e !== 'admin@example.com');
      expect((await clients.admin.from('staff_roles').delete().in('email', others)).error).toBeNull();
      const demote = await clients.admin.from('staff_roles').update({ role: 'dispatcher' }).eq('email', 'admin@example.com');
      expect(demote.error?.message).toMatch(/last admin/i);
      const del = await svc.from('staff_roles').delete().eq('email', 'admin@example.com');
      expect(del.error?.message).toMatch(/last admin/i);
      expect((await clients.admin.rpc('is_admin')).data).toBe(true);
    } finally {
      const now = (await one(svc.from('admins').select('email'))).map((r: any) => r.email) as string[];
      const missing = before.filter((e) => !now.includes(e));
      if (missing.length) await svc.from('admins').insert(missing.map((e) => ({ email: e })));
      await svc.from('staff_roles').delete().eq('email', email);
    }
  });

  it('HR membership grants nothing on dispatch, and the hook admits staff emails', async () => {
    expect((await hr.rpc('job_conflicts', { p_job: fx.job1 })).error).not.toBeNull();
    expect((await hr.rpc('my_jobs', { p_from: '2031-01-01', p_to: '2031-01-31' })).data ?? []).toEqual([]);
    const res = await fetch(`${LOCAL.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: LOCAL.publishable, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'viewer@example.com', password: 'a-long-password-123' }),
    });
    expect(JSON.stringify(await res.json())).not.toMatch(/not allowed/i);
  });
});
