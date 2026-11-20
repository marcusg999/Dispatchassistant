/**
 * POST /api/incident-photo: attach one photo to a NAMED incident report.
 *
 * - Requires the signed-in user's access token (Authorization: Bearer …).
 * - Permission is checked AS THE USER via can_attach_incident_photo (reporter who
 *   filed it, or an admin/dispatcher), so RLS/role rules stay in the database.
 * - The browser already re-encoded the photo (EXIF/GPS stripped); here we re-check
 *   magic bytes, size and absence of metadata, then upload with the service key.
 * - Never logs tokens, descriptions or file contents.
 */
import type { Config } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PHOTO_MAX_BYTES } from '../../src/shared/domain';
import { db } from '../lib/db';
import { isSameOrigin, json, logEvent } from '../lib/http';
import { checkPhoto } from '../lib/image';

const BUCKET = 'incident-photos';
const MAX_PHOTOS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { ok: false }, { allow: 'POST' });
  if (!isSameOrigin(req)) return json(403, { ok: false });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { ok: false, error: 'Please sign in again.' });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > PHOTO_MAX_BYTES + 64 * 1024) return json(413, { ok: false, error: 'That photo is too large.' });

  const service = db();
  const { data: userData, error: userErr } = await service.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { ok: false, error: 'Please sign in again.' });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { ok: false, error: 'Something went wrong. Please try again.' });
  }
  const incidentId = form.get('incident_id');
  const photo = form.get('photo');
  if (typeof incidentId !== 'string' || !UUID.test(incidentId)) return json(400, { ok: false, error: 'Unknown incident.' });
  if (!photo || typeof photo === 'string') return json(400, { ok: false, error: 'No photo attached.' });

  // Permission check as the user (not the service role).
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = process.env.SUPABASE_URL;
  if (!publishable || !url) return json(500, { ok: false, error: 'Server misconfigured.' });
  const asUser = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: allowed, error: permErr } = await asUser.rpc('can_attach_incident_photo', { p_incident: incidentId });
  if (permErr || allowed !== true) return json(403, { ok: false, error: 'You can’t add photos to this report.' });

  const { count } = await service.from('incident_photos').select('id', { count: 'exact', head: true }).eq('incident_id', incidentId);
  if ((count ?? 0) >= MAX_PHOTOS) return json(400, { ok: false, error: `Up to ${MAX_PHOTOS} photos per report.` });

  const check = await checkPhoto(photo);
  if (!check.ok) return json(check.status, { ok: false, error: check.error });

  const path = `${incidentId}/${randomUUID()}.${check.kind.ext}`;
  const up = await service.storage.from(BUCKET).upload(path, check.bytes, { contentType: check.kind.mime, upsert: false, cacheControl: '0' });
  if (up.error) {
    logEvent('incident-photo', 'upload failed', up.error.message);
    return json(500, { ok: false, error: 'Couldn’t save the photo. Please try again.' });
  }
  const ins = await service.from('incident_photos').insert({ incident_id: incidentId, path });
  if (ins.error) {
    await service.storage.from(BUCKET).remove([path]);
    logEvent('incident-photo', 'insert failed', ins.error.code);
    return json(500, { ok: false, error: 'Couldn’t save the photo. Please try again.' });
  }
  logEvent('incident-photo', 'accepted');
  return json(200, { ok: true });
}

export const config: Config = {
  path: '/api/incident-photo',
  method: ['POST'],
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
