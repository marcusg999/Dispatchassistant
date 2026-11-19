import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { signInAsAdmin, svc } from './helpers';

let id = '';
const NAME = `E2E Person ${Date.now()}`;
const BODY = 'E2E-HR: I need to discuss a personal scheduling conflict privately.';

test.beforeAll(async () => {
  const { data, error } = await svc
    .from('hr_reports')
    .insert({ full_name: NAME, contact: '555-0100', body: BODY, tracking_hash: randomBytes(32).toString('hex') })
    .select('id')
    .single();
  if (error) throw error;
  id = data.id;
});

test.afterAll(async () => {
  await svc.from('hr_reports').delete().eq('id', id);
});

test('HR member: sees the HR inbox, triages a named report and exports it', async ({ page }) => {
  await signInAsAdmin(page, 'hr@example.com');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'HR inbox' })).toBeVisible();
  await expect(page.getByText('HR eyes only: named reports. Admins can’t see this page.')).toBeVisible();
  // hr@example.com is not an admin: no anonymous-inbox link.
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toHaveCount(0);

  await page.getByLabel('Search').fill(NAME);
  await expect(page.getByText('1 report', { exact: true })).toBeVisible();
  await page.getByText(BODY).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/hr/r/${id}$`));
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await expect(page.getByText('555-0100')).toBeVisible();

  await page.getByRole('button', { name: 'Reviewing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reviewing', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('textbox', { name: 'Add a note' }).fill('Booked a call for Thursday.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Booked a call for Thursday.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Reply to the person' }).fill('Thanks. HR will call you Thursday.');
  await page.getByRole('button', { name: 'Save reply' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible();

  const { data } = await svc.from('hr_reports').select('status, public_reply').eq('id', id).single();
  expect(data).toEqual({ status: 'reviewing', public_reply: 'Thanks. HR will call you Thursday.' });

  // History is audited without names or text.
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByText('HR report status New → Reviewing')).toBeVisible();
  const { data: log } = await svc.from('audit_log').select('before, after').eq('suggestion_id', id);
  expect(JSON.stringify(log)).not.toContain(NAME);
  expect(JSON.stringify(log)).not.toContain('HR will call you');

  await page.getByRole('link', { name: '← HR inbox' }).click();
  await page.getByLabel('Search').fill(NAME);
  await expect(page.getByText('1 report', { exact: true })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^hr_reports_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync((await dl.path())!) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('HR reports')!;
  expect(ws.getCell('B5').value).toBe(NAME);
  expect(ws.getCell('E5').value).toBe(BODY);
});

test('admin who is not HR: no HR inbox and no access to HR pages', async ({ page }) => {
  await signInAsAdmin(page, 'admin@example.com');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'HR inbox' })).toHaveCount(0);
  await page.goto('/admin/hr');
  await expect(page.getByRole('heading', { name: 'Not available for your account' })).toBeVisible();
  await page.goto(`/admin/hr/r/${id}`);
  await expect(page.getByRole('heading', { name: 'Not available for your account' })).toBeVisible();
  await expect(page.getByText(NAME)).toHaveCount(0);
});
