/** Crew on a phone: lands on My jobs, sees only their jobs, ticks as team lead, files a named incident. */
import { expect, test } from '@playwright/test';
import { hasMetadata, sniffImage } from '../../netlify/lib/image';
import { signInAsAdmin, svc } from './helpers';
import { TZ, ensureConfirmed } from './dispatchHelpers';

test.use({ timezoneId: TZ });

const JOB_A = 'Deliver framed works to a private residence'; // crew@ is team lead
const JOB_E = 'Pick up a framed print from a design studio'; // crew2@ assigned, not lead
const NOT_MINE = 'Hang a three-panel work in a lobby';
const MARKER = 'E2E-CREW incident: corner of a frame chipped on the stairs';

async function jobId(title: string) {
  const { data } = await svc.from('jobs').select('id').eq('title', title).single();
  return data!.id;
}

test.beforeAll(async () => {
  await ensureConfirmed('crew@example.com');
  await ensureConfirmed('crew2@example.com');
});

test.afterAll(async () => {
  const { data } = await svc.from('incident_reports').select('id, photos:incident_photos(path)').like('description', 'E2E-CREW%');
  const paths = (data ?? []).flatMap((r) => (r.photos as { path: string }[]).map((p) => p.path));
  if (paths.length) await svc.storage.from('incident-photos').remove(paths);
  if (data?.length) await svc.from('incident_reports').delete().in('id', data.map((r) => r.id));
  const a = await jobId(JOB_A);
  await svc.from('job_checklist_items').update({ checked_at: null, checked_by: null }).eq('job_id', a).eq('label', 'Equipment confirmed');
});

test('crew lands on My jobs and sees only their own jobs', async ({ page }) => {
  await signInAsAdmin(page, 'crew@example.com');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/my-jobs$/);
  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: JOB_A })).toBeVisible();
  await expect(page.getByRole('heading', { name: JOB_E })).toBeVisible();
  await expect(page.getByText(NOT_MINE)).toHaveCount(0);
  await expect(page.getByText('Invoice after placement.')).toHaveCount(0); // office notes never shown
  await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
});

test('team lead ticks a checklist item', async ({ page }) => {
  await signInAsAdmin(page, 'crew@example.com');
  await page.goto('/admin/my-jobs');
  const card = page.locator('article.crew-card', { has: page.getByRole('heading', { name: JOB_A }) });
  const box = card.getByRole('checkbox', { name: 'Equipment confirmed' });
  await expect(box).toBeEnabled();
  await box.check();
  const a = await jobId(JOB_A);
  await expect
    .poll(async () => (await svc.from('job_checklist_items').select('checked_by').eq('job_id', a).eq('label', 'Equipment confirmed').single()).data?.checked_by)
    .toBe('crew@example.com');
  await box.uncheck();
  await expect
    .poll(async () => (await svc.from('job_checklist_items').select('checked_at').eq('job_id', a).eq('label', 'Equipment confirmed').single()).data?.checked_at)
    .toBeNull();
});

test('crew files a named incident with photos; GPS/EXIF is stripped', async ({ page }) => {
  await signInAsAdmin(page, 'crew@example.com');
  await page.goto('/admin/my-jobs');
  const card = page.locator('article.crew-card', { has: page.getByRole('heading', { name: JOB_A }) });
  await card.getByRole('link', { name: 'Report damage / incident' }).click();
  await expect(page.getByRole('heading', { name: 'Report damage / incident' })).toBeVisible();
  await expect(page.getByText(/not anonymous/i)).toBeVisible();

  await page.getByLabel('What happened?').fill(MARKER);
  const file = page.locator('input[type=file]');
  await file.setInputFiles('tests/fixtures/gps.jpg');
  await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
  await file.setInputFiles('tests/fixtures/clean.webp');
  await expect(page.getByRole('button', { name: 'Remove photo 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('heading', { name: 'Report sent' })).toBeVisible({ timeout: 20_000 });

  const { data: rep } = await svc
    .from('incident_reports')
    .select('reported_by, status, job_id, photos:incident_photos(path)')
    .eq('description', MARKER)
    .single();
  expect(rep).toMatchObject({ reported_by: 'crew@example.com', status: 'open', job_id: await jobId(JOB_A) });
  const photos = rep!.photos as { path: string }[];
  expect(photos).toHaveLength(2);
  for (const p of photos) {
    const dl = await svc.storage.from('incident-photos').download(p.path);
    const bytes = new Uint8Array(await dl.data!.arrayBuffer());
    const kind = sniffImage(bytes)!;
    expect(kind).not.toBeNull();
    expect(hasMetadata(bytes, kind)).toBe(false);
    expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/GPS|TestCam/);
  }
});

test('crew cannot reach office or suggestion-box pages', async ({ page }) => {
  await signInAsAdmin(page, 'crew@example.com');
  for (const path of ['/admin/dispatch', '/admin/audit', '/admin/dispatch/crew', '/admin/hr']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Not available for your account' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inbox' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Day board' })).toHaveCount(0);
  }
});

test('a crew member who is not the team lead sees the checklist read-only', async ({ page }) => {
  await signInAsAdmin(page, 'crew2@example.com');
  await page.goto('/admin/my-jobs');
  const card = page.locator('article.crew-card', { has: page.getByRole('heading', { name: JOB_E }) });
  await expect(card).toBeVisible();
  await expect(card.getByText('The team lead ticks these.')).toBeVisible();
  const boxes = card.getByRole('checkbox');
  expect(await boxes.count()).toBeGreaterThan(0);
  for (const b of await boxes.all()) await expect(b).toBeDisabled();
});
