/**
 * Admin console Supabase client: publishable key + the signed-in admin's session,
 * so Row-Level Security applies to every query. No secret key ever reaches the browser.
 *
 * Sessions are kept in sessionStorage (not localStorage): closing the browser
 * signs the admin out, which limits the damage of a lost or stolen laptop.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../shared/database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configured = Boolean(url && key);

export const supabase = createClient<Database>(url || 'http://localhost:54321', key || 'missing', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
  },
});
