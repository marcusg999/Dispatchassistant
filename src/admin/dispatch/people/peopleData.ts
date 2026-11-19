/** Extra data helpers for the people/crew screens (office incidents list, audit module filter). */
import { supabase } from '../../supabase';
import type { Incident } from '../data';

export type IncidentListRow = Incident & { job: { job_number: string; title: string } | null };

export async function listIncidents(status: string | null): Promise<IncidentListRow[]> {
  let q = (supabase as unknown as { from: (t: string) => any })
    .from('incident_reports')
    .select('*, job:jobs(job_number, title)')
    .order('occurred_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as IncidentListRow[];
}

export type AuditModule = 'all' | 'suggestions' | 'dispatch' | 'hr';
export const AUDIT_MODULE_PAGE = 50;

/** Audit rows filtered by module (action prefix). RLS decides which rows exist at all. */
export async function listAuditByModule(page: number, module: AuditModule) {
  let q = supabase.from('audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (module === 'dispatch') q = q.like('action', 'dispatch\\_%');
  else if (module === 'hr') q = q.like('action', 'hr\\_%');
  else if (module === 'suggestions') q = q.not('action', 'like', 'dispatch\\_%').not('action', 'like', 'hr\\_%');
  const r = await q.range(page * AUDIT_MODULE_PAGE, page * AUDIT_MODULE_PAGE + AUDIT_MODULE_PAGE - 1);
  if (r.error) throw new Error(r.error.message);
  return { rows: r.data ?? [], count: r.count ?? 0 };
}
