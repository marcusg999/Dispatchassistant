/**
 * Dispatch data layer. Every call runs as the signed-in user under RLS:
 * office roles read tables directly; crew only through the my_* / crew_* RPCs.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Database } from '../../shared/database.types';
import type { StaffRole, SummaryJob } from '../../shared/dispatch';
import { supabase } from '../supabase';

type T = Database['public']['Tables'];
export type Job = T['jobs']['Row'];
export type JobStop = T['job_stops']['Row'];
export type JobItem = T['job_items']['Row'];
export type CrewMember = T['crew_members']['Row'];
export type CrewCert = T['crew_certifications']['Row'];
export type TimeOff = T['time_off']['Row'];
export type Asset = T['assets']['Row'];
export type Assignment = T['job_assignments']['Row'];
export type JobAsset = T['job_assets']['Row'];
export type ChecklistItem = T['job_checklist_items']['Row'];
export type ChecklistTemplate = T['checklist_templates']['Row'];
export type Incident = T['incident_reports']['Row'];
export type StaffRoleRow = T['staff_roles']['Row'];
export type Skill = T['skills']['Row'];
export type CertType = T['certification_types']['Row'];
export interface Conflict {
  job_id?: string;
  code: string;
  message: string;
  crew_member_id: string | null;
  asset_id: string | null;
}

export class DispatchError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
/** Thrown when an optimistic-lock update finds a newer version. */
export class StaleJobError extends DispatchError {
  constructor() {
    super('Someone else changed this job. Refresh to see the latest version.', 'stale');
  }
}

function check<D>(r: { data: D | null; error: { message: string; hint?: string | null; code?: string } | null }): D {
  if (r.error) throw new DispatchError(r.error.hint === 'last_admin' ? 'You can’t remove the last admin.' : r.error.message, r.error.code);
  return r.data as D;
}

// ── Role ─────────────────────────────────────────────────────────────────────
export async function myStaffRole(): Promise<StaffRole | null> {
  const { data, error } = await supabase.rpc('my_staff_role');
  return error ? null : ((data as StaffRole | null) ?? null);
}

// ── Lookups ──────────────────────────────────────────────────────────────────
export const listSkills = async () => check(await supabase.from('skills').select('*').order('position'));
export const listCertTypes = async () => check(await supabase.from('certification_types').select('*').order('position'));
export const appTimeZone = async (): Promise<string> => {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'timezone').maybeSingle();
  return data?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
};

// ── Board ────────────────────────────────────────────────────────────────────
export interface BoardData {
  jobs: (Job & { stops: JobStop[]; items: JobItem[]; checklist: ChecklistItem[] })[];
  assignments: Assignment[];
  jobAssets: JobAsset[];
  crew: (CrewMember & { skills: string[]; certs: CrewCert[] })[];
  assets: Asset[];
  timeOff: TimeOff[];
  conflicts: Conflict[];
}

/** Everything the day/week board needs for [from, to). */
export async function loadBoard(from: Date, to: Date): Promise<BoardData> {
  const f = from.toISOString();
  const t = to.toISOString();
  const jobsQ = supabase
    .from('jobs')
    .select('*, stops:job_stops(*), items:job_items(*), checklist:job_checklist_items(*)')
    .is('deleted_at', null)
    .lt('start_at', t)
    .gt('end_at', f)
    .order('start_at');
  const [jobs, crew, assets, timeOff, conflicts] = await Promise.all([
    jobsQ,
    supabase.from('crew_members').select('*, skills:crew_skills(skill), certs:crew_certifications(*)').order('display_name'),
    supabase.from('assets').select('*').order('name'),
    supabase
      .from('time_off')
      .select('*')
      .lte('start_date', t.slice(0, 10))
      .gte('end_date', f.slice(0, 10)),
    supabase.rpc('board_conflicts', { p_from: f, p_to: t }),
  ]);
  const jobRows = check(jobs) as BoardData['jobs'];
  const ids = jobRows.map((j) => j.id);
  const [assignments, jobAssets] = ids.length
    ? await Promise.all([
        supabase.from('job_assignments').select('*').in('job_id', ids),
        supabase.from('job_assets').select('*').in('job_id', ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  for (const j of jobRows) {
    j.stops.sort((a, b) => a.position - b.position);
    j.items.sort((a, b) => a.position - b.position);
    j.checklist.sort((a, b) => a.position - b.position);
  }
  return {
    jobs: jobRows,
    assignments: check(assignments) as Assignment[],
    jobAssets: check(jobAssets) as JobAsset[],
    crew: (check(crew) as (CrewMember & { skills: { skill: string }[]; certs: CrewCert[] })[]).map((c) => ({
      ...c,
      skills: c.skills.map((s) => s.skill),
    })),
    assets: check(assets),
    timeOff: check(timeOff),
    conflicts: (check(conflicts) ?? []) as Conflict[],
  };
}

export async function jobConflicts(jobId: string): Promise<Conflict[]> {
  return (check(await supabase.rpc('job_conflicts', { p_job: jobId })) ?? []) as Conflict[];
}

export async function recordOverride(jobId: string, reason: string) {
  check(await supabase.rpc('record_conflict_override', { p_job: jobId, p_reason: reason }));
}

// ── Assignments (drag and drop / Assign… menu) ───────────────────────────────
export async function assignCrew(jobId: string, crewId: string) {
  check(await supabase.from('job_assignments').insert({ job_id: jobId, crew_member_id: crewId }));
}
export async function unassignCrew(jobId: string, crewId: string) {
  check(await supabase.from('job_assignments').delete().eq('job_id', jobId).eq('crew_member_id', crewId));
}
export async function moveCrew(fromJob: string, toJob: string, crewId: string) {
  await assignCrew(toJob, crewId);
  await unassignCrew(fromJob, crewId);
}
export async function updateAssignment(jobId: string, crewId: string, patch: Partial<Pick<Assignment, 'role_on_job' | 'call_time_override'>>) {
  check(await supabase.from('job_assignments').update(patch).eq('job_id', jobId).eq('crew_member_id', crewId));
}
export async function assignAsset(jobId: string, assetId: string) {
  check(await supabase.from('job_assets').insert({ job_id: jobId, asset_id: assetId }));
}
export async function unassignAsset(jobId: string, assetId: string) {
  check(await supabase.from('job_assets').delete().eq('job_id', jobId).eq('asset_id', assetId));
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
export type JobInput = Pick<
  Job,
  'title' | 'client_name' | 'job_type' | 'status' | 'start_at' | 'end_at' | 'call_time' | 'call_location' | 'team_lead_id' | 'office_notes' | 'crew_notes'
>;

export type IncidentPhoto = T['incident_photos']['Row'];
export interface JobFull extends Job {
  stops: JobStop[];
  items: JobItem[];
  checklist: ChecklistItem[];
  assignments: Assignment[];
  job_assets: JobAsset[];
  incidents: (Incident & { photos: IncidentPhoto[] })[];
}

export async function getJob(id: string): Promise<JobFull | null> {
  const job = check<JobFull | null>(
    await (supabase as unknown as { from: (t: string) => any })
      .from('jobs')
      .select('*, stops:job_stops(*), items:job_items(*), checklist:job_checklist_items(*), assignments:job_assignments(*), job_assets(*), incidents:incident_reports(*, photos:incident_photos(*))')
      .eq('id', id)
      .maybeSingle(),
  );
  if (!job) return null;
  job.stops.sort((a, b) => a.position - b.position);
  job.items.sort((a, b) => a.position - b.position);
  job.checklist.sort((a, b) => a.position - b.position);
  return job;
}

export async function createJob(input: JobInput): Promise<Job> {
  return check(await supabase.from('jobs').insert(input).select('*').single());
}

/** Optimistic locking: only updates if the row still has `version`. */
export async function updateJob(id: string, version: number, patch: Partial<JobInput> & { deleted_at?: string | null }): Promise<Job> {
  const r = await supabase.from('jobs').update(patch).eq('id', id).eq('version', version).select('*');
  const rows = check(r);
  if (!rows.length) throw new StaleJobError();
  return rows[0];
}
export const softDeleteJob = (id: string, version: number) => updateJob(id, version, { deleted_at: new Date().toISOString() });
export async function hardDeleteJob(id: string) {
  check(await supabase.from('jobs').delete().eq('id', id));
}

/** Copy a job (stops, items, crew, assets) to a new start time; status becomes draft. */
export async function duplicateJob(id: string, newStart: Date): Promise<Job> {
  const src = await getJob(id);
  if (!src) throw new DispatchError('Job not found.');
  const shift = newStart.getTime() - new Date(src.start_at).getTime();
  const sh = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + shift).toISOString() : null);
  const job = await createJob({
    title: src.title,
    client_name: src.client_name,
    job_type: src.job_type,
    status: 'draft',
    start_at: sh(src.start_at)!,
    end_at: sh(src.end_at)!,
    call_time: sh(src.call_time),
    call_location: src.call_location,
    team_lead_id: src.team_lead_id,
    office_notes: src.office_notes,
    crew_notes: src.crew_notes,
  });
  if (src.stops.length)
    check(await supabase.from('job_stops').insert(src.stops.map(({ id: _i, job_id: _j, ...s }) => ({ ...s, job_id: job.id, window_start: sh(s.window_start), window_end: sh(s.window_end) }))));
  if (src.items.length)
    check(await supabase.from('job_items').insert(src.items.map(({ id: _i, job_id: _j, created_at: _c, ...it }) => ({ ...it, job_id: job.id }))));
  if (src.assignments.length)
    check(await supabase.from('job_assignments').insert(src.assignments.map((a) => ({ job_id: job.id, crew_member_id: a.crew_member_id, role_on_job: a.role_on_job, call_time_override: sh(a.call_time_override) }))));
  if (src.job_assets.length) check(await supabase.from('job_assets').insert(src.job_assets.map((a) => ({ job_id: job.id, asset_id: a.asset_id }))));
  return job;
}

export async function saveStops(jobId: string, stops: Omit<JobStop, 'id' | 'job_id'>[]) {
  check(await supabase.from('job_stops').delete().eq('job_id', jobId));
  if (stops.length) check(await supabase.from('job_stops').insert(stops.map((s, i) => ({ ...s, job_id: jobId, position: i }))));
}
export async function saveItems(jobId: string, items: (Omit<JobItem, 'id' | 'job_id' | 'created_at'> & { id?: string })[]) {
  const keep = items.filter((i) => i.id).map((i) => i.id!);
  const del = supabase.from('job_items').delete().eq('job_id', jobId);
  check(await (keep.length ? del.not('id', 'in', `(${keep.join(',')})`) : del));
  for (const [i, it] of items.entries()) {
    const row = { ...it, job_id: jobId, position: i };
    if (it.id) check(await supabase.from('job_items').update(row).eq('id', it.id));
    else check(await supabase.from('job_items').insert(row));
  }
}
export async function setChecklistItem(id: string, checked: boolean) {
  check(await supabase.from('job_checklist_items').update({ checked_at: checked ? new Date().toISOString() : null }).eq('id', id));
}
export async function addChecklistItem(jobId: string, label: string, position: number) {
  check(await supabase.from('job_checklist_items').insert({ job_id: jobId, label, position }));
}
export async function deleteChecklistItem(id: string) {
  check(await supabase.from('job_checklist_items').delete().eq('id', id));
}

// ── Crew / assets / time off ─────────────────────────────────────────────────
export async function listCrew() {
  return (check(await supabase.from('crew_members').select('*, skills:crew_skills(skill), certs:crew_certifications(*)').order('display_name')) as (CrewMember & { skills: { skill: string }[]; certs: CrewCert[] })[]).map((c) => ({ ...c, skills: c.skills.map((s) => s.skill) }));
}
export type CrewInput = Pick<CrewMember, 'display_name' | 'phone' | 'email' | 'position' | 'lift_capacity_lbs' | 'sms_opt_in' | 'sms_opt_in_method' | 'office_notes'>;
export async function saveCrew(id: string | null, input: CrewInput & { active?: boolean }, skills: string[]): Promise<CrewMember> {
  const row: CrewMember = id
    ? check(await supabase.from('crew_members').update(input).eq('id', id).select('*').single())!
    : check(await supabase.from('crew_members').insert(input).select('*').single())!;
  check(await supabase.from('crew_skills').delete().eq('crew_member_id', row.id));
  if (skills.length) check(await supabase.from('crew_skills').insert(skills.map((skill) => ({ crew_member_id: row.id, skill }))));
  return row;
}
export async function setCrewActive(id: string, active: boolean) {
  check(await supabase.from('crew_members').update({ active }).eq('id', id));
}
export async function addCert(crewId: string, type: string, expires_on: string | null) {
  check(await supabase.from('crew_certifications').insert({ crew_member_id: crewId, type, expires_on }));
}
export async function deleteCert(id: string) {
  check(await supabase.from('crew_certifications').delete().eq('id', id));
}

export const listAssets = async () => check(await supabase.from('assets').select('*').order('name'));
export type AssetInput = Pick<Asset, 'kind' | 'name' | 'capabilities' | 'length_ft' | 'status' | 'notes'>;
export async function saveAsset(id: string | null, input: AssetInput & { active?: boolean }): Promise<Asset> {
  return id
    ? check(await supabase.from('assets').update(input).eq('id', id).select('*').single())
    : check(await supabase.from('assets').insert(input).select('*').single());
}

export async function listTimeOff(from: string, to: string) {
  return check(await supabase.from('time_off').select('*').lte('start_date', to).gte('end_date', from).order('start_date'));
}
export type TimeOffInput = Pick<TimeOff, 'crew_member_id' | 'start_date' | 'end_date' | 'start_time' | 'end_time' | 'note'>;
export async function addTimeOff(input: TimeOffInput) {
  check(await supabase.from('time_off').insert(input));
}
export async function deleteTimeOff(id: string) {
  check(await supabase.from('time_off').delete().eq('id', id));
}

// ── Incidents (office) ───────────────────────────────────────────────────────
export async function updateIncident(id: string, patch: Partial<Pick<Incident, 'status' | 'office_followup'>>) {
  check(await supabase.from('incident_reports').update(patch).eq('id', id));
}
export async function incidentPhotoUrl(path: string) {
  const { data, error } = await supabase.storage.from('incident-photos').createSignedUrl(path, 300);
  if (error || !data) throw new DispatchError('Couldn’t load the photo.');
  return data.signedUrl;
}

/** Upload one photo (already EXIF-scrubbed in the browser) through the incident-photo function. */
export async function uploadIncidentPhoto(incidentId: string, photo: Blob) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new DispatchError('Please sign in again.');
  const form = new FormData();
  form.set('incident_id', incidentId);
  form.set('photo', photo, photo.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
  const res = await fetch('/api/incident-photo', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new DispatchError(body?.error ?? 'Couldn’t upload the photo.');
  }
}

// ── Crew self-service ────────────────────────────────────────────────────────
export interface MyJob extends Omit<SummaryJob, 'crew' | 'office_notes'> {
  id: string;
  is_lead: boolean;
  teammates: { name: string; phone: string | null; role_on_job: string | null; is_lead: boolean; is_me: boolean }[];
  items: (SummaryJob['items'][number] & { id: string; artist_title: string | null; medium: string | null })[];
  checklist: { id: string; label: string; checked_at: string | null }[];
}
export async function myJobs(from: string, to: string): Promise<MyJob[]> {
  return (check(await supabase.rpc('my_jobs', { p_from: from, p_to: to })) ?? []) as unknown as MyJob[];
}
export async function crewSetChecklist(itemId: string, checked: boolean) {
  check(await supabase.rpc('crew_set_checklist', { p_item: itemId, p_checked: checked }));
}
export interface CrewIncidentInput {
  job_id: string;
  job_item_id: string | null;
  occurred_at: string;
  handlers_involved: string;
  description: string;
  supervisor_notified: boolean;
  supervisor_name: string;
  fragments_retained: boolean;
  packing_kept: boolean;
}
export async function crewReportIncident(i: CrewIncidentInput): Promise<string> {
  return check(
    await supabase.rpc('crew_report_incident', {
      p_job: i.job_id,
      p_item: i.job_item_id as string,
      p_occurred_at: i.occurred_at,
      p_handlers: i.handlers_involved,
      p_description: i.description,
      p_supervisor_notified: i.supervisor_notified,
      p_supervisor_name: i.supervisor_name,
      p_fragments: i.fragments_retained,
      p_packing: i.packing_kept,
    }),
  ) as string;
}
export async function myIncidents() {
  return (check(await supabase.rpc('my_incidents')) ?? []) as { id: string; job_number: string; occurred_at: string; description: string; status: string; created_at: string }[];
}

// ── Staff roles (admin) ──────────────────────────────────────────────────────
export const listStaffRoles = async () => check(await supabase.from('staff_roles').select('*').order('role').order('email'));
export async function setStaffRole(email: string, role: StaffRole) {
  const e = email.trim().toLowerCase();
  const existing = check(await supabase.from('staff_roles').select('email').eq('email', e).maybeSingle());
  if (existing) check(await supabase.from('staff_roles').update({ role }).eq('email', e));
  else check(await supabase.from('staff_roles').insert({ email: e, role }));
}
export async function removeStaffRole(email: string) {
  check(await supabase.from('staff_roles').delete().eq('email', email));
}

// ── Exports + realtime ───────────────────────────────────────────────────────
export async function logDispatchExport(format: 'xlsx' | 'docx' | 'print', scope: object, includeOfficeNotes: boolean) {
  check(await supabase.rpc('log_dispatch_export', { p_format: format, p_scope: scope as never, p_include_office_notes: includeOfficeNotes }));
}

/** Live updates for the board. RLS applies to what each subscriber receives. */
export function subscribeBoard(onChange: () => void): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const ping = () => {
    clearTimeout(t);
    t = setTimeout(onChange, 250);
  };
  const ch: RealtimeChannel = supabase.channel(`board-${Math.random().toString(36).slice(2)}`);
  for (const table of ['jobs', 'job_assignments', 'job_assets', 'time_off'] as const)
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, ping);
  ch.subscribe();
  return () => {
    clearTimeout(t);
    void supabase.removeChannel(ch);
  };
}
