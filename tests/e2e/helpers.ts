import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/shared/database.types';
import { LOCAL } from '../helpers/local';

export const PORTAL = `/s/${LOCAL.portalKey}`;
export const svc = createClient<Database>(LOCAL.url, LOCAL.secret, { auth: { persistSession: false } });

/** Seeded test session: real local Supabase user, injected into sessionStorage (no Google needed). */
export async function signInAsAdmin(page: Page, email = 'admin@example.com') {
  const password = 'e2e-only-password-123';
  const created = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error && !/already/i.test(created.error.message)) throw created.error;
  if (created.error) {
    const { data } = await svc.auth.admin.listUsers();
    const u = data.users.find((x) => x.email === email)!;
    await svc.auth.admin.updateUserById(u.id, { password });
  }
  const client = createClient(LOCAL.url, LOCAL.publishable, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const storageKey = `sb-${new URL(LOCAL.url).hostname.split('.')[0]}-auth-token`;
  await page.addInitScript(
    ([k, v]) => window.sessionStorage.setItem(k, v),
    [storageKey, JSON.stringify(data.session)] as const,
  );
}

export async function fillSuggestion(page: Page, body: string, category = 'Safety', tag = /Urgent/) {
  await page.getByLabel(/What should the office know/i).fill(body);
  await page.getByRole('radio', { name: category }).check();
  await page.getByRole('radio', { name: tag }).check();
}

export async function readTrackingCode(page: Page): Promise<string> {
  const label = await page.locator('#code-text').getAttribute('aria-label');
  return label!.split(' ').join('-');
}
