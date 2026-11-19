/**
 * POST /api/submit: the ONLY write path for anonymous suggestions.
 *
 * Checks, in order: method → portal key → same origin → size → fields (zod) →
 * honeypot / min time (silently "succeed" for bots) → optional Turnstile →
 * photo (magic bytes, size, no EXIF) → insert. Returns only { ok: true }.
 *
 * Never logs or stores: body text, tracking hash, IP address, user-agent.
 *
 * mode=hr: the NAMED "HR eyes only" report. Name required, contact optional, no photo.
 * Goes to the separate hr_reports table that only the HR list can read. The name is
 * never logged.
 */
import type { Config } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { MIN_FORM_MS, PHOTO_MAX_BYTES } from '../../src/shared/domain';
import { hrFieldsSchema, submitFieldsSchema } from '../../src/shared/validation';
import { db, PHOTO_BUCKET } from '../lib/db';
import { hasValidPortalKey, isSameOrigin, json, logEvent, notFound } from '../lib/http';
import { checkPhoto } from '../lib/image';
import { verifyTurnstile } from '../lib/turnstile';

const MAX_REQUEST_BYTES = PHOTO_MAX_BYTES + 64 * 1024;

export default async function handler(req: Request): Promise<Response> {
  if (!hasValidPortalKey(req)) return notFound();
  if (req.method !== 'POST') return json(405, { ok: false }, { allow: 'POST' });
  if (!isSameOrigin(req)) return json(403, { ok: false });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_REQUEST_BYTES) return json(413, { ok: false, error: 'That photo is too large.' });
  if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data'))
    return json(415, { ok: false, error: 'Unsupported request.' });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { ok: false, error: 'Something went wrong. Please try again.' });
  }

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : undefined;
  };
  const parsedRaw = {
    body: str('body'),
    category: str('category'),
    tag: str('tag'),
    tracking_hash: str('tracking_hash'),
    website: str('website') ?? '',
    elapsed_ms: str('elapsed_ms') ?? '0',
  };

  // Bots: a filled honeypot or an inhumanly fast submit gets a fake success and is dropped.
  if (parsedRaw.website !== '' || Number(parsedRaw.elapsed_ms) < MIN_FORM_MS) {
    logEvent('submit', 'dropped', 'bot heuristics');
    return json(200, { ok: true });
  }

  if (str('mode') === 'hr') {
    if (form.get('photo')) return json(400, { ok: false, error: 'Photos can’t be attached to HR reports.' });
    const hr = hrFieldsSchema.safeParse({
      full_name: str('full_name'),
      contact: str('contact') || undefined,
      body: parsedRaw.body,
      tracking_hash: parsedRaw.tracking_hash,
      website: parsedRaw.website,
      elapsed_ms: parsedRaw.elapsed_ms,
    });
    if (!hr.success) return json(400, { ok: false, error: hr.error.issues[0]?.message ?? 'Please check the form.' });
    if (process.env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(str('cf-turnstile-response'), process.env.TURNSTILE_SECRET_KEY);
      if (!ok) return json(400, { ok: false, error: 'Please complete the quick check and try again.' });
    }
    const { error } = await db().from('hr_reports').insert({
      full_name: hr.data.full_name,
      contact: hr.data.contact ? hr.data.contact : null,
      body: hr.data.body,
      tracking_hash: hr.data.tracking_hash,
    });
    if (error) {
      logEvent('submit', 'hr insert failed', error.code);
      return json(error.code === '23505' ? 409 : 500, { ok: false, error: 'Something went wrong. Please try again.' });
    }
    logEvent('submit', 'accepted', 'hr report');
    return json(200, { ok: true });
  }

  const parsed = submitFieldsSchema.safeParse(parsedRaw);
  if (!parsed.success) {
    return json(400, { ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the form.' });
  }
  const fields = parsed.data;

  if (process.env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(str('cf-turnstile-response'), process.env.TURNSTILE_SECRET_KEY);
    if (!ok) return json(400, { ok: false, error: 'Please complete the quick check and try again.' });
  }

  const client = db();
  let photoPath: string | null = null;
  const photo = form.get('photo');
  if (photo && typeof photo !== 'string' && photo.size > 0) {
    const check = await checkPhoto(photo);
    if (!check.ok) return json(check.status, { ok: false, error: check.error });
    photoPath = `${randomUUID()}.${check.kind.ext}`;
    const { error } = await client.storage.from(PHOTO_BUCKET).upload(photoPath, check.bytes, {
      contentType: check.kind.mime,
      upsert: false,
      cacheControl: '0',
    });
    if (error) {
      logEvent('submit', 'photo upload failed', error.message);
      return json(500, { ok: false, error: "Couldn't save the photo. Please try again." });
    }
  }

  const { error } = await client.from('suggestions').insert({
    body: fields.body,
    category: fields.category,
    submitter_tag: fields.tag,
    admin_tag: fields.tag,
    tracking_hash: fields.tracking_hash,
    photo_path: photoPath,
  });

  if (error) {
    if (photoPath) await client.storage.from(PHOTO_BUCKET).remove([photoPath]);
    logEvent('submit', 'insert failed', error.code);
    // 23505 = duplicate tracking hash (a replayed request). Don't reveal anything about existing rows.
    return json(error.code === '23505' ? 409 : 500, { ok: false, error: 'Something went wrong. Please try again.' });
  }

  logEvent('submit', 'accepted', photoPath ? 'with photo' : 'no photo');
  return json(200, { ok: true });
}

export const config: Config = {
  path: '/api/submit',
  method: ['POST'],
  // Platform-level rate limit (Netlify counts per client IP at the edge; the function never sees or stores it).
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
