/** Shared helpers for the Phase 2 dispatch specs. Fixtures are created with the service client. */
import type { Locator, Page } from '@playwright/test';
import { svc } from './helpers';

export const TZ = 'America/Los_Angeles';
export const PREFIX = 'E2E-P2';

/** yyyy-mm-dd for today + n days in the office timezone. */
export function officeDate(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** ISO timestamp for a local office wall-clock time (handles PST/PDT). */
export function officeIso(date: string, hhmm: string): string {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const offsetPart = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(guess)
    .find((p) => p.type === 'timeZoneName')!.value; // e.g. GMT-8
  const m = offsetPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  const offMin = m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 0;
  return new Date(guess.getTime() - offMin * 60_000).toISOString();
}

export async function crewId(name: string): Promise<string> {
  const { data } = await svc.from('crew_members').select('id').eq('display_name', name).single();
  return data!.id;
}
export async function assetId(name: string): Promise<string> {
  const { data } = await svc.from('assets').select('id').eq('name', name).single();
  return data!.id;
}

export async function createJob(title: string, date: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await svc
    .from('jobs')
    .insert({
      title: `${PREFIX} ${title}`,
      job_type: 'delivery',
      status: 'scheduled',
      start_at: officeIso(date, '09:00'),
      end_at: officeIso(date, '12:00'),
      ...extra,
    })
    .select('id, job_number')
    .single();
  if (error) throw error;
  return data;
}

export async function addTimeOff(crewName: string, date: string) {
  const { data, error } = await svc
    .from('time_off')
    .insert({ crew_member_id: await crewId(crewName), start_date: date, end_date: date })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** Removes every job created by these specs (children cascade; incidents first). */
export async function cleanupJobs() {
  const { data: jobs } = await svc.from('jobs').select('id').like('title', `${PREFIX}%`);
  const ids = (jobs ?? []).map((j) => j.id);
  if (!ids.length) return;
  await svc.from('incident_reports').delete().in('job_id', ids);
  await svc.from('jobs').delete().in('id', ids);
}

/** Drag a roster handle onto a job column with a real pointer (scrolls both into view first). */
export async function dragOnto(page: Page, handle: Locator, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await handle.scrollIntoViewIfNeeded();
  await pointerDrag(page, center(await handle.boundingBox()), center(await target.boundingBox()));
}

/** A real pointer drag that satisfies dnd-kit's 6px activation distance. */
export async function pointerDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.waitForTimeout(150);
  await page.mouse.move(to.x + 2, to.y + 2, { steps: 2 });
  await page.mouse.up();
}

export function center(box: { x: number; y: number; width: number; height: number } | null) {
  if (!box) throw new Error('element not visible');
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 120) };
}

export async function latestOverride(jobId: string) {
  const { data } = await svc
    .from('audit_log')
    .select('actor_email, after, before')
    .eq('suggestion_id', jobId)
    .eq('action', 'dispatch_conflict_override')
    .order('id', { ascending: false });
  return data ?? [];
}

/** Some suites sign staff emails up without confirming them; make sure the account can sign in. */
export async function ensureConfirmed(email: string) {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const u = data.users.find((x) => x.email === email);
  if (u && !u.email_confirmed_at) await svc.auth.admin.updateUserById(u.id, { email_confirm: true });
}
