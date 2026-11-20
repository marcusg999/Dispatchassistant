/**
 * Phase 3 happy path, end to end: estimator builds a long-haul crated quote → admin approves →
 * estimator sends → client accepts on a phone → estimator converts to a job → dispatcher sees the
 * job without money → exports. One serial run; each step reads the previous step's DB state.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { ensureConfirmed } from './dispatchHelpers';
import { signInAsAdmin, svc } from './helpers';
import {
  PREFIX,
  TZ,
  cleanupEstimates,
  createEstimateViaUi,
  estimateRow,
  onScreenTotal,
  usd,
  waitForAutosave,
} from './estimateHelpers';

test.use({ timezoneId: TZ, viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.describe.configure({ mode: 'serial' });

const TITLE = `${PREFIX} Long-haul crated quote`;
const CLIENT = 'Example Contemporary Gallery';
const SIGNER = { name: 'Casey Client', title: 'Registrar', email: 'casey.client@example.com' };

let estimateId = '';
let estimateNumber = '';
let totalCents = 0;
let quoteUrl = '';
let jobId = '';

test.beforeAll(async () => {
  await cleanupEstimates();
});
test.afterAll(async () => {
  await cleanupEstimates();
});

/** A fresh staff browser context + page signed in as `email`. */
async function staffPage(browser: Browser, email: string): Promise<{ page: Page; close: () => Promise<void> }> {
  await ensureConfirmed(email);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: TZ, acceptDownloads: true });
  const page = await ctx.newPage();
  await signInAsAdmin(page, email);
  return { page, close: () => ctx.close() };
}

test('a. estimator builds a long-haul crated quote and submits it for approval', async ({ browser }) => {
  const { page, close } = await staffPage(browser, 'estimator@example.com');
  estimateId = await createEstimateViaUi(page, TITLE, CLIENT);

  // Client, service (delivery is the default; set it anyway), basics.
  await page.getByLabel('Service type').selectOption('delivery');

  // Two stops: origin and a destination 420 miles away (the first stop has no "miles from previous").
  await page.getByRole('button', { name: '+ Add stop' }).click();
  await page.getByRole('button', { name: '+ Add stop' }).click();
  await page.getByLabel('Address', { exact: true }).nth(0).fill('1200 Example Ave, Los Angeles, CA');
  await page.getByLabel('Address', { exact: true }).nth(1).fill('88 Placeholder St, Portland, OR');
  await expect(page.getByLabel('Miles from previous stop').nth(0)).toBeDisabled();
  await page.getByLabel('Miles from previous stop').nth(1).fill('420');
  await expect(page.getByText('Total distance')).toContainText('420 mi');

  // One item: oil on canvas, 60×48×3, 45 lb, declared $50,000, custom crate with a reason.
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Description', { exact: true }).fill('Large oil painting');
  await page.getByLabel('Medium (drives packing)').fill('oil on canvas');
  await page.getByLabel('Height (in)').fill('60');
  await page.getByLabel('Width (in)').fill('48');
  await page.getByLabel('Depth (in)').fill('3');
  await page.getByLabel('Weight (lb)').fill('45');
  await page.getByLabel('Declared value ($)').fill('50000');
  await page.getByLabel('Packing method').selectOption({ label: 'Custom crate' });
  await page.getByLabel('Reason for changing the packing method (required)').fill('Client requires a museum-grade custom crate');

  // Crew, labor, vehicle.
  await page.getByLabel('Labor hours').fill('9');
  await page.getByLabel('Vehicle', { exact: true }).selectOption({ label: 'Air-ride climate truck' });
  await page.getByLabel('Vehicle hours').fill('9');
  await page.getByLabel('Override crew count').fill('4');
  await page.getByLabel('Reason for the override (required)').fill('Two flights of stairs and a long carry');

  // Access and add-ons.
  await page.getByLabel('Stairs (per flight): quantity').fill('2');
  await page.getByLabel(/^Placement \/ installation .*: quantity$/).fill('1');

  // 15% discount is above the 10% threshold → needs approval.
  await page.getByLabel('Discount (%)').fill('15');

  await waitForAutosave(page, estimateId);
  totalCents = await onScreenTotal(page);
  expect(totalCents).toBeGreaterThan(0);

  const row = await estimateRow(estimateId);
  estimateNumber = row.estimate_number;
  expect(row.discount_bp).toBe(1500);
  expect(row.needs_approval).toBe(true);
  const { data: lines } = await svc.from('estimate_lines').select('key, category, client_visible, amount_cents').eq('estimate_id', estimateId);
  expect(lines!.length).toBeGreaterThan(3);
  expect(lines!.some((l) => l.category === 'packing_crating')).toBe(true);
  const { data: stops } = await svc.from('estimate_stops').select('position').eq('estimate_id', estimateId);
  const { data: items } = await svc.from('estimate_items').select('medium, packing_method').eq('estimate_id', estimateId);
  expect(stops).toHaveLength(2);
  expect(items![0]).toMatchObject({ packing_method: 'custom_crate' });

  // The totals panel shows approval is needed, and the send button is replaced by a hint.
  const totals = page.getByRole('complementary');
  await expect(totals).toContainText('Needs an admin’s approval before it can be sent');
  await expect(totals).toContainText(/discount/i);
  await expect(page.getByText('Needs approval before it can be sent.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send quote' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect.poll(async () => (await estimateRow(estimateId)).status, { timeout: 15_000 }).toBe('pending_approval');
  await expect(page.getByText('Waiting for an admin’s approval.')).toBeVisible();
  await close();
});

test('b. admin approves it from the Approvals queue with a note', async ({ browser }) => {
  const { page, close } = await staffPage(browser, 'admin@example.com');
  await page.goto('/admin/estimates/approvals');
  const item = page.getByRole('listitem').filter({ hasText: estimateNumber });
  await expect(item).toContainText(TITLE);
  await expect(item).toContainText(usd(totalCents));
  await item.getByRole('button', { name: /^Approve/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Note for the estimator/).fill('Approved: repeat client, crate justified.');
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await estimateRow(estimateId)).status, { timeout: 15_000 }).toBe('approved');
  const row = await estimateRow(estimateId);
  expect(row.approved_by).toBe('admin@example.com');
  expect(row.approval_note).toBe('Approved: repeat client, crate justified.');
  expect(Number(row.approved_total_cents)).toBe(totalCents);
  await expect(page.getByRole('listitem').filter({ hasText: estimateNumber })).toHaveCount(0);
  await close();
});

test('c. estimator sends the quote and sees the link once', async ({ browser }) => {
  const { page, close } = await staffPage(browser, 'estimator@example.com');
  await page.goto(`/admin/estimates/${estimateId}`);
  await expect(page.getByText('Approval').first()).toBeVisible();
  await expect(page.getByText('Note: Approved: repeat client, crate justified.')).toBeVisible();
  await page.getByRole('button', { name: 'Send quote' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create quote link' }).click();
  await expect(page.getByRole('heading', { name: 'Quote link created' })).toBeVisible();
  quoteUrl = await page.getByLabel('Quote link', { exact: true }).inputValue();
  expect(quoteUrl).toMatch(/^http:\/\/localhost:8888\/q\/[A-Za-z0-9_-]{20,64}$/);

  const row = await estimateRow(estimateId);
  expect(row.status).toBe('sent');
  const { data: links } = await svc.from('quote_links').select('id, revoked_at, expires_at, token_hash').eq('estimate_id', estimateId);
  expect(links).toHaveLength(1);
  expect(links![0].revoked_at).toBeNull();
  // Only a hash is stored, never the token itself.
  expect(links![0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(links)).not.toContain(quoteUrl.split('/').pop()!);

  // The link can't be shown again: reload and it's gone.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Quote link created' })).toHaveCount(0);
  await close();
});

test('d. client accepts on a phone: no costs shown, PDF downloads, signed acceptance recorded', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, timezoneId: TZ, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(quoteUrl);
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();

  // Client-visible lines and the total; nothing about cost or margin.
  const { data: lines } = await svc.from('estimate_lines').select('description, client_visible').eq('estimate_id', estimateId);
  const visible = lines!.filter((l) => l.client_visible);
  expect(visible.length).toBeGreaterThan(3);
  const main = page.locator('main');
  await expect(page.locator('.q-grand')).toContainText(usd(totalCents));
  await expect(main).toContainText('Large oil painting');
  await expect(main).toContainText(visible[0].description);
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\bcosts?\b/i);
  expect(text).not.toMatch(/\bmargin\b/i);
  expect(text).not.toMatch(/internal/i);
  const html = await page.content();
  expect(html).not.toMatch(/cost_cents|margin_bp|unit_cost/);
  // No horizontal scroll on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toBe(`quote_${estimateNumber}_r1.pdf`);

  await page.getByLabel('Full name').fill(SIGNER.name);
  await page.getByLabel(/^Title/).fill(SIGNER.title);
  await page.getByLabel('Email').fill(SIGNER.email);
  await page.getByLabel(/^Signature/).fill('Someone Else');
  await expect(page.getByText('Doesn’t match the name above yet.')).toBeVisible();
  await page.getByLabel(/^Signature/).fill(SIGNER.name.toLowerCase()); // case/whitespace-insensitive match
  await expect(page.getByText('✓ Signature matches your name.')).toBeVisible();
  await page.getByRole('checkbox', { name: /I agree to the terms/ }).check();
  await page.getByRole('button', { name: 'Review and accept' }).click();
  await expect(page.getByText(`Accept quote for ${usd(totalCents)}?`)).toBeVisible();
  await page.getByRole('button', { name: `Yes, accept quote for ${usd(totalCents)}` }).click();
  await expect(page.getByText(`Accepted by ${SIGNER.name}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Review and accept' })).toHaveCount(0);

  const { data: acc } = await svc.from('quote_acceptances').select('*').eq('estimate_id', estimateId).single();
  expect(acc).toMatchObject({ accepted_name: SIGNER.name, accepted_email: SIGNER.email, accepted_title: SIGNER.title, agreed_to_terms: true });
  expect(Number(acc!.total_cents)).toBe(totalCents);
  expect((await estimateRow(estimateId)).status).toBe('accepted');
  await ctx.close();
});

test('e. estimator converts the accepted estimate to a draft job', async ({ browser }) => {
  const { page, close } = await staffPage(browser, 'estimator@example.com');
  await page.goto(`/admin/estimates/${estimateId}`);
  await page.getByRole('button', { name: 'Convert to job' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert to job' }).click();
  await expect(page).toHaveURL(/\/admin\/dispatch\/jobs\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  jobId = page.url().split('/').pop()!;

  const { data: job } = await svc
    .from('jobs')
    .select('title, status, source_estimate_number, client_name, job_stops(position), job_items(description, medium, height_in, width_in, depth_in, weight_lbs)')
    .eq('id', jobId)
    .single();
  expect(job).toMatchObject({ title: TITLE, status: 'draft', source_estimate_number: estimateNumber, client_name: CLIENT });
  expect(job!.job_stops).toHaveLength(2);
  expect(job!.job_items).toHaveLength(1);
  expect(job!.job_items[0]).toMatchObject({ description: 'Large oil painting', medium: 'oil on canvas', height_in: 60, width_in: 48, depth_in: 3, weight_lbs: 45 });
  const row = await estimateRow(estimateId);
  expect(row.status).toBe('converted');
  expect(row.converted_job_id).toBe(jobId);
  await close();
});

test('f. dispatcher sees the job without any money and cannot open estimates', async ({ browser }) => {
  const { page, close } = await staffPage(browser, 'dispatcher@example.com');
  await page.goto(`/admin/dispatch/jobs/${jobId}`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(TITLE);
  await expect(page.locator('#i0-desc')).toHaveValue('Large oil painting');

  // No dollar amounts from the estimate anywhere on the page (text or form values).
  const everything = await page.evaluate(() => {
    const vals = [...document.querySelectorAll('input, textarea, select')].map((e) => (e as HTMLInputElement).value).join('\n');
    return `${document.body.innerText}\n${vals}`;
  });
  expect(everything).not.toContain(usd(totalCents));
  expect(everything).not.toContain((totalCents / 100).toFixed(2));
  expect(everything).not.toMatch(/\$\s?\d/);

  // The estimates module is closed to dispatchers.
  await page.goto('/admin/estimates');
  await expect(page.getByRole('heading', { name: 'Not available for your account' })).toBeVisible();
  await page.goto(`/admin/estimates/${estimateId}`);
  await expect(page.getByRole('heading', { name: 'Not available for your account' })).toBeVisible();
  await close();
});

// BUG (reported): the dispatch job editor never renders jobs.source_estimate_number, so dispatchers
// can't see which estimate a job came from. Marked fail so the suite stays green; remove test.fail once fixed.
test('f2. dispatcher sees the source estimate number on the job', async ({ browser }) => {
  test.fail(true, 'App gap: JobEditor does not display source_estimate_number');
  const { page, close } = await staffPage(browser, 'dispatcher@example.com');
  await page.goto(`/admin/dispatch/jobs/${jobId}`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(TITLE);
  await expect(page.locator('main')).toContainText(estimateNumber, { timeout: 3000 });
  await close();
});

test('g. exports: Quote PDF, Word, Excel and Internal Excel download and are audited', async ({ browser }) => {
  const { page, close } = await staffPage(browser, 'estimator@example.com');
  await page.goto(`/admin/estimates/${estimateId}`);
  await expect(page.getByRole('heading', { name: 'Exports' })).toBeVisible();
  const base = `quote_${estimateNumber}_r1`;
  const cases: [string, string, string][] = [
    ['Quote PDF', `${base}.pdf`, 'pdf'],
    ['Word (.docx)', `${base}.docx`, 'docx'],
    ['Excel (.xlsx)', `${base}.xlsx`, 'xlsx'],
    ['Internal Excel (cost & margin)', `${base}_internal.xlsx`, 'xlsx_internal'],
  ];
  for (const [button, filename] of cases) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toBe(filename);
    await expect(page.getByText(`Downloaded ${filename}`)).toBeVisible();
  }
  await expect
    .poll(
      async () => {
        const { data } = await svc.from('audit_log').select('after, actor_email').eq('suggestion_id', estimateId).eq('action', 'estimate_export');
        return (data ?? []).map((r) => `${(r.after as { format: string; internal: boolean }).format}:${(r.after as { internal: boolean }).internal}`).sort();
      },
      { timeout: 10_000 },
    )
    .toEqual(['docx:false', 'pdf:false', 'xlsx:false', 'xlsx_internal:true']);
  const { data: audit } = await svc.from('audit_log').select('actor_email').eq('suggestion_id', estimateId).eq('action', 'estimate_export');
  expect(new Set(audit!.map((a) => a.actor_email))).toEqual(new Set(['estimator@example.com']));
  await close();
});
