/** Two dispatchers on the same day board: one assigns, the other sees it live. */
import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers';
import { TZ, cleanupJobs, createJob, crewId, ensureConfirmed, officeDate } from './dispatchHelpers';

test.use({ timezoneId: TZ, viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const DAY = officeDate(32);
let job: { id: string; job_number: string };

test.beforeAll(async () => {
  await cleanupJobs();
  job = await createJob('Realtime pickup', DAY);
});
test.afterAll(cleanupJobs);

test('an assignment in one browser appears in the other without reloading', async ({ browser }) => {
  const ctxA = await browser.newContext({ timezoneId: TZ, viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ timezoneId: TZ, viewport: { width: 1440, height: 900 } });
  await ensureConfirmed('dispatcher@example.com');
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await signInAsAdmin(a, 'dispatcher@example.com');
  await signInAsAdmin(b, 'dispatcher@example.com');
  await a.goto(`/admin/dispatch?date=${DAY}`);
  await b.goto(`/admin/dispatch?date=${DAY}`);
  const colB = b.locator('article.job-col', { hasText: 'Realtime pickup' });
  await expect(colB).toBeVisible();
  await expect(colB.getByRole('button', { name: 'Unassign Casey Ortiz' })).toHaveCount(0);
  await b.waitForTimeout(1500); // let the realtime channel finish subscribing

  const casey = await crewId('Casey Ortiz');
  await a.locator(`#assign-crew-${casey}`).selectOption(job.id);
  await expect(a.locator('article.job-col', { hasText: 'Realtime pickup' }).getByRole('button', { name: 'Unassign Casey Ortiz' })).toBeVisible();

  // B never reloads: the chip arrives over Supabase Realtime.
  await expect(colB.getByRole('button', { name: 'Unassign Casey Ortiz' })).toBeVisible({ timeout: 15_000 });
  await ctxA.close();
  await ctxB.close();
});
