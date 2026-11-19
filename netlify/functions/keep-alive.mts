/**
 * Daily keep-alive for the Supabase FREE plan, which pauses projects after a
 * period of inactivity. Runs one trivial query. On a paid plan, set
 * KEEP_ALIVE_ENABLED=false in Netlify (or delete this file).
 */
import type { Config } from '@netlify/functions';
import { db } from '../lib/db';
import { logEvent } from '../lib/http';

export default async function handler(): Promise<Response> {
  if (process.env.KEEP_ALIVE_ENABLED === 'false') {
    logEvent('keep-alive', 'disabled');
    return new Response(null, { status: 204 });
  }
  const { error } = await db().rpc('keep_alive');
  logEvent('keep-alive', error ? 'failed' : 'ok', error?.code);
  return new Response(null, { status: error ? 500 : 204 });
}

export const config: Config = { schedule: '@daily' };
