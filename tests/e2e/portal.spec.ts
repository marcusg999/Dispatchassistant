import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hasMetadata, sniffImage } from '../../netlify/lib/image';
import { PORTAL, fillSuggestion, readTrackingCode, svc } from './helpers';

const hashOf = (code: string) => createHash('sha256').update(code).digest('hex');

test('submit without a photo, then check status with the tracking code', async ({ page }) => {
  await page.goto(PORTAL);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Speak freely/);
  // No identity fields anywhere on the form.
  await expect(page.locator('input[type=email], input[name*=name i], input[type=tel]')).toHaveCount(0);

  await fillSuggestion(page, 'E2E: the loading dock light is out, hard to see crates at night.');
  await page.getByRole('button', { name: /Send to the office/i }).click();
  await expect(page.getByRole('heading', { name: /Sent\. Thank you/ })).toBeVisible({ timeout: 15_000 });

  const code = await readTrackingCode(page);
  expect(code).toMatch(/^([A-Z]{3,8}-){4}\d{4}$/);
  // The plain code is never stored: only its hash.
  const { data } = await svc.from('suggestions').select('status, tracking_hash').eq('tracking_hash', hashOf(code)).single();
  expect(data?.status).toBe('new');

  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByLabel('Tracking code')).toHaveValue(code);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('Received. Not reviewed yet.')).toBeVisible();
  await expect(page.getByText('No reply yet.')).toBeVisible();
});

test('submit with a GPS-tagged photo: EXIF/GPS is gone from what gets stored', async ({ page }) => {
  const original = new Uint8Array(readFileSync('tests/fixtures/gps.jpg'));
  expect(hasMetadata(original, { ext: 'jpg', mime: 'image/jpeg' })).toBe(true); // fixture really has GPS

  await page.goto(PORTAL);
  await fillSuggestion(page, 'E2E: photo of the cracked crate base on the shop floor.', 'Crating & Shop', /Important/);
  await page.locator('#f-photo').setInputFiles('tests/fixtures/gps.jpg');
  await expect(page.getByText(/Location and camera details removed/)).toBeVisible();
  await page.getByRole('button', { name: /Send to the office/i }).click();
  await expect(page.getByRole('heading', { name: /Sent\. Thank you/ })).toBeVisible({ timeout: 15_000 });

  const code = await readTrackingCode(page);
  const { data } = await svc.from('suggestions').select('photo_path').eq('tracking_hash', hashOf(code)).single();
  expect(data?.photo_path).toMatch(/\.(webp|jpg)$/);
  const dl = await svc.storage.from('suggestion-photos').download(data!.photo_path!);
  const stored = new Uint8Array(await dl.data!.arrayBuffer());
  const kind = sniffImage(stored)!;
  expect(kind).not.toBeNull();
  expect(stored.length).toBeLessThanOrEqual(1_500_000);
  expect(hasMetadata(stored, kind)).toBe(false);
  const asText = Buffer.from(stored).toString('latin1');
  for (const marker of ['Exif', 'GPS', 'TestCam', 'Model X']) expect(asText).not.toContain(marker);
});

test('status works with sloppy typing; board shows only summaries', async ({ page }) => {
  await page.goto(`${PORTAL}#status`);
  await page.getByLabel('Tracking code').fill('brave canyon orbit maple 1001');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('A change is planned.')).toBeVisible();
  await expect(page.getByText(/lift gate is booked/)).toBeVisible();

  await page.getByRole('link', { name: /You said, we did/ }).click();
  await expect(page.getByRole('heading', { name: 'You said, we did.' })).toBeVisible();
  await expect(page.getByText(/Foam stock for soft-wrapping/)).toBeVisible();
  await expect(page.getByText(/2-inch foam/)).toHaveCount(0); // raw body never appears
});

test('validation errors are announced and linked to fields', async ({ page }) => {
  await page.goto(PORTAL);
  await page.getByRole('button', { name: /Send to the office/i }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Please write at least 10 characters.');
  await expect(alert).toContainText('Pick a category.');
});

test('every other path is a plain 404 with no hint of the admin console', async ({ request }) => {
  for (const p of ['/', '/s/wrong-key', '/portal.html', '/admin.html', '/s', '/login', '/api/board']) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(404);
    expect((await r.text()).toLowerCase()).not.toContain('admin');
  }
});
