/**
 * Small HTTP helpers shared by the portal functions.
 * Privacy rule: never log request bodies, tracking hashes/codes, IPs or user agents.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function json(status: number, data: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...extra } });
}

/** Indistinguishable from a path that doesn't exist. */
export const notFound = () => json(404, { ok: false });

function digest(s: string) {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Constant-time check of the x-portal-key header against PORTAL_KEY. */
export function hasValidPortalKey(req: Request): boolean {
  const expected = process.env.PORTAL_KEY;
  const given = req.headers.get('x-portal-key');
  if (!expected || expected.length < 16 || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Same-origin only. Browsers always send Origin on cross-site POSTs and fetches,
 * so a mismatch means another site is trying to use the API. There is no CORS
 * header anywhere, so cross-origin reads are blocked by the browser too.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin GETs and non-browser clients (still need the portal key)
  try {
    const o = new URL(origin);
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
    return o.host === host;
  } catch {
    return false;
  }
}

/** Log an operational event WITHOUT any submission content. */
export function logEvent(fn: string, event: string, detail?: string) {
  console.log(`[${fn}] ${event}${detail ? `: ${detail}` : ''}`);
}
