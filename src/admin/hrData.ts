/**
 * Typed data access for "HR eyes only" reports. Every call runs as the signed-in
 * user under RLS: only members of public.hr_staff get any rows back (admins get none).
 * Filtering, search and paging run in Postgres. tracking_hash and search are never fetched.
 */
import type { Status } from '../shared/domain';
import type { Database } from '../shared/database.types';
import { supabase } from './supabase';

type Tables = Database['public']['Tables'];
export type HrReport = Omit<Tables['hr_reports']['Row'], 'search' | 'tracking_hash'>;
export type HrNote = Tables['hr_notes']['Row'];
export type HrMember = Tables['hr_staff']['Row'];

export const HR_COLUMNS =
  'id, created_at, updated_at, full_name, contact, body, status, public_reply, deleted_at' as const;
export const HR_PAGE_SIZE = 25;

export interface HrFilters {
  q: string;
  statuses: Status[];
  trash: boolean;
}
export const EMPTY_HR_FILTERS: HrFilters = { q: '', statuses: [], trash: false };

class HrDataError extends Error {}
function check<T>(r: { data: T | null; error: { message: string; hint?: string | null } | null }): T {
  if (r.error)
    throw new HrDataError(r.error.hint === 'last_hr' ? 'You can’t remove the last HR member.' : r.error.message);
  return r.data as T;
}

function applyHrFilters(query: any, f: HrFilters) {
  let q = query;
  q = f.trash ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  if (f.statuses.length) q = q.in('status', f.statuses);
  if (f.q.trim()) q = q.textSearch('search', f.q.trim(), { type: 'websearch', config: 'english' });
  return q.order('created_at', { ascending: false });
}

export async function listHrReports(f: HrFilters, page: number) {
  const from = page * HR_PAGE_SIZE;
  const r = await applyHrFilters(supabase.from('hr_reports').select(HR_COLUMNS, { count: 'exact' }), f).range(
    from,
    from + HR_PAGE_SIZE - 1,
  );
  return { rows: check(r) as HrReport[], count: (r.count as number | null) ?? 0 };
}

export async function allHrReports(f: HrFilters = EMPTY_HR_FILTERS): Promise<HrReport[]> {
  const out: HrReport[] = [];
  for (let i = 0; ; i += 1000) {
    const rows = check(
      await applyHrFilters(supabase.from('hr_reports').select(HR_COLUMNS), f).range(i, i + 999),
    ) as HrReport[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function getHrReport(id: string): Promise<HrReport | null> {
  return check(await supabase.from('hr_reports').select(HR_COLUMNS).eq('id', id).maybeSingle()) as HrReport | null;
}

export type HrPatch = Partial<Pick<HrReport, 'status' | 'public_reply' | 'deleted_at'>>;
export async function updateHrReport(id: string, patch: HrPatch): Promise<HrReport> {
  return check(await supabase.from('hr_reports').update(patch).eq('id', id).select(HR_COLUMNS).single()) as HrReport;
}

export async function listHrNotes(reportId: string): Promise<HrNote[]> {
  return check(await supabase.from('hr_notes').select('*').eq('report_id', reportId).order('created_at'));
}
export async function addHrNote(reportId: string, body: string): Promise<HrNote> {
  // author_email is set by a database trigger from the session.
  return check(await supabase.from('hr_notes').insert({ report_id: reportId, body }).select('*').single());
}
export async function deleteHrNote(id: string): Promise<void> {
  check(await supabase.from('hr_notes').delete().eq('id', id));
}

export async function hrHardDelete(id: string): Promise<void> {
  check(await supabase.rpc('hr_hard_delete', { p_id: id }));
}

export async function listHrStaff(): Promise<HrMember[]> {
  return check(await supabase.from('hr_staff').select('*').order('created_at'));
}
export async function addHrStaff(email: string): Promise<void> {
  check(await supabase.from('hr_staff').insert({ email: email.trim().toLowerCase() }));
}
export async function removeHrStaff(email: string): Promise<void> {
  check(await supabase.from('hr_staff').delete().eq('email', email));
}

export async function hrLogExport(format: 'xlsx' | 'backup_json', rowCount: number) {
  check(await supabase.rpc('hr_log_export', { p_format: format, p_row_count: rowCount }));
}

/** Non-deleted reports and their notes, for the HR JSON backup. */
export async function hrBackup() {
  const reports = await allHrReports();
  const notes: HrNote[] = [];
  for (let i = 0; ; i += 1000) {
    const rows = check(
      await supabase
        .from('hr_notes')
        .select('*')
        .order('created_at')
        .range(i, i + 999),
    );
    notes.push(...rows);
    if (rows.length < 1000) break;
  }
  const live = new Set(reports.map((r) => r.id));
  return { reports, notes: notes.filter((n) => live.has(n.report_id)) };
}

export async function amIHr(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_hr');
  return !error && data === true;
}
