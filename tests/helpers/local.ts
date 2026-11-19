/**
 * Helpers for tests that run against the local Supabase stack (`supabase start`).
 * All keys come from .env (local stack values only, never production secrets).
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/shared/database.types';

/** Read from .env (see README → Local development); values come from `npx supabase status -o env`. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Copy the local values from \`npx supabase status -o env\` into .env.`);
  return v;
}

export const LOCAL = {
  url: process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  secret: required('SUPABASE_SECRET_KEY'),
  publishable: required('VITE_SUPABASE_PUBLISHABLE_KEY'),
  jwtSecret: required('SUPABASE_JWT_SECRET'),
  portalKey: process.env.PORTAL_KEY || 'local-dev-portal-key-1234',
};

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export const serviceClient = () => createClient<Database>(LOCAL.url, LOCAL.secret, noSession);
export const anonClient = () => createClient<Database>(LOCAL.url, LOCAL.publishable, noSession);

/** HS256 JWT for an `authenticated` user with the given email (local stack only). */
export function signJwt(email: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    sub: randomUUID(),
    role: 'authenticated',
    aud: 'authenticated',
    email,
    iat: now,
    exp: now + 3600,
  });
  const sig = createHmac('sha256', LOCAL.jwtSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** supabase-js client acting as a signed-in user (RLS applies). */
export function userClient(email: string) {
  const token = signJwt(email);
  return createClient<Database>(LOCAL.url, LOCAL.publishable, { ...noSession, accessToken: async () => token });
}

export async function stackIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${LOCAL.url}/rest/v1/`, { headers: { apikey: LOCAL.publishable } });
    return r.status < 500;
  } catch {
    return false;
  }
}

export const sha256hex = async (s: string) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Buffer.from(d).toString('hex');
};
