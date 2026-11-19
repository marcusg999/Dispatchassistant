/**
 * Row-Level Security, grants and Storage policies, exercised through the real
 * REST/Storage APIs as: anon, a signed-in NON-admin, and an admin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { LOCAL, anonClient, serviceClient, stackIsUp, userClient } from '../helpers/local';

const svc = serviceClient();
const anon = anonClient();
const outsider = userClient('random.person@gmail.com');
const admin = userClient('admin@example.com');

const TABLES = ['suggestions', 'admin_notes', 'admins', 'audit_log'] as const;
let rowId = '';
let photoPath = '';

beforeAll(async () => {
  if (!(await stackIsUp())) throw new Error('Local Supabase is not running. Start it with `npx supabase start`.');
  const hash = randomBytes(32).toString('hex');
  photoPath = `${randomUUID()}.webp`;
  await svc.storage.from('suggestion-photos').upload(photoPath, new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), {
    contentType: 'image/webp',
  });
  const { data, error } = await svc
    .from('suggestions')
    .insert({ body: 'RLS test row: trailer brakes squeal.', category: 'trucks_equipment', submitter_tag: 'important', admin_tag: 'important', tracking_hash: hash, photo_path: photoPath })
    .select('id')
    .single();
  if (error) throw error;
  rowId = data.id;
});

afterAll(async () => {
  await svc.storage.from('suggestion-photos').remove([photoPath]);
  await svc.from('suggestions').delete().eq('id', rowId);
});

describe('anon (publishable key, no session)', () => {
  it.each(TABLES)('cannot read %s', async (t) => {
    const { data, error } = await anon.from(t).select('*').limit(1);
    expect(error ?? (data?.length === 0 ? null : 'leak')).not.toBe('leak');
    expect(data ?? []).toHaveLength(0);
  });

  it('cannot insert a suggestion directly (only the server function can)', async () => {
    const { error } = await anon.from('suggestions').insert({
      body: 'sneaky direct insert attempt',
      category: 'other',
      submitter_tag: 'important',
      admin_tag: 'important',
      tracking_hash: randomBytes(32).toString('hex'),
    });
    expect(error).not.toBeNull();
  });

  it('cannot add itself as an admin or write the audit log', async () => {
    expect((await anon.from('admins').insert({ email: 'attacker@example.com' })).error).not.toBeNull();
    expect((await anon.from('audit_log').insert({ actor_email: 'x', action: 'fake' })).error).not.toBeNull();
  });

  it('cannot call admin RPCs or the portal RPCs', async () => {
    expect((await anon.rpc('portal_status', { p_hash: 'a'.repeat(64) })).error).not.toBeNull();
    expect((await anon.rpc('portal_board', {})).error).not.toBeNull();
    expect((await anon.rpc('hard_delete_suggestion', { p_id: rowId })).error).not.toBeNull();
    expect((await anon.rpc('log_export', { p_format: 'xlsx', p_filters: {}, p_row_count: 1 })).error).not.toBeNull();
  });

  it('cannot read, list, upload to or sign URLs from the photo bucket', async () => {
    const b = anon.storage.from('suggestion-photos');
    expect((await b.download(photoPath)).error).not.toBeNull();
    expect((await b.createSignedUrl(photoPath, 60)).error).not.toBeNull();
    expect((await b.list()).data ?? []).toHaveLength(0);
    expect((await b.upload(`${randomUUID()}.webp`, new Uint8Array([1, 2, 3]), { contentType: 'image/webp' })).error).not.toBeNull();
    const pub = await fetch(`${LOCAL.url}/storage/v1/object/public/suggestion-photos/${photoPath}`);
    expect(pub.status).toBeGreaterThanOrEqual(400);
  });
});

describe('signed-in user who is NOT an admin', () => {
  it.each(TABLES)('reads nothing from %s', async (t) => {
    const { data } = await outsider.from(t).select('*').limit(5);
    expect(data ?? []).toHaveLength(0);
  });

  it('cannot update suggestions, add notes or add admins', async () => {
    const upd = await outsider.from('suggestions').update({ status: 'done' }).eq('id', rowId).select('id');
    expect(upd.data ?? []).toHaveLength(0);
    expect((await outsider.from('admin_notes').insert({ suggestion_id: rowId, body: 'x' })).error).not.toBeNull();
    expect((await outsider.from('admins').insert({ email: 'random.person@gmail.com' })).error).not.toBeNull();
    const { data } = await svc.from('suggestions').select('status').eq('id', rowId).single();
    expect(data?.status).toBe('new');
  });

  it('is told it is not an admin, and cannot hard delete or log exports', async () => {
    expect((await outsider.rpc('is_admin')).data).toBe(false);
    expect((await outsider.rpc('hard_delete_suggestion', { p_id: rowId })).error).not.toBeNull();
    expect((await outsider.rpc('log_export', { p_format: 'xlsx', p_filters: {}, p_row_count: 1 })).error).not.toBeNull();
  });

  it('cannot read or sign photo URLs', async () => {
    expect((await outsider.storage.from('suggestion-photos').createSignedUrl(photoPath, 60)).error).not.toBeNull();
    expect((await outsider.storage.from('suggestion-photos').download(photoPath)).error).not.toBeNull();
  });
});

describe('admin', () => {
  it('can read and triage suggestions', async () => {
    const { data } = await admin.from('suggestions').select('id, body, status').eq('id', rowId).single();
    expect(data?.body).toContain('RLS test row');
    const upd = await admin.from('suggestions').update({ status: 'reviewing', admin_tag: 'crucial' }).eq('id', rowId).select('status, admin_tag, submitter_tag').single();
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual({ status: 'reviewing', admin_tag: 'crucial', submitter_tag: 'important' });
  });

  it('cannot change the body, original tag, photo or tracking hash (column grants)', async () => {
    expect((await admin.from('suggestions').update({ body: 'rewritten by admin!!' } as never).eq('id', rowId)).error).not.toBeNull();
    expect((await admin.from('suggestions').update({ submitter_tag: 'crucial' } as never).eq('id', rowId)).error).not.toBeNull();
    expect((await admin.from('suggestions').update({ tracking_hash: 'b'.repeat(64) } as never).eq('id', rowId)).error).not.toBeNull();
  });

  it('cannot insert suggestions directly', async () => {
    const { error } = await admin.from('suggestions').insert({
      body: 'admin direct insert attempt',
      category: 'other',
      submitter_tag: 'important',
      admin_tag: 'important',
      tracking_hash: randomBytes(32).toString('hex'),
    });
    expect(error).not.toBeNull();
  });

  it('writes notes whose author is forced to the session email', async () => {
    const { data, error } = await admin
      .from('admin_notes')
      .insert({ suggestion_id: rowId, body: 'Checked the brakes.', author_email: 'someone-else@example.com' })
      .select('*')
      .single();
    expect(error).toBeNull();
    expect(data?.author_email).toBe('admin@example.com');
  });

  it('every action lands in the audit log with before/after', async () => {
    const { data } = await admin.from('audit_log').select('action, actor_email, before, after').eq('suggestion_id', rowId).order('id');
    const actions = (data ?? []).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['status_change', 'retag', 'note_added']));
    const retag = data!.find((r) => r.action === 'retag')!;
    expect(retag).toMatchObject({ actor_email: 'admin@example.com', before: { admin_tag: 'important' }, after: { admin_tag: 'crucial' } });
  });

  it('can read the audit log but never update or delete it', async () => {
    const { data } = await admin.from('audit_log').select('id').limit(1).single();
    expect(data?.id).toBeTruthy();
    expect((await admin.from('audit_log').update({ action: 'tampered' }).eq('id', data!.id)).error).not.toBeNull();
    expect((await admin.from('audit_log').delete().eq('id', data!.id)).error).not.toBeNull();
    expect((await admin.from('audit_log').insert({ actor_email: 'admin@example.com', action: 'forged' })).error).not.toBeNull();
    const still = await svc.from('audit_log').select('action').eq('id', data!.id).single();
    expect(still.data?.action).not.toBe('tampered');
  });

  it('can log an export via RPC', async () => {
    expect((await admin.rpc('log_export', { p_format: 'xlsx', p_filters: { status: 'new' }, p_row_count: 3 })).error).toBeNull();
    const { data } = await svc.from('audit_log').select('action, after').eq('action', 'export').order('id', { ascending: false }).limit(1).single();
    expect(data?.after).toMatchObject({ format: 'xlsx', rows: 3 });
  });

  it('can mint a short-lived signed URL for a photo but cannot upload', async () => {
    const signed = await admin.storage.from('suggestion-photos').createSignedUrl(photoPath, 300);
    expect(signed.error).toBeNull();
    expect(signed.data?.signedUrl).toContain('token=');
    expect((await admin.storage.from('suggestion-photos').upload(`${randomUUID()}.webp`, new Uint8Array([1]), { contentType: 'image/webp' })).error).not.toBeNull();
  });

  it('can soft delete and restore', async () => {
    expect((await admin.from('suggestions').update({ deleted_at: new Date().toISOString() }).eq('id', rowId)).error).toBeNull();
    expect((await admin.from('suggestions').update({ deleted_at: null }).eq('id', rowId)).error).toBeNull();
  });
});

describe('admins table and the last-admin guard', () => {
  it('admins can add and remove admins, and the last admin can never be removed', async () => {
    const before = (await svc.from('admins').select('email')).data!.map((r) => r.email);
    try {
      expect((await admin.from('admins').insert({ email: 'NEW.Admin@Example.com ' })).error).toBeNull();
      const added = await svc.from('admins').select('email, added_by').eq('email', 'new.admin@example.com').single();
      expect(added.data).toEqual({ email: 'new.admin@example.com', added_by: 'admin@example.com' });

      // Remove everyone except admin@example.com
      const others = (await svc.from('admins').select('email')).data!.map((r) => r.email).filter((e) => e !== 'admin@example.com');
      expect((await admin.from('admins').delete().in('email', others)).error).toBeNull();

      // Now the last one cannot go, not even via the service role.
      const self = await admin.from('admins').delete().eq('email', 'admin@example.com');
      expect(self.error?.message).toMatch(/last admin/i);
      expect((await svc.from('admins').delete().eq('email', 'admin@example.com')).error?.message).toMatch(/last admin/i);
      expect((await svc.from('admins').select('email')).data).toHaveLength(1);
    } finally {
      const now = (await svc.from('admins').select('email')).data!.map((r) => r.email);
      const missing = before.filter((e) => !now.includes(e));
      if (missing.length) await svc.from('admins').insert(missing.map((email) => ({ email })));
      await svc.from('admins').delete().eq('email', 'new.admin@example.com');
    }
  });

  it('deleting everyone in one statement is refused', async () => {
    const { error } = await svc.from('admins').delete().neq('email', '');
    expect(error?.message).toMatch(/last admin/i);
    expect(((await svc.from('admins').select('email')).data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('before-user-created hook', () => {
  it('refuses to create an account for an email that is not on the admin list', async () => {
    const res = await fetch(`${LOCAL.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: LOCAL.publishable, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `stranger-${Date.now()}@gmail.com`, password: 'a-long-password-123' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await res.json())).toMatch(/not allowed/i);
  });
});

describe('hard delete', () => {
  it('admin hard delete removes the row and its notes; the audit log keeps no body', async () => {
    const hash = randomBytes(32).toString('hex');
    const { data } = await svc
      .from('suggestions')
      .insert({ body: 'HARD-DELETE-MARKER to be erased', category: 'other', submitter_tag: 'important', admin_tag: 'important', tracking_hash: hash })
      .select('id')
      .single();
    await admin.from('admin_notes').insert({ suggestion_id: data!.id, body: 'note to be cascaded' });
    expect((await admin.rpc('hard_delete_suggestion', { p_id: data!.id })).error).toBeNull();
    expect((await svc.from('suggestions').select('id').eq('id', data!.id)).data).toHaveLength(0);
    expect((await svc.from('admin_notes').select('id').eq('suggestion_id', data!.id)).data).toHaveLength(0);
    const log = await svc.from('audit_log').select('action, before').eq('suggestion_id', data!.id);
    expect(log.data!.map((r) => r.action)).toContain('hard_delete');
    expect(JSON.stringify(log.data)).not.toContain('HARD-DELETE-MARKER');
  });
});

describe('HR eyes only', () => {
  const hrUser = userClient('hr@example.com');
  let hrId = '';
  beforeAll(async () => {
    const { data, error } = await svc
      .from('hr_reports')
      .insert({ full_name: 'RLS Person', contact: 'call me', body: 'RLS HR test: private personal matter.', tracking_hash: randomBytes(32).toString('hex') })
      .select('id')
      .single();
    if (error) throw error;
    hrId = data.id;
  });
  afterAll(async () => {
    await svc.from('hr_reports').delete().eq('id', hrId);
  });

  it('anon, outsiders and ADMINS cannot read HR reports, notes or the HR list', async () => {
    for (const c of [anon, outsider, admin]) {
      for (const t of ['hr_reports', 'hr_notes', 'hr_staff'] as const) {
        const { data } = await c.from(t).select('*').limit(5);
        expect(data ?? [], t).toHaveLength(0);
      }
      const upd = await c.from('hr_reports').update({ status: 'done' }).eq('id', hrId).select('id');
      expect(upd.data ?? []).toHaveLength(0);
    }
    expect((await admin.rpc('is_hr')).data).toBe(false);
    expect((await admin.rpc('hr_hard_delete', { p_id: hrId })).error).not.toBeNull();
    expect((await admin.from('hr_staff').insert({ email: 'admin@example.com' })).error).not.toBeNull();
  });

  it('HR can read and triage HR reports but cannot see anonymous suggestions', async () => {
    expect((await hrUser.rpc('is_hr')).data).toBe(true);
    const { data } = await hrUser.from('hr_reports').select('full_name, body').eq('id', hrId).single();
    expect(data?.full_name).toBe('RLS Person');
    const upd = await hrUser.from('hr_reports').update({ status: 'reviewing', public_reply: 'We will talk soon.' }).eq('id', hrId).select('status').single();
    expect(upd.data?.status).toBe('reviewing');
    expect((await hrUser.from('hr_reports').update({ full_name: 'changed' } as never).eq('id', hrId)).error).not.toBeNull();
    expect((await hrUser.from('suggestions').select('id').limit(5)).data ?? []).toHaveLength(0);
    expect((await hrUser.from('admins').select('email')).data ?? []).toHaveLength(0);
  });

  it('HR notes are authored by the session; audit rows carry no names or text', async () => {
    const note = await hrUser.from('hr_notes').insert({ report_id: hrId, body: 'HR-NOTE-MARKER', author_email: 'x@y.z' }).select('author_email').single();
    expect(note.data?.author_email).toBe('hr@example.com');
    const { data: rows } = await svc.from('audit_log').select('action, before, after').eq('suggestion_id', hrId);
    expect(rows!.map((r) => r.action)).toEqual(expect.arrayContaining(['hr_status_change', 'hr_reply', 'hr_note_added']));
    const raw = JSON.stringify(rows);
    for (const m of ['RLS Person', 'call me', 'private personal matter', 'HR-NOTE-MARKER', 'We will talk soon']) expect(raw).not.toContain(m);
  });

  it('HR sees only HR audit rows; admins still see everything', async () => {
    const hrRows = (await hrUser.from('audit_log').select('action').limit(200)).data ?? [];
    expect(hrRows.length).toBeGreaterThan(0);
    expect(hrRows.every((r) => r.action.startsWith('hr_'))).toBe(true);
    const adminRows = (await admin.from('audit_log').select('action').like('action', 'hr\\_%').limit(5)).data ?? [];
    expect(adminRows.length).toBeGreaterThan(0);
  });

  it('the last HR member cannot be removed; the hook allows HR emails to sign up', async () => {
    const before = (await svc.from('hr_staff').select('email')).data!.map((r) => r.email);
    try {
      const others = before.filter((e) => e !== 'hr@example.com');
      expect((await hrUser.from('hr_staff').delete().in('email', others)).error).toBeNull();
      expect((await hrUser.from('hr_staff').delete().eq('email', 'hr@example.com')).error?.message).toMatch(/last HR/i);
    } finally {
      const now = (await svc.from('hr_staff').select('email')).data!.map((r) => r.email);
      const missing = before.filter((e) => !now.includes(e));
      if (missing.length) await svc.from('hr_staff').insert(missing.map((email) => ({ email })));
    }
    const res = await fetch(`${LOCAL.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: LOCAL.publishable, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'second-hr@example.com', password: 'a-long-password-123' }),
    });
    expect(JSON.stringify(await res.json())).not.toMatch(/not allowed/i);
  });

  it('HR hard delete removes the report', async () => {
    const { data } = await svc
      .from('hr_reports')
      .insert({ full_name: 'Delete Me', body: 'to be removed permanently by HR', tracking_hash: randomBytes(32).toString('hex') })
      .select('id')
      .single();
    expect((await hrUser.rpc('hr_hard_delete', { p_id: data!.id })).error).toBeNull();
    expect((await svc.from('hr_reports').select('id').eq('id', data!.id)).data).toHaveLength(0);
  });
});
