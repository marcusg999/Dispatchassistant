/**
 * GET /api/board: the public "You said, we did" board.
 * Returns ONLY the admin-written summary, category, status and a date.
 * Never the original body, photo, tags, notes, ids or tracking hashes.
 */
import type { Config } from '@netlify/functions';
import { db } from '../lib/db';
import { hasValidPortalKey, json, logEvent, notFound } from '../lib/http';

export default async function handler(req: Request): Promise<Response> {
  if (!hasValidPortalKey(req)) return notFound();
  if (req.method !== 'GET') return json(405, { ok: false }, { allow: 'GET' });

  const { data, error } = await db().rpc('portal_board', { p_limit: 100 });
  if (error) {
    logEvent('board', 'query failed', error.code);
    return json(500, { ok: false });
  }
  const items = (data ?? []).map((r) => ({
    board_summary: r.board_summary,
    category: r.category,
    status: r.status,
    date: r.date,
  }));
  return json(200, { items }, { 'cache-control': 'private, max-age=60' });
}

export const config: Config = {
  path: '/api/board',
  method: ['GET'],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
