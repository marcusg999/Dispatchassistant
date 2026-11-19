/**
 * Email + password sign-in and recovery, end to end. Emails are read from the local
 * Supabase mail catcher (Mailpit, http://127.0.0.1:54324).
 */
import { expect, test, type Page } from '@playwright/test';
import { svc } from './helpers';

const MAIL = process.env.MAILPIT_URL || 'http://127.0.0.1:54324';
const EMAIL = 'pw.admin@example.com';
const PASSWORD = 'first-password-1234';
const NEW_PASSWORD = 'second-password-5678';

async function deleteAuthUser(email: string) {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const u = data.users.find((x) => x.email === email);
  if (u) await svc.auth.admin.deleteUser(u.id);
}

async function latestLink(to: string, type: 'signup' | 'recovery'): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    for (const m of messages ?? []) {
      const msg = (await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()) as { HTML: string; Text: string };
      const match = (msg.HTML + msg.Text).replaceAll('&amp;', '&').match(/https?:\/\/[^\s"<>]+token_hash=[^\s"<>&]+&type=(\w+)/);
      if (match && match[1] === type) return match[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${type} email for ${to}`);
}

async function signIn(page: Page, password: string) {
  await page.goto('/admin');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.beforeAll(async () => {
  await deleteAuthUser(EMAIL);
  await svc.from('admins').upsert({ email: EMAIL });
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
});

test.afterAll(async () => {
  await deleteAuthUser(EMAIL);
  await svc.from('admins').delete().eq('email', EMAIL);
});

test('an allow-listed admin creates a password, confirms by email, and signs in', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: /First time\? Create your password/ }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('New password').fill('short1');
  await page.getByLabel('Repeat password').fill('short1');
  await page.getByRole('button', { name: 'Create password' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 12 characters');

  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create password' }).click();
  await expect(page.getByRole('status')).toContainText('confirmation link is on its way');

  // Password doesn't work until the email is confirmed.
  await signIn(page, PASSWORD);
  await expect(page.getByRole('alert')).toContainText(/Confirm your email/);

  await page.goto(await latestLink(EMAIL, 'signup'));
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  expect(page.url()).not.toContain('token_hash'); // one-time token removed from the address bar

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible(); // sign-out finished
  await signIn(page, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
});

test('forgot password: reset link sets a new password; the old one stops working', async ({ page }) => {
  // Independent of the previous test: start from a confirmed account with PASSWORD.
  await deleteAuthUser(EMAIL);
  await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('reset link is on its way');

  // Open the link in a brand-new browser context (as if tapped on a phone).
  const other = await page.context().browser()!.newContext();
  const p2 = await other.newPage();
  await p2.goto(await latestLink(EMAIL, 'recovery'));
  await expect(p2.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await p2.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await p2.getByLabel('Repeat password').fill(NEW_PASSWORD);
  await p2.getByRole('button', { name: 'Save new password' }).click();
  await expect(p2.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await other.close();

  await signIn(page, PASSWORD);
  await expect(page.getByRole('alert')).toContainText('don’t match');
  await signIn(page, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

  // Account page offers a password change and explains recovery.
  await page.goto('/admin/account');
  await expect(page.getByRole('heading', { name: 'If you lose access' })).toBeVisible();
});

test('emails not on any list get the same generic answer and no account', async ({ page }) => {
  const stranger = `stranger-${Date.now()}@example.com`;
  await page.goto('/admin');
  await page.getByRole('button', { name: /First time\? Create your password/ }).click();
  await page.getByLabel('Email').fill(stranger);
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create password' }).click();
  await expect(page.getByRole('status')).toContainText('If that email is on the admin or HR list');
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  expect(data.users.some((u) => u.email === stranger)).toBe(false);
});

test('a used or bogus reset link shows a clear error', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=not-a-real-token&type=recovery');
  await expect(page.getByRole('heading', { name: 'This link didn’t work' })).toBeVisible();
});
