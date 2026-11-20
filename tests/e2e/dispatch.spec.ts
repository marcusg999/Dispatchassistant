/** A dispatcher builds a day: editor → board drag and drop → warning override → print/export. */
import { expect, test } from '@playwright/test';
import { signInAsAdmin, svc } from './helpers';
import { PREFIX, TZ, addTimeOff, cleanupJobs, dragOnto, ensureConfirmed, latestOverride, officeDate } from './dispatchHelpers';

test.use({ timezoneId: TZ, viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const DAY = officeDate(30);
let timeOffId = '';

test.beforeAll(async () => {
  await cleanupJobs();
  timeOffId = await addTimeOff('Harper Quinn', DAY); // makes the drag create a NEW warning
});
test.afterAll(async () => {
  await cleanupJobs();
  await svc.from('time_off').delete().eq('id', timeOffId);
});

test('dispatcher creates a job, drags crew and a truck on, overrides a warning, prints and exports', async ({ page }) => {
  await ensureConfirmed('dispatcher@example.com');
  await signInAsAdmin(page, 'dispatcher@example.com');

  // 1. Create the job in the editor.
  await page.goto(`/admin/dispatch/jobs/new?date=${DAY}`);
  await page.getByLabel('Title', { exact: true }).fill(`${PREFIX} Hang a diptych`);
  await page.getByLabel('Job type').selectOption('install');
  await page.getByLabel('Start', { exact: true }).fill(`${DAY}T09:00`);
  await page.getByLabel('End', { exact: true }).fill(`${DAY}T12:00`);
  // New jobs start with an origin and a destination stop.
  await page.locator('#s0-addr').fill('1200 Example Ave, Los Angeles, CA');
  await page.locator('#s1-addr').fill('77 Example Way, Los Angeles, CA');
  await page.locator('#s1-cphone').fill('(323) 555-0100');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.locator('#i0-desc').fill('Large diptych panel');
  await page.locator('#i0-height_in').fill('60');
  await page.locator('#i0-width_in').fill('48');
  await page.locator('#i0-depth_in').fill('3');
  await page.locator('#i0-weight_lbs').fill('55');
  await page.locator('label.flag-toggle', { hasText: 'Two-person minimum' }).click();
  await page.getByRole('button', { name: 'Create job' }).click();
  await expect(page).toHaveURL(/\/admin\/dispatch\/jobs\/[0-9a-f-]{36}$/);
  const jobId = page.url().split('/').pop()!;

  const { data: job } = await svc.from('jobs').select('job_number, job_stops(contact_phone, position), job_items(handling_flags, height_in)').eq('id', jobId).single();
  expect(job!.job_stops.find((st) => st.position === 1)!.contact_phone).toBe('+13235550100');
  expect(job!.job_items[0]).toMatchObject({ handling_flags: ['two_person'], height_in: 60 });

  // 2. Day board: drag a crew member (unavailable that day) onto the job.
  await page.goto(`/admin/dispatch?date=${DAY}`);
  const column = page.locator('article.job-col', { hasText: `${PREFIX} Hang a diptych` });
  await expect(column).toBeVisible();
  const harper = page.locator('.roster-handle', { hasText: 'Harper Quinn' });
  await dragOnto(page, harper, column);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Crew unavailable');
  await dialog.getByLabel(/Reason for overriding/).fill('Client moved the date; Harper confirmed by phone');
  await dialog.getByRole('button', { name: 'Keep it, record reason' }).click();
  await expect(dialog).toBeHidden();
  await expect(column.getByRole('button', { name: 'Unassign Harper Quinn' })).toBeVisible();

  // 3. Drag a truck on: no driver on the job → another new warning.
  await page.getByRole('tab', { name: 'Trucks & equipment' }).click();
  const truck = page.locator('.roster-handle', { hasText: 'Truck 20' });
  await dragOnto(page, truck, column);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/no driver/i);
  await dialog.getByLabel(/Reason for overriding/).fill('Driver joins from the shop');
  await dialog.getByRole('button', { name: 'Keep it, record reason' }).click();
  await expect(column.getByRole('button', { name: 'Unassign Truck 20' })).toBeVisible();

  // The audit write finishes after the optimistic UI update, so poll for it.
  await expect
    .poll(async () => (await latestOverride(jobId)).map((o) => (o.after as { reason: string }).reason), { timeout: 10_000 })
    .toEqual(expect.arrayContaining(['Client moved the date; Harper confirmed by phone', 'Driver joins from the shop']));
  const overrides = await latestOverride(jobId);
  expect(overrides[0].actor_email).toBe('dispatcher@example.com');

  // 4. Print sheet for this job + Word export.
  await column.getByRole('link', { name: 'Print', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/dispatch/print/${jobId}$`));
  const main = page.locator('main');
  for (const text of [job!.job_number, 'Harper Quinn', 'Truck 20', 'Large diptych panel', 'Two-person minimum']) {
    await expect(main).toContainText(text);
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word (.docx)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^dispatch_.+\.docx$/);
});

test('viewer sees the board read-only', async ({ page }) => {
  const { data } = await svc
    .from('jobs')
    .insert({ title: `${PREFIX} Viewer check`, job_type: 'pickup', status: 'scheduled', start_at: `${DAY}T17:00:00Z`, end_at: `${DAY}T19:00:00Z` })
    .select('id')
    .single();
  expect(data).toBeTruthy();
  await ensureConfirmed('viewer@example.com');
  await signInAsAdmin(page, 'viewer@example.com');
  await page.goto(`/admin/dispatch?date=${DAY}`);
  await expect(page.getByText(`${PREFIX} Viewer check`)).toBeVisible();
  await expect(page.getByText('Read-only access')).toBeVisible();
  await expect(page.getByRole('link', { name: '+ New job' })).toHaveCount(0);
  await expect(page.locator('select.roster-assign')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Unassign / })).toHaveCount(0);
});
