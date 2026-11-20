/**
 * Conflict detection (warn, don't block): one test per rule, plus access,
 * board view, override audit, and cancelled/deleted jobs. Fixtures live in 2031
 * (except the checklist rule, which is relative to now) so they never collide with seed data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, stackIsUp, userClient } from '../helpers/local';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = SupabaseClient<any, any, any>;
const svc = serviceClient() as unknown as Any;
const admin = userClient('admin@example.com') as unknown as Any;
const dispatcher = userClient('dispatcher@example.com') as unknown as Any;
const viewer = userClient('viewer@example.com') as unknown as Any;
const crew = userClient('crew@example.com') as unknown as Any;
const norole = userClient('random.person@gmail.com') as unknown as Any;

const made = { jobs: [] as string[], crew: [] as string[], assets: [] as string[] };
const c = {} as Record<string, string>;
const a = {} as Record<string, string>;

async function one(q: PromiseLike<{ data: any; error: any }>) {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
/** LA local time on a June 2031 day → ISO (June is PDT, UTC-7). */
const la = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2031, 5, day, h + 7, m)).toISOString();
};

async function mkCrew(name: string, skills: string[]) {
  const id = (await one(svc.from('crew_members').insert({ display_name: name }).select('id').single())).id;
  made.crew.push(id);
  if (skills.length) await one(svc.from('crew_skills').insert(skills.map((skill) => ({ crew_member_id: id, skill }))));
  return id;
}
async function mkAsset(kind: string, status = 'in_service', caps: string[] = []) {
  const id = (await one(svc.from('assets').insert({ kind, name: `C ${kind} ${randomUUID().slice(0, 6)}`, status, capabilities: caps }).select('id').single())).id;
  made.assets.push(id);
  return id;
}
interface JobOpts {
  start: string;
  end: string;
  type?: string;
  status?: string;
  crew?: string[];
  assets?: string[];
  items?: string[][];
  checkAll?: boolean;
}
async function mkJob(o: JobOpts) {
  const id = (
    await one(
      svc
        .from('jobs')
        .insert({ title: `Conflict test ${randomUUID().slice(0, 6)}`, job_type: o.type ?? 'pickup', status: o.status ?? 'scheduled', start_at: o.start, end_at: o.end })
        .select('id')
        .single(),
    )
  ).id;
  made.jobs.push(id);
  if (o.crew?.length) await one(svc.from('job_assignments').insert(o.crew.map((crew_member_id) => ({ job_id: id, crew_member_id }))));
  if (o.assets?.length) await one(svc.from('job_assets').insert(o.assets.map((asset_id) => ({ job_id: id, asset_id }))));
  if (o.items?.length) await one(svc.from('job_items').insert(o.items.map((handling_flags, i) => ({ job_id: id, description: `Item ${i}`, handling_flags }))));
  // Keep the checklist rule out of the way for 2031 fixtures unless asked.
  if (o.checkAll !== false) await svc.from('job_checklist_items').update({ checked_at: new Date().toISOString() }).eq('job_id', id);
  return id;
}
async function conflicts(job: string, client: Any = admin) {
  const r = await client.rpc('job_conflicts', { p_job: job });
  if (r.error) throw new Error(r.error.message);
  return r.data as { code: string; message: string; crew_member_id: string | null; asset_id: string | null }[];
}
const codes = async (job: string) => (await conflicts(job)).map((x) => x.code);

beforeAll(async () => {
  if (!(await stackIsUp())) throw new Error('Local Supabase is not running. Start it with `npx supabase start`.');
  c.full = await mkCrew('Full Skills', ['art_handler', 'driver', 'installer', 'crater']);
  c.full2 = await mkCrew('Full Skills Two', ['art_handler', 'driver', 'installer', 'crater']);
  c.handler = await mkCrew('Only Handler', ['art_handler']);
  c.driver = await mkCrew('Only Driver', ['driver']);
  await one(svc.from('crew_certifications').insert({ crew_member_id: c.driver, type: 'drivers_license', expires_on: '2031-01-01' }));
  a.truck = await mkAsset('truck');
  a.truck2 = await mkAsset('truck');
  a.lift = await mkAsset('equipment', 'maintenance', ['lift']);
});

afterAll(async () => {
  await svc.from('jobs').delete().in('id', made.jobs);
  await svc.from('crew_members').delete().in('id', made.crew);
  await svc.from('assets').delete().in('id', made.assets);
});

describe('rules', () => {
  it('crew_overlap: crew member on two overlapping jobs (adjacent jobs are fine)', async () => {
    const x = await mkJob({ start: la(2, '09:00'), end: la(2, '12:00'), crew: [c.handler] });
    const y = await mkJob({ start: la(2, '11:00'), end: la(2, '14:00'), crew: [c.handler] });
    const z = await mkJob({ start: la(2, '14:00'), end: la(2, '16:00'), crew: [c.handler] });
    const cx = await conflicts(x);
    expect(cx.some((k) => k.code === 'crew_overlap' && k.crew_member_id === c.handler)).toBe(true);
    expect(await codes(y)).toContain('crew_overlap');
    expect((await conflicts(z)).some((k) => k.code === 'crew_overlap')).toBe(false);
  });

  it('crew_time_off: full-day time off, and partial-day windows (hit and miss)', async () => {
    await one(svc.from('time_off').insert({ crew_member_id: c.full, start_date: '2031-06-03', end_date: '2031-06-03' }));
    await one(svc.from('time_off').insert({ crew_member_id: c.full2, start_date: '2031-06-04', end_date: '2031-06-04', start_time: '12:00', end_time: '14:00' }));
    const full = await mkJob({ start: la(3, '09:00'), end: la(3, '11:00'), crew: [c.full] });
    expect(await codes(full)).toContain('crew_time_off');
    const miss = await mkJob({ start: la(4, '09:00'), end: la(4, '11:00'), crew: [c.full2] });
    expect(await codes(miss)).not.toContain('crew_time_off');
    const hit = await mkJob({ start: la(4, '13:00'), end: la(4, '15:00'), crew: [c.full2] });
    expect(await codes(hit)).toContain('crew_time_off');
    const nextDay = await mkJob({ start: la(5, '09:00'), end: la(5, '11:00'), crew: [c.full] });
    expect(await codes(nextDay)).not.toContain('crew_time_off');
  });

  it('asset_double_booked: same truck on overlapping jobs', async () => {
    const x = await mkJob({ start: la(6, '09:00'), end: la(6, '12:00'), crew: [c.full], assets: [a.truck] });
    const y = await mkJob({ start: la(6, '10:00'), end: la(6, '13:00'), crew: [c.full2], assets: [a.truck] });
    expect((await conflicts(x)).some((k) => k.code === 'asset_double_booked' && k.asset_id === a.truck)).toBe(true);
    expect(await codes(y)).toContain('asset_double_booked');
    const other = await mkJob({ start: la(6, '10:00'), end: la(6, '13:00'), crew: [c.handler, c.full], assets: [a.truck2] });
    expect(await codes(other)).not.toContain('asset_double_booked');
  });

  it('asset_unavailable: equipment in maintenance', async () => {
    const x = await mkJob({ start: la(7, '09:00'), end: la(7, '12:00'), crew: [c.full], assets: [a.lift] });
    const k = (await conflicts(x)).find((r) => r.code === 'asset_unavailable');
    expect(k?.message).toMatch(/in maintenance/);
    await one(svc.from('assets').update({ status: 'in_service' }).eq('id', a.lift));
    expect(await codes(x)).not.toContain('asset_unavailable');
    await one(svc.from('assets').update({ status: 'maintenance' }).eq('id', a.lift));
  });

  it('two_person_short: a two-person item with fewer than 2 crew', async () => {
    const x = await mkJob({ start: la(8, '09:00'), end: la(8, '12:00'), crew: [c.full], items: [['two_person']] });
    expect(await codes(x)).toContain('two_person_short');
    await one(svc.from('job_assignments').insert({ job_id: x, crew_member_id: c.full2 }));
    expect(await codes(x)).not.toContain('two_person_short');
  });

  it('skill_missing: handling flags without an art handler, install without an installer, vehicle without a driver', async () => {
    const flags = await mkJob({ start: la(9, '09:00'), end: la(9, '10:00'), crew: [c.driver], items: [['fragile']] });
    expect((await conflicts(flags)).some((k) => k.code === 'skill_missing' && /art handler/.test(k.message))).toBe(true);
    const install = await mkJob({ start: la(9, '11:00'), end: la(9, '12:00'), type: 'install', crew: [c.handler] });
    expect((await conflicts(install)).some((k) => k.code === 'skill_missing' && /installer/.test(k.message))).toBe(true);
    const vehicle = await mkJob({ start: la(9, '13:00'), end: la(9, '14:00'), crew: [c.handler], assets: [a.truck2] });
    expect((await conflicts(vehicle)).some((k) => k.code === 'skill_missing' && /driver/.test(k.message))).toBe(true);
    const fine = await mkJob({ start: la(9, '15:00'), end: la(9, '16:00'), type: 'install', crew: [c.full], items: [['fragile']], assets: [a.truck2] });
    expect(await codes(fine)).not.toContain('skill_missing');
  });

  it('cert_expired: a driver with an expired license on a truck job', async () => {
    const x = await mkJob({ start: la(10, '09:00'), end: la(10, '12:00'), crew: [c.driver], assets: [a.truck] });
    expect((await conflicts(x)).some((k) => k.code === 'cert_expired' && k.crew_member_id === c.driver)).toBe(true);
    const noVehicle = await mkJob({ start: la(10, '13:00'), end: la(10, '14:00'), crew: [c.driver] });
    expect(await codes(noVehicle)).not.toContain('cert_expired');
  });

  it('checklist_incomplete: scheduled within 24h with open items; not when far away or all checked', async () => {
    const soon = new Date(Date.now() + 2 * 3600e3);
    const soonEnd = new Date(soon.getTime() + 3600e3);
    const open = await mkJob({ start: soon.toISOString(), end: soonEnd.toISOString(), checkAll: false });
    expect(await codes(open)).toContain('checklist_incomplete');
    const done = await mkJob({ start: soon.toISOString(), end: soonEnd.toISOString(), checkAll: true });
    expect(await codes(done)).not.toContain('checklist_incomplete');
    const far = new Date(Date.now() + 3 * 86400e3);
    const farJob = await mkJob({ start: far.toISOString(), end: new Date(far.getTime() + 3600e3).toISOString(), checkAll: false });
    expect(await codes(farJob)).not.toContain('checklist_incomplete');
    const draft = await mkJob({ start: soon.toISOString(), end: soonEnd.toISOString(), status: 'draft', checkAll: false });
    expect(await codes(draft)).not.toContain('checklist_incomplete');
  });

  it('cancelled and deleted jobs produce no conflicts and stop causing them', async () => {
    const x = await mkJob({ start: la(12, '09:00'), end: la(12, '12:00'), crew: [c.handler], assets: [a.truck] });
    const y = await mkJob({ start: la(12, '10:00'), end: la(12, '13:00'), crew: [c.handler], assets: [a.truck] });
    expect(await codes(y)).toEqual(expect.arrayContaining(['crew_overlap', 'asset_double_booked']));
    await one(svc.from('jobs').update({ status: 'cancelled' }).eq('id', x));
    expect(await codes(x)).toEqual([]);
    expect(await codes(y)).not.toContain('crew_overlap');
    await one(svc.from('jobs').update({ deleted_at: new Date().toISOString() }).eq('id', y));
    expect(await codes(y)).toEqual([]);
  });
});

describe('access, board view and overrides', () => {
  it('office roles can check conflicts; crew and no-role cannot', async () => {
    const x = await mkJob({ start: la(14, '09:00'), end: la(14, '10:00'), crew: [c.full] });
    for (const cl of [admin, dispatcher, viewer]) expect((await cl.rpc('job_conflicts', { p_job: x })).error).toBeNull();
    for (const cl of [crew, norole]) expect((await cl.rpc('job_conflicts', { p_job: x })).error).not.toBeNull();
    for (const cl of [crew, norole])
      expect((await cl.rpc('board_conflicts', { p_from: la(14, '00:00'), p_to: la(15, '00:00') })).error).not.toBeNull();
  });

  it('board_conflicts returns rows per job in range', async () => {
    const x = await mkJob({ start: la(16, '09:00'), end: la(16, '12:00'), crew: [c.handler] });
    const y = await mkJob({ start: la(16, '10:00'), end: la(16, '13:00'), crew: [c.handler] });
    const r = await viewer.rpc('board_conflicts', { p_from: la(16, '00:00'), p_to: la(17, '00:00') });
    expect(r.error).toBeNull();
    const rows = r.data as { job_id: string; code: string }[];
    expect(rows.some((k) => k.job_id === x && k.code === 'crew_overlap')).toBe(true);
    expect(rows.some((k) => k.job_id === y && k.code === 'crew_overlap')).toBe(true);
    const outside = await viewer.rpc('board_conflicts', { p_from: la(20, '00:00'), p_to: la(21, '00:00') });
    expect((outside.data as { job_id: string }[]).some((k) => k.job_id === x)).toBe(false);
  });

  it('override needs a dispatcher and a reason, and is audited with the conflicts', async () => {
    const x = await mkJob({ start: la(18, '09:00'), end: la(18, '12:00'), crew: [c.full], items: [['two_person']] });
    expect((await viewer.rpc('record_conflict_override', { p_job: x, p_reason: 'Viewer trying' })).error).not.toBeNull();
    expect((await crew.rpc('record_conflict_override', { p_job: x, p_reason: 'Crew trying' })).error).not.toBeNull();
    expect((await dispatcher.rpc('record_conflict_override', { p_job: x, p_reason: 'ok' })).error).not.toBeNull();
    const reason = 'Second handler meets crew on site';
    expect((await dispatcher.rpc('record_conflict_override', { p_job: x, p_reason: reason })).error).toBeNull();
    const { data } = await svc
      .from('audit_log')
      .select('actor_email, before, after')
      .eq('suggestion_id', x)
      .eq('action', 'dispatch_conflict_override')
      .single();
    expect(data!.actor_email).toBe('dispatcher@example.com');
    expect(data!.after).toEqual({ reason });
    expect(((data!.before as { conflicts: { code: string }[] }).conflicts).map((k) => k.code)).toContain('two_person_short');
  });
});
