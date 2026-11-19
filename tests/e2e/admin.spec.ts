import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { signInAsAdmin, svc } from './helpers';

let id = '';
const BODY = `E2E-ADMIN ${Date.now()}: the hand truck tires keep going flat.`;

test.beforeAll(async () => {
  const { data, error } = await svc
    .from('suggestions')
    .insert({ body: BODY, category: 'trucks_equipment', submitter_tag: 'important', admin_tag: 'important', tracking_hash: randomBytes(32).toString('hex') })
    .select('id')
    .single();
  if (error) throw error;
  id = data.id;
});

test.afterAll(async () => {
  await svc.from('suggestions').delete().eq('id', id);
});

test('signed-out visitors only see the Google sign-in', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText(BODY)).toHaveCount(0);
});

test('admin: search, re-tag, status, note, reply, publish, export both formats', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

  // Full-text search runs in Postgres.
  await page.getByLabel('Search').fill('hand truck tires');
  await expect(page.getByText('1 suggestion', { exact: true })).toBeVisible();
  await page.getByText(BODY).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/s/${id}$`));

  // Re-tag keeps the submitter's original.
  await page.getByRole('combobox', { name: 'Priority' }).selectOption('crucial');
  await expect(page.getByRole('status').filter({ hasText: 'Priority updated' })).toBeVisible();
  await expect(page.getByText('Submitter said')).toBeVisible();

  await page.getByRole('button', { name: 'Planned', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Planned', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('textbox', { name: 'Add a note' }).fill('Ordered foam-filled tires.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Ordered foam-filled tires.')).toBeVisible();
  await expect(page.getByText(/admin@example\.com ·/).first()).toBeVisible();

  await page.getByRole('textbox', { name: 'Public reply' }).fill('New tires are on order.');
  await page.getByRole('button', { name: 'Save reply' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Board summary' }).fill('Hand truck tires are being replaced with puncture-proof ones.');
  await page.getByRole('button', { name: 'Publish to board' }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  const { data } = await svc.from('suggestions').select('status, admin_tag, submitter_tag, published_to_board, public_reply').eq('id', id).single();
  expect(data).toEqual({ status: 'planned', admin_tag: 'crucial', submitter_tag: 'important', published_to_board: true, public_reply: 'New tires are on order.' });

  // History panel shows the audited actions.
  const historyPanel = page.getByRole('region', { name: 'History' });
  await expect(historyPanel.getByText('Priority Important → Crucial')).toBeVisible();
  await expect(historyPanel.getByText('Published to board')).toBeVisible();

  // Export the filtered view (search still active) in both formats.
  await page.getByRole('link', { name: '← Inbox' }).click();
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^suggestions_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync((await xlsx.path())!) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Suggestions')!;
  expect(String(ws.getCell('A3').value)).toContain('search: hand truck tires');
  expect(ws.getCell('F6').value).toBe(BODY);
  expect(ws.getCell('C6').value).toBe('Crucial');

  const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Word' }).click()]);
  expect(docx.suggestedFilename()).toMatch(/\.docx$/);
  const zip = await JSZip.loadAsync(readFileSync((await docx.path())!));
  expect(await zip.file('word/document.xml')!.async('string')).toContain('hand truck tires');

  // Exports are audited.
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText(/Exported 1 rows \(DOCX\)/).first()).toBeVisible();
  await expect(page.getByText(/Exported 1 rows \(XLSX\)/).first()).toBeVisible();

  // And the portal board now shows the public summary, not the body.
  await page.goto(`/s/${process.env.PORTAL_KEY || 'local-dev-portal-key-1234'}#board`);
  await expect(page.getByText('Hand truck tires are being replaced with puncture-proof ones.')).toBeVisible();
  await expect(page.getByText(BODY)).toHaveCount(0);
});

test('admin: manage admins and the last-admin guard is visible', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/admins');
  await expect(page.getByRole('cell', { name: /admin@example\.com/ }).first()).toBeVisible();
  await page.getByLabel(/Add an admin/).fill('e2e.helper@example.com');
  await page.getByRole('button', { name: 'Add admin' }).click();
  const row = page.getByRole('row', { name: /e2e\.helper@example\.com/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0);
});
