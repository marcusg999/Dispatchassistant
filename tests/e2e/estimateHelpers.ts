/** Shared helpers for the Phase 3 estimate specs. Fixtures and checks use the service client. */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { svc } from './helpers';

export const TZ = 'America/Los_Angeles';
export const PREFIX = 'E2E-P3';
export const SEEDED_QUOTE_TOKEN = 'seedsentquotetoken000000000000A';

/** Parses "$12,345.67" (or "−$1.00") into cents. */
export function centsFromText(text: string): number {
  const neg = /^[-−]/.test(text.trim());
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return (neg ? -1 : 1) * Math.round(n * 100);
}

/** Same formatting the app uses (en-US currency). */
export const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** On-screen builder total in cents. */
export async function onScreenTotal(page: Page): Promise<number> {
  return centsFromText(await page.locator('dd.est-total-row').innerText());
}

export function estimateIdFromUrl(page: Page): string {
  const m = page.url().match(/\/admin\/estimates\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`not an estimate URL: ${page.url()}`);
  return m[1];
}

export async function estimateRow(id: string) {
  const { data, error } = await svc.from('estimates').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** Waits for the builder autosave (the totals panel says "Saved"), then for the DB to agree with the screen. */
export async function waitForAutosave(page: Page, id: string) {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => Number((await estimateRow(id)).total_cents), { timeout: 15_000 })
    .toBe(await onScreenTotal(page));
}

/** Creates an estimate through the UI form and lands on its builder. Returns the estimate id. */
export async function createEstimateViaUi(page: Page, title: string, client: string | null) {
  await page.goto('/admin/estimates/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  if (client) await page.getByLabel('Client', { exact: true }).selectOption({ label: client });
  await page.getByRole('button', { name: 'Create estimate' }).click();
  await expect(page).toHaveURL(/\/admin\/estimates\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return estimateIdFromUrl(page);
}

/** Removes every estimate (and its dependents) created by these specs. */
export async function cleanupEstimates() {
  const { data: ests } = await svc.from('estimates').select('id').like('title', `${PREFIX}%`);
  const ids = (ests ?? []).map((e) => e.id);
  if (!ids.length) return;
  await svc.from('quote_acceptances').delete().in('estimate_id', ids); // FK restrict
  const { data: conv } = await svc.from('estimates').select('converted_job_id').in('id', ids).not('converted_job_id', 'is', null);
  const jobIds = (conv ?? []).map((c) => c.converted_job_id!).filter(Boolean);
  await svc.from('estimates').update({ converted_job_id: null }).in('id', ids);
  if (jobIds.length) await svc.from('jobs').delete().in('id', jobIds);
  await svc.from('jobs').delete().like('title', `${PREFIX}%`);
  await svc.from('quote_links').delete().in('estimate_id', ids);
  await svc.from('estimates').delete().in('id', ids);
}
