import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PORTAL, readTrackingCode, svc } from './helpers';

const hashOf = (code: string) => createHash('sha256').update(code).digest('hex');

test.afterAll(async () => {
  await svc.from('hr_reports').delete().like('body', 'E2E-HR:%');
});

test('HR eyes only: named report is clearly not anonymous, stored for HR, trackable', async ({ page }) => {
  await page.goto(PORTAL);
  // Default is the anonymous form: no name field.
  await expect(page.getByRole('textbox', { name: /^Your name/ })).toHaveCount(0);

  await page.getByRole('radio', { name: /HR eyes only/ }).check();
  await expect(page.getByRole('note')).toContainText('This is not anonymous');
  await expect(page.getByText('Named · HR only')).toBeVisible();

  // Name is required.
  await page.getByLabel(/What’s going on/).fill('E2E-HR: I need to discuss a scheduling conflict with a medical appointment.');
  await page.getByRole('button', { name: /Send to HR/ }).click();
  await expect(page.getByRole('alert')).toContainText('Please enter your name.');

  await page.getByRole('textbox', { name: /^Your name/ }).fill('Jordan Example');
  await page.getByLabel(/Phone or email/).fill('jordan@example.com');
  await page.getByRole('button', { name: /Send to HR/ }).click();
  await expect(page.getByRole('heading', { name: /Sent\. Thank you/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Only HR can read your report/)).toBeVisible();

  const code = await readTrackingCode(page);
  const { data } = await svc.from('hr_reports').select('full_name, contact, status').eq('tracking_hash', hashOf(code)).single();
  expect(data).toEqual({ full_name: 'Jordan Example', contact: 'jordan@example.com', status: 'new' });
  expect((await svc.from('suggestions').select('id').eq('tracking_hash', hashOf(code))).data).toHaveLength(0);

  await page.getByRole('button', { name: 'Check status' }).click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('Received. Not reviewed yet.')).toBeVisible();
});
