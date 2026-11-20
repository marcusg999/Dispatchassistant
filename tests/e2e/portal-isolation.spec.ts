/**
 * The anonymous portal must stay sessionless even when a crew member (or anyone)
 * is signed in to the console in the same browser on the same phone.
 */
import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { PORTAL, signInAsAdmin, svc } from './helpers';

test.afterAll(async () => {
  await svc.from('suggestions').delete().like('body', 'E2E-ISOLATION:%');
});

test('portal never reads auth storage or sends Authorization while a crew session exists', async ({ page }) => {
  // A real crew session in this browser: sign in and load My jobs once.
  await signInAsAdmin(page, 'crew@example.com');
  await page.goto('/admin/my-jobs');
  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible();

  // Record every storage access and every request the portal makes.
  await page.addInitScript(() => {
    const touched: string[] = [];
    (window as unknown as { __storage: string[] }).__storage = touched;
    for (const area of ['localStorage', 'sessionStorage'] as const) {
      const s = window[area];
      const get = s.getItem.bind(s);
      s.getItem = (k: string) => {
        touched.push(`${area}:${k}`);
        return get(k);
      };
    }
  });
  const sent: { url: string; auth: string | undefined; cookie: string | undefined }[] = [];
  page.on('request', (r) => sent.push({ url: r.url(), auth: r.headers()['authorization'], cookie: r.headers()['cookie'] }));

  await page.goto(PORTAL);
  await page.getByLabel(/What should the office know/i).fill('E2E-ISOLATION: portal check with a crew session present.');
  await page.getByRole('radio', { name: 'Safety' }).check();
  await page.getByRole('radio', { name: /Important/ }).check();
  await page.getByRole('button', { name: /Send to the office/i }).click();
  await expect(page.getByRole('heading', { name: /Sent\. Thank you/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: /You said, we did/ }).click();
  await expect(page.getByRole('heading', { name: 'You said, we did.' })).toBeVisible();

  const touched = await page.evaluate(() => (window as unknown as { __storage: string[] }).__storage);
  expect(touched.filter((k) => /auth|sb-|token|supabase/i.test(k))).toEqual([]);
  expect(sent.length).toBeGreaterThan(0);
  for (const r of sent) {
    expect(r.auth, r.url).toBeUndefined();
    expect(new URL(r.url).host, r.url).toBe('localhost:8888'); // same-origin only, never Supabase
  }

  // The stored row has no link to the signed-in crew member.
  const { data } = await svc.from('suggestions').select('*').like('body', 'E2E-ISOLATION:%').single();
  expect(JSON.stringify(data)).not.toContain('crew@example.com');
});

test('portal bundle has no code that could read the console session', () => {
  const dir = 'dist/assets';
  for (const f of readdirSync(dir).filter((n) => n.startsWith('portal-') && n.endsWith('.js'))) {
    const js = readFileSync(`${dir}/${f}`, 'utf8');
    expect(js, f).not.toMatch(/auth-token|supabase|authorization/i);
  }
});
