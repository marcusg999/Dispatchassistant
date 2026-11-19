/**
 * The three portal functions against the local Supabase stack (`supabase start`).
 * Covers valid / invalid / missing-key / honeypot cases and the response shapes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import submit from '../../netlify/functions/submit.mts';
import status from '../../netlify/functions/status.mts';
import board from '../../netlify/functions/board.mts';
import { LOCAL, serviceClient, stackIsUp } from '../helpers/local';

process.env.PORTAL_KEY = LOCAL.portalKey;
process.env.SUPABASE_URL = LOCAL.url;
process.env.SUPABASE_SECRET_KEY = LOCAL.secret;
delete process.env.TURNSTILE_SECRET_KEY;

const ORIGIN = 'http://localhost:8888';
const svc = serviceClient();
const created: string[] = [];
const randomHash = () => randomBytes(32).toString('hex');

function form(over: Record<string, string | Blob | undefined> = {}) {
  const f = new FormData();
  const base: Record<string, string | Blob | undefined> = {
    body: 'Integration test: the dock door sensor keeps failing.',
    category: 'trucks_equipment',
    tag: 'urgent',
    tracking_hash: randomHash(),
    website: '',
    elapsed_ms: '6000',
    ...over,
  };
  for (const [k, v] of Object.entries(base)) if (v !== undefined) f.set(k, v as string | Blob);
  return { f, hash: base.tracking_hash as string };
}

const post = (f: FormData, key: string | null = LOCAL.portalKey, extra: Record<string, string> = {}) =>
  submit(
    new Request(`${ORIGIN}/api/submit`, {
      method: 'POST',
      headers: { ...(key ? { 'x-portal-key': key } : {}), origin: ORIGIN, host: 'localhost:8888', ...extra },
      body: f,
    }),
  );

beforeAll(async () => {
  if (!(await stackIsUp())) throw new Error('Local Supabase is not running. Start it with `npx supabase start`.');
});

afterAll(async () => {
  if (created.length) {
    const { data } = await svc.from('suggestions').select('photo_path').in('tracking_hash', created);
    const photos = (data ?? []).map((r) => r.photo_path).filter(Boolean) as string[];
    if (photos.length) await svc.storage.from('suggestion-photos').remove(photos);
    await svc.from('suggestions').delete().in('tracking_hash', created);
  }
});

describe('POST /api/submit', () => {
  it('accepts a valid submission and returns only { ok: true }', async () => {
    const { f, hash } = form();
    created.push(hash);
    const res = await post(f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { data } = await svc.from('suggestions').select('*').eq('tracking_hash', hash).single();
    expect(data).toMatchObject({ category: 'trucks_equipment', submitter_tag: 'urgent', admin_tag: 'urgent', status: 'new', photo_path: null });
  });

  it('accepts the "I’m just sayin’" and "Casual" tags, and they sort below Important', async () => {
    const a = form({ tag: 'just_sayin' });
    const b = form({ tag: 'casual' });
    const c = form({ tag: 'important' });
    created.push(a.hash, b.hash, c.hash);
    for (const x of [a, b, c]) expect((await post(x.f)).status).toBe(200);
    const { data } = await svc
      .from('suggestions')
      .select('submitter_tag')
      .in('tracking_hash', [a.hash, b.hash, c.hash])
      .order('admin_tag', { ascending: false });
    expect(data!.map((r) => r.submitter_tag)).toEqual(['important', 'casual', 'just_sayin']);
  });

  it('stores no identity columns', async () => {
    const { data } = await svc.from('suggestions').select('*').limit(1).single();
    const cols = Object.keys(data!);
    for (const bad of ['ip', 'ip_address', 'user_agent', 'email', 'name', 'phone', 'user_id', 'employee_id'])
      expect(cols).not.toContain(bad);
  });

  it('accepts a clean WebP photo and stores it in the private bucket', async () => {
    const { f, hash } = form({ photo: new Blob([readFileSync('tests/fixtures/clean.webp')], { type: 'image/webp' }) });
    created.push(hash);
    const res = await post(f);
    expect(res.status).toBe(200);
    const { data } = await svc.from('suggestions').select('photo_path').eq('tracking_hash', hash).single();
    expect(data?.photo_path).toMatch(/^[0-9a-f-]{36}\.webp$/);
    const dl = await svc.storage.from('suggestion-photos').download(data!.photo_path!);
    expect(dl.error).toBeNull();
  });

  it('rejects a photo that still has EXIF/GPS (and stores nothing)', async () => {
    const { f, hash } = form({ photo: new Blob([readFileSync('tests/fixtures/gps.jpg')], { type: 'image/jpeg' }) });
    const res = await post(f);
    expect(res.status).toBe(422);
    const { data } = await svc.from('suggestions').select('id').eq('tracking_hash', hash);
    expect(data).toHaveLength(0);
  });

  it('rejects a non-image disguised as a photo', async () => {
    const { f } = form({ photo: new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }) });
    expect((await post(f)).status).toBe(415);
  });

  it('returns 404 without the portal key, or with a wrong one', async () => {
    expect((await post(form().f, null)).status).toBe(404);
    expect((await post(form().f, 'wrong-key-wrong-key')).status).toBe(404);
  });

  it('rejects cross-origin requests', async () => {
    expect((await post(form().f, LOCAL.portalKey, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('validates fields', async () => {
    expect((await post(form({ body: 'short' }).f)).status).toBe(400);
    expect((await post(form({ category: 'hr' }).f)).status).toBe(400);
    expect((await post(form({ tag: undefined }).f)).status).toBe(400);
    expect((await post(form({ tracking_hash: 'CEDAR-HARBOR-7342' }).f)).status).toBe(400);
    expect((await post(form({ body: 'x'.repeat(4001) }).f)).status).toBe(400);
  });

  it('drops honeypot and too-fast submissions with a fake success', async () => {
    const hp = form({ website: 'http://spam.example' });
    const fast = form({ elapsed_ms: '400' });
    expect(await (await post(hp.f)).json()).toEqual({ ok: true });
    expect(await (await post(fast.f)).json()).toEqual({ ok: true });
    const { data } = await svc.from('suggestions').select('id').in('tracking_hash', [hp.hash, fast.hash]);
    expect(data).toHaveLength(0);
  });

  it('refuses a replayed tracking hash without revealing anything', async () => {
    const first = form();
    created.push(first.hash);
    await post(first.f);
    const res = await post(form({ tracking_hash: first.hash }).f);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain(first.hash);
  });

  it('never logs the body or the tracking hash', async () => {
    const lines: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log = console.error = console.warn = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      const { f, hash } = form({ body: 'SECRET-BODY-MARKER please fix the ramp' });
      created.push(hash);
      await post(f);
      await post(form({ tracking_hash: hash }).f); // also the error path
      expect(lines.join('\n')).not.toContain('SECRET-BODY-MARKER');
      expect(lines.join('\n')).not.toContain(hash);
    } finally {
      Object.assign(console, orig);
    }
  });
});

describe('POST /api/submit (mode=hr, named)', () => {
  const hrForm = (over: Record<string, string | Blob | undefined> = {}) => {
    const f = new FormData();
    const base: Record<string, string | Blob | undefined> = {
      mode: 'hr',
      full_name: 'Sam Rivera',
      contact: 'sam@example.com',
      body: 'HR-BODY-MARKER: I need to talk about a scheduling conflict.',
      tracking_hash: randomHash(),
      website: '',
      elapsed_ms: '6000',
      ...over,
    };
    for (const [k, v] of Object.entries(base)) if (v !== undefined) f.set(k, v as string | Blob);
    return { f, hash: base.tracking_hash as string };
  };
  const hrCreated: string[] = [];
  afterAll(async () => {
    if (hrCreated.length) await svc.from('hr_reports').delete().in('tracking_hash', hrCreated);
  });

  it('stores a named report in hr_reports (not in suggestions) and returns only { ok: true }', async () => {
    const { f, hash } = hrForm();
    hrCreated.push(hash);
    const res = await post(f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { data } = await svc.from('hr_reports').select('full_name, contact, status').eq('tracking_hash', hash).single();
    expect(data).toEqual({ full_name: 'Sam Rivera', contact: 'sam@example.com', status: 'new' });
    expect((await svc.from('suggestions').select('id').eq('tracking_hash', hash)).data).toHaveLength(0);
  });

  it('requires a name, allows no contact, refuses photos', async () => {
    expect((await post(hrForm({ full_name: undefined }).f)).status).toBe(400);
    expect((await post(hrForm({ full_name: ' ' }).f)).status).toBe(400);
    const noContact = hrForm({ contact: undefined });
    hrCreated.push(noContact.hash);
    expect((await post(noContact.f)).status).toBe(200);
    const withPhoto = hrForm({ photo: new Blob([readFileSync('tests/fixtures/clean.webp')], { type: 'image/webp' }) });
    expect((await post(withPhoto.f)).status).toBe(400);
  });

  it('status lookup works for HR reports and returns only the three fields', async () => {
    const { f, hash } = hrForm();
    hrCreated.push(hash);
    await post(f);
    await svc.from('hr_reports').update({ status: 'reviewing', public_reply: 'HR will call you Tuesday.' }).eq('tracking_hash', hash);
    const res = await status(new Request(`${ORIGIN}/api/status/${hash}`, { headers: { 'x-portal-key': LOCAL.portalKey } }), { params: { hash } });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['public_reply', 'status', 'updated_at']);
    expect(body).toMatchObject({ status: 'reviewing', public_reply: 'HR will call you Tuesday.' });
    expect(JSON.stringify(body)).not.toContain('Sam Rivera');
  });

  it('never logs the name, contact or body', async () => {
    const lines: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log = console.error = console.warn = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      const { f, hash } = hrForm({ full_name: 'NAME-MARKER Person', contact: 'CONTACT-MARKER' });
      hrCreated.push(hash);
      await post(f);
      await post(hrForm({ tracking_hash: hash }).f);
      const all = lines.join('\n');
      for (const m of ['NAME-MARKER', 'CONTACT-MARKER', 'HR-BODY-MARKER', hash]) expect(all).not.toContain(m);
    } finally {
      Object.assign(console, orig);
    }
  });
});

describe('GET /api/status/:hash', () => {
  const get = (hash: string, key: string | null = LOCAL.portalKey) =>
    status(new Request(`${ORIGIN}/api/status/${hash}`, { headers: key ? { 'x-portal-key': key } : {} }), { params: { hash } });

  it('returns only status, public reply and updated date', async () => {
    const { f, hash } = form();
    created.push(hash);
    await post(f);
    await svc.from('suggestions').update({ status: 'planned', public_reply: 'On it.' }).eq('tracking_hash', hash);
    const res = await get(hash);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['public_reply', 'status', 'updated_at']);
    expect(body).toMatchObject({ status: 'planned', public_reply: 'On it.' });
  });

  it('404s for unknown and soft-deleted suggestions', async () => {
    expect((await get(randomHash())).status).toBe(404);
    const { f, hash } = form();
    created.push(hash);
    await post(f);
    await svc.from('suggestions').update({ deleted_at: new Date().toISOString() }).eq('tracking_hash', hash);
    expect((await get(hash)).status).toBe(404);
  });

  it('rejects missing key and malformed hashes', async () => {
    expect((await get(randomHash(), null)).status).toBe(404);
    expect((await get('not-a-hash')).status).toBe(400);
  });
});

describe('GET /api/board', () => {
  const get = (key: string | null = LOCAL.portalKey) =>
    board(new Request(`${ORIGIN}/api/board`, { headers: key ? { 'x-portal-key': key } : {} }));

  it('returns only summary, category, status and date for published items', async () => {
    const { f, hash } = form({ body: 'BOARD-BODY-MARKER: the lockers are too small.' });
    created.push(hash);
    await post(f);
    await svc
      .from('suggestions')
      .update({ published_to_board: true, board_summary: 'Bigger lockers ordered.', status: 'planned' })
      .eq('tracking_hash', hash);
    const res = await get();
    expect(res.status).toBe(200);
    const { items } = await res.json();
    const mine = items.find((i: { board_summary: string }) => i.board_summary === 'Bigger lockers ordered.');
    expect(mine).toBeTruthy();
    for (const it of items) expect(Object.keys(it).sort()).toEqual(['board_summary', 'category', 'date', 'status']);
    const raw = JSON.stringify(items);
    expect(raw).not.toContain('BOARD-BODY-MARKER');
    expect(raw).not.toMatch(/photo|tag|tracking|body"/);
  });

  it('rejects requests without the key', async () => {
    expect((await get(null)).status).toBe(404);
  });
});
