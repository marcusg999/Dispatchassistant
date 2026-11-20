/** The core estimator flow with the keyboard only: create, edit, autosave, "How calculated", override, send. */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureConfirmed } from './dispatchHelpers';
import { signInAsAdmin, svc } from './helpers';
import { PREFIX, TZ, cleanupEstimates, estimateIdFromUrl, estimateRow, onScreenTotal, waitForAutosave } from './estimateHelpers';

test.use({ timezoneId: TZ, viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const TITLE = `${PREFIX} Keyboard quote`;

test.beforeAll(cleanupEstimates);
test.afterAll(async () => {
  await cleanupEstimates();
  // The duplicate is retitled by the test; if it failed before that, remove the leftover copy.
  const { data: leftovers } = await svc.from('estimates').select('id').eq('title', 'Deliver a painting to a residence (copy)');
  const ids = (leftovers ?? []).map((e) => e.id);
  if (ids.length) {
    await svc.from('quote_links').delete().in('estimate_id', ids);
    await svc.from('estimates').delete().in('id', ids);
  }
});

const isFocused = (l: Locator) => l.evaluate((el) => el === document.activeElement).catch(() => false);

/** Presses Tab (or Shift+Tab) until `target` has focus. */
async function reach(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab', max = 300) {
  for (let i = 0; i < max && !(await isFocused(target)); i++) await page.keyboard.press(key);
  await expect(target).toBeFocused();
}
/** Replaces the value of the focused field by typing. */
async function typeOver(page: Page, text: string) {
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text);
}

test('estimator builds, edits, inspects, overrides and sends a quote with the keyboard only', async ({ page }) => {
  await ensureConfirmed('estimator@example.com');
  await signInAsAdmin(page, 'estimator@example.com');
  await page.goto('/admin/estimates/new');

  // ── New estimate form ──────────────────────────────────────────────────────
  await page.getByLabel('Title', { exact: true }).focus(); // starting point only; everything else is keys
  await page.keyboard.type(TITLE);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Client', { exact: true })).toBeFocused();
  await page.keyboard.type('Example Cont'); // type-ahead picks "Example Contemporary Gallery"
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue(/.+/);
  await reach(page, page.getByRole('button', { name: 'Create estimate' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/estimates\/[0-9a-f-]{36}$/);
  const id = estimateIdFromUrl(page);
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  expect((await estimateRow(id)).client_id).not.toBeNull();

  // ── Stops: Enter on "+ Add stop" twice, then Tab through the new fields ───
  const addStop = page.getByRole('button', { name: '+ Add stop' });
  await reach(page, addStop);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Stop 2' })).toBeVisible();
  await reach(page, page.getByLabel('Address', { exact: true }).nth(0), 'Shift+Tab'); // new stop cards sit above the button
  await page.keyboard.type('1200 Example Ave, Los Angeles, CA');
  await reach(page, page.getByLabel('Address', { exact: true }).nth(1));
  await page.keyboard.type('77 Example Way, San Diego, CA');
  await reach(page, page.getByLabel('Miles from previous stop').nth(1));
  await page.keyboard.type('120');

  // ── Item: Enter on "+ Add item", Shift+Tab back to its first field ────────
  await reach(page, page.getByRole('button', { name: '+ Add item' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Item 1' })).toBeVisible();
  await reach(page, page.getByLabel('Description', { exact: true }), 'Shift+Tab');
  await page.keyboard.type('Framed pastel');
  await reach(page, page.getByLabel('Medium (drives packing)'));
  await page.keyboard.type('pastel on paper');
  for (const [label, value] of [['Height (in)', '40'], ['Width (in)', '30'], ['Depth (in)', '2'], ['Weight (lb)', '25']] as const) {
    await reach(page, page.getByLabel(label));
    await typeOver(page, value);
  }

  // ── Crew, labor, vehicle ───────────────────────────────────────────────────
  await reach(page, page.getByLabel('Labor hours'));
  await typeOver(page, '4');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Vehicle', { exact: true })).toBeFocused();
  await page.keyboard.type('Liftgate'); // select type-ahead → "Liftgate van"
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Vehicle hours')).toBeFocused();
  await typeOver(page, '4');

  await waitForAutosave(page, id);
  const first = await estimateRow(id);
  const firstTotal = Number(first.total_cents);
  expect(firstTotal).toBeGreaterThan(0);
  expect((first.inputs as { options?: { labor_hours?: number } }).options?.labor_hours).toBe(4);

  // ── Edit labor hours and the item weight, wait for autosave again ──────────
  await reach(page, page.getByLabel('Weight (lb)'), 'Shift+Tab');
  await typeOver(page, '60');
  await reach(page, page.getByLabel('Labor hours'));
  await typeOver(page, '6');
  await expect(page.getByText('Saved', { exact: true })).toHaveCount(0); // dirty again until the debounce fires
  await waitForAutosave(page, id);
  const second = await estimateRow(id);
  expect((second.inputs as { options?: { labor_hours?: number } }).options?.labor_hours).toBe(6);
  expect(Number(second.total_cents)).toBeGreaterThan(firstTotal); // more labor hours → higher price
  const { data: items } = await svc.from('estimate_items').select('weight_lbs').eq('estimate_id', id);
  expect(Number(items![0].weight_lbs)).toBe(60);

  // ── "How calculated" for the labor line, opened with Enter ─────────────────
  const laborRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Labor', exact: true }) }).first();
  const howBtn = laborRow.getByRole('button', { name: /How calculated/ });
  await reach(page, howBtn);
  await expect(howBtn).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(howBtn).toHaveAttribute('aria-expanded', 'true');
  const trace = page.locator('p.est-trace').first();
  await expect(trace).toBeVisible();
  expect(((await trace.innerText()) ?? '').trim().length).toBeGreaterThan(10);
  const { data: laborLine } = await svc.from('estimate_lines').select('trace').eq('estimate_id', id).eq('category', 'labor').limit(1).single();
  await expect(trace).toContainText(laborLine!.trace.trim().slice(0, 12));

  // ── Override the labor line from the dialog, keyboard only ─────────────────
  const overrideBtn = laborRow.getByRole('button', { name: /^Override/ });
  await reach(page, overrideBtn);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Override line' });
  await expect(dialog).toBeVisible();
  await reach(page, dialog.getByLabel('Unit price ($)'));
  await typeOver(page, '1.00');
  await reach(page, dialog.getByLabel('Reason (required)'));
  await page.keyboard.type('Matching the client’s agreed hourly rate');
  await reach(page, dialog.getByRole('button', { name: 'Save override' }));
  await page.keyboard.press('Space');
  await expect(dialog).toBeHidden();
  await expect(laborRow.getByText('Overridden')).toBeVisible();
  await expect(laborRow).toContainText('Reason: Matching the client’s agreed hourly rate');
  await waitForAutosave(page, id);
  const afterOverride = await estimateRow(id);
  expect(Number(afterOverride.total_cents)).toBeLessThan(Number(second.total_cents));
  expect(Number(afterOverride.total_cents)).toBe(await onScreenTotal(page));
  const { data: overridden } = await svc.from('estimate_lines').select('overridden, override_reason, unit_price_cents').eq('estimate_id', id).eq('overridden', true);
  expect(overridden).toHaveLength(1);
  expect(overridden![0]).toMatchObject({ override_reason: 'Matching the client’s agreed hourly rate', unit_price_cents: 100 });

  // ── The override drops the margin below target → approval is needed; submit with the keyboard ──
  await expect(page.getByRole('complementary')).toContainText('Needs an admin’s approval before it can be sent');
  expect(afterOverride.needs_approval).toBe(true);
  await expect(page.getByRole('button', { name: 'Send quote' })).toHaveCount(0);
  const submit = page.getByRole('button', { name: 'Submit for approval' });
  await reach(page, submit, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await estimateRow(id)).status, { timeout: 15_000 }).toBe('pending_approval');
  await expect(page.getByText('Waiting for an admin’s approval.')).toBeVisible();
  const pending = await estimateRow(id);
  expect(Number(pending.total_cents)).toBe(Number(afterOverride.total_cents));
  expect(pending.approval_reasons.length).toBeGreaterThan(0);
});

test('estimator sends a quote that needs no approval with the keyboard only', async ({ page }) => {
  await ensureConfirmed('estimator@example.com');
  await signInAsAdmin(page, 'estimator@example.com');
  // A priced draft that needs no approval (no override, no discount); the whole send runs on keys.
  const { data: base } = await svc.from('estimates').select('id').eq('estimate_number', 'Q-2026-0001').single();
  await page.goto('/admin/estimates');
  const duplicateBtn = page.getByRole('button', { name: /^Duplicate Q-2026-0001/ });
  await reach(page, duplicateBtn);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/estimates\/[0-9a-f-]{36}$/);
  const id = estimateIdFromUrl(page);
  expect(id).not.toBe(base!.id);
  // Retitle the copy so cleanup finds it (typing into the Title field, reached by keys).
  const title = page.getByLabel('Title', { exact: true });
  await expect(title).toHaveValue(/\(copy\)$/);
  await reach(page, title);
  await typeOver(page, `${PREFIX} Keyboard send`);
  await waitForAutosave(page, id);
  const row = await estimateRow(id);
  test.skip(row.needs_approval, 'seed estimate Q-2026-0001 would need approval');
  await expect(page.getByText('No approval needed.')).toBeVisible();
  await reach(page, page.getByRole('button', { name: 'Send quote' }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Send this quote?' });
  await expect(confirm).toBeVisible();
  await reach(page, confirm.getByRole('button', { name: 'Create quote link' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Quote link created' })).toBeVisible();
  expect(await page.getByLabel('Quote link', { exact: true }).inputValue()).toMatch(/\/q\/[A-Za-z0-9_-]{20,}$/);
  const sent = await estimateRow(id);
  expect(sent.status).toBe('sent');
  const { data: links } = await svc.from('quote_links').select('id').eq('estimate_id', id);
  expect(links).toHaveLength(1);
});
