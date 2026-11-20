/** The core assign-and-override flow with the keyboard only. */
import { expect, test } from '@playwright/test';
import { signInAsAdmin, svc } from './helpers';
import { TZ, addTimeOff, cleanupJobs, createJob, crewId, ensureConfirmed, latestOverride, officeDate } from './dispatchHelpers';

test.use({ timezoneId: TZ, viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const DAY = officeDate(31);
let timeOffId = '';
let job: { id: string; job_number: string };

test.beforeAll(async () => {
  await cleanupJobs();
  job = await createJob('Keyboard shuttle', DAY);
  timeOffId = await addTimeOff('Eli Brooks', DAY);
});
test.afterAll(async () => {
  await cleanupJobs();
  await svc.from('time_off').delete().eq('id', timeOffId);
});

test('assign crew by keyboard drag and override the warning by keyboard', async ({ page }) => {
  await ensureConfirmed('dispatcher@example.com');
  await signInAsAdmin(page, 'dispatcher@example.com');
  await page.goto(`/admin/dispatch?date=${DAY}`);
  await expect(page.locator('article.job-col', { hasText: 'Keyboard shuttle' })).toBeVisible();

  // Tab through the roster until the Eli Brooks drag handle has focus.
  const handle = page.getByRole('button', { name: /^Eli Brooks\./ });
  await page.locator('#roster-q').focus();
  for (let i = 0; i < 40 && !(await handle.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(handle).toBeFocused();

  await page.keyboard.press('Space'); // pick up (announcer immediately reports the current zone)
  await expect(page.locator('[aria-live]').filter({ hasText: /Eli Brooks is over the roster/ }).first()).toBeAttached();
  await page.keyboard.press('ArrowRight'); // roster → first job
  await expect(page.locator('[aria-live]').filter({ hasText: new RegExp(`Eli Brooks is over ${job.job_number}`) }).first()).toBeAttached();
  await page.keyboard.press('Space'); // drop

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel(/Reason for overriding/)).toBeFocused();
  await page.keyboard.type('Eli swapped his day off');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  const eli = await crewId('Eli Brooks');
  const { data } = await svc.from('job_assignments').select('crew_member_id').eq('job_id', job.id);
  expect(data!.map((r) => r.crew_member_id)).toContain(eli);
  // The audit write lands after the optimistic UI update, so poll for it.
  await expect
    .poll(async () => (await latestOverride(job.id)).map((o) => (o.after as { reason: string }).reason), { timeout: 10_000 })
    .toContain('Eli swapped his day off');
});
