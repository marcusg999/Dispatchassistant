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
