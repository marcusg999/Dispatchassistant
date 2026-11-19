/**
 * GET /api/status/:hash: status, public reply and last-updated date for ONE
 * non-deleted suggestion. Never returns body, photo, tags, notes or ids.
 */
import type { Config, Context } from '@netlify/functions';
import { trackingHashSchema } from '../../src/shared/validation';
import { db } from '../lib/db';
import { hasValidPortalKey, json, logEvent, notFound } from '../lib/http';

export default async function handler(req: Request, context?: Partial<Context>): Promise<Response> {
  if (!hasValidPortalKey(req)) return notFound();
  if (req.method !== 'GET') return json(405, { ok: false }, { allow: 'GET' });

  const hash = context?.params?.hash ?? new URL(req.url).pathname.split('/').pop() ?? '';
  if (!trackingHashSchema.safeParse(hash).success) return json(400, { ok: false });

  const { data, error } = await db().rpc('portal_status', { p_hash: hash }).maybeSingle();
  if (error) {
    logEvent('status', 'query failed', error.code);
    return json(500, { ok: false });
  }
  if (!data) return json(404, { ok: false });

  // Explicit allow-list of fields, even though the RPC already limits columns.
  return json(200, { status: data.status, public_reply: data.public_reply, updated_at: data.updated_at });
}

export const config: Config = {
  path: '/api/status/:hash',
  method: ['GET'],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
