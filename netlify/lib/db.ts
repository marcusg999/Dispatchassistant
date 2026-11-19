/**
 * Server-only Supabase client (secret / service-role key).
 * Imported ONLY by netlify/functions/*. The build check (scripts/check-dist.mjs)
 * fails if the secret key or this module's markers ever show up in dist/.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/shared/database.types';

export type Db = SupabaseClient<Database>;
export const PHOTO_BUCKET = 'suggestion-photos';

let cached: Db | null = null;

export function db(): Db {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Server misconfigured: SUPABASE_URL / SUPABASE_SECRET_KEY missing');
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}

/** For tests: drop the cached client so env changes take effect. */
export function resetDbForTests() {
  cached = null;
}
