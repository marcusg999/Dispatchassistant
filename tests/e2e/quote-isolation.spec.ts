/**
 * The client quote page and the anonymous portal must stay sessionless even when a staff member is
 * signed in to the console in the same browser: no Authorization header, no cookies, same-origin
 * only, no reads of auth storage, and no code in the quote bundle that could read a session.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { ensureConfirmed } from './dispatchHelpers';
import { SEEDED_QUOTE_TOKEN, TZ } from './estimateHelpers';
import { PORTAL, signInAsAdmin } from './helpers';

test.use({ timezoneId: TZ });

interface Sent {
  url: string;
  auth: string | undefined;
  cookie: string | undefined;
}

async function trackStorage(page: Page) {
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
}

test('quote page and portal never read auth storage or send credentials while an estimator session exists', async ({ page }) => {
  await ensureConfirmed('estimator@example.com');
  await signInAsAdmin(page, 'estimator@example.com');
  await page.goto('/admin/estimates');
  await expect(page.getByRole('heading', { name: 'Estimates', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Q-2026-0005' })).toBeVisible(); // a real, working office session

  await trackStorage(page);
  const sent: Sent[] = [];
  page.on('request', (r) => sent.push({ url: r.url(), auth: r.headers()['authorization'], cookie: r.headers()['cookie'] }));

  for (const [name, path, ready] of [
    ['quote', `/q/${SEEDED_QUOTE_TOKEN}`, () => page.getByRole('heading', { level: 1, name: 'Designer install: two works' })],
    ['portal', PORTAL, () => page.getByLabel(/What should the office know/i)],
  ] as const) {
    sent.length = 0;
    await page.goto(path);
    await expect(ready(), name).toBeVisible({ timeout: 15_000 });
    if (name === 'quote') {
      // The quote API call itself went out, anonymously.
      await expect(page.locator('.q-grand')).toBeVisible();
      expect(sent.some((r) => r.url.includes(`/api/quote/${SEEDED_QUOTE_TOKEN}`)), 'quote API request').toBe(true);
      // Exercise the PDF code path too (lazy chunk): still no credentials.
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
      expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
    }
    const touched = await page.evaluate(() => (window as unknown as { __storage: string[] }).__storage);
    expect(touched.filter((k) => /auth|sb-|token|supabase/i.test(k)), `${name}: storage reads`).toEqual([]);
    expect(sent.length, name).toBeGreaterThan(0);
    for (const r of sent) {
      expect(r.auth, `${name}: ${r.url}`).toBeUndefined();
      expect(r.cookie, `${name}: ${r.url}`).toBeUndefined();
      expect(new URL(r.url).host, `${name}: ${r.url}`).toBe('localhost:8888'); // same-origin only, never Supabase
    }
  }
});

test('quote bundle has no code that could read the console session', () => {
  const dir = 'dist/assets';
  const files = readdirSync(dir).filter((n) => n.startsWith('quote-') && n.endsWith('.js'));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const js = readFileSync(`${dir}/${f}`, 'utf8');
    expect(js, f).not.toMatch(/supabase|auth-token/i);
  }
});
