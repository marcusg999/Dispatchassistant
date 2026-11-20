/**
 * The single dispatch-sheet model. Print, Word, Excel and buildJobSummary (future SMS)
 * all read SheetJob, so they always show the same content.
 * Pure functions: no Supabase, no DOM.
 */
import type { AssetKind, JobStatus, JobType, StopKind, SummaryJob } from '../../../shared/dispatch';

export interface SheetJob extends SummaryJob {
  id: string;
  status: JobStatus;
  checklist: { label: string; checked: boolean }[];
}

interface JobLike {
  id: string;
  job_number: string;
  title: string;
  job_type: string;
  status: string;
  start_at: string;
  end_at: string;
  call_time: string | null;
  call_location: string | null;
  team_lead_id: string | null;
  crew_notes: string | null;
  office_notes: string | null;
  deleted_at?: string | null;
  stops: {
    position: number;
    kind: string;
    site_name: string | null;
    address: string;
    contact_name: string | null;
    contact_phone: string | null;
    window_start: string | null;
    window_end: string | null;
    access_flags: string[];
    access_notes: string | null;
  }[];
  items: {
    position: number;
    description: string;
    quantity: number;
    height_in: number | null;
    width_in: number | null;
    depth_in: number | null;
    weight_lbs: number | null;
    packing: string | null;
    handling_flags: string[];
  }[];
  checklist: { position: number; label: string; checked_at: string | null }[];
}
interface AssignmentLike {
  job_id: string;
  crew_member_id: string;
  role_on_job: string | null;
  call_time_override: string | null;
}
interface CrewLike {
  id: string;
  display_name: string;
  phone: string | null;
}
interface AssetLike {
  id: string;
  kind: string;
  name: string;
}

export interface SheetSources {
  assignments: AssignmentLike[];
  jobAssets: { job_id: string; asset_id: string }[];
  crew: CrewLike[];
  assets: AssetLike[];
}

export interface SheetOptions {
  includeOfficeNotes?: boolean;
}

const byPos = <T extends { position: number }>(a: T[]) => [...a].sort((x, y) => x.position - y.position);

export function toSheetJob(job: JobLike, src: SheetSources, opts: SheetOptions = {}): SheetJob {
  const crewById = new Map(src.crew.map((c) => [c.id, c]));
  const assetById = new Map(src.assets.map((a) => [a.id, a]));
  const lead = job.team_lead_id ? crewById.get(job.team_lead_id) : undefined;
  const crew = src.assignments
    .filter((a) => a.job_id === job.id)
    .map((a) => {
      const c = crewById.get(a.crew_member_id);
      return {
        id: a.crew_member_id,
        name: c?.display_name ?? 'Unknown',
        phone: c?.phone ?? null,
        role_on_job: a.role_on_job ?? (a.crew_member_id === job.team_lead_id ? 'Lead' : null),
        call_time_override: a.call_time_override,
      };
    })
    .sort((a, b) => (a.id === job.team_lead_id ? -1 : b.id === job.team_lead_id ? 1 : a.name.localeCompare(b.name)));
  const assets = src.jobAssets
    .filter((x) => x.job_id === job.id)
    .map((x) => assetById.get(x.asset_id))
    .filter((a): a is AssetLike => !!a)
    .map((a) => ({ kind: a.kind as AssetKind, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: job.id,
    job_number: job.job_number,
    title: job.title,
    job_type: job.job_type as JobType,
    status: job.status as JobStatus,
    start_at: job.start_at,
    end_at: job.end_at,
    call_time: job.call_time,
    call_location: job.call_location,
    crew_notes: job.crew_notes,
    office_notes: opts.includeOfficeNotes ? job.office_notes : null,
    team_lead: lead ? { name: lead.display_name, phone: lead.phone } : null,
    crew,
    assets,
    stops: byPos(job.stops).map((s) => ({
      kind: s.kind as StopKind,
      site_name: s.site_name,
      address: s.address,
      contact_name: s.contact_name,
      contact_phone: s.contact_phone,
      window_start: s.window_start,
      window_end: s.window_end,
      access_flags: s.access_flags ?? [],
      access_notes: s.access_notes,
    })),
    items: byPos(job.items).map((i) => ({
      description: i.description,
      quantity: i.quantity,
      height_in: i.height_in != null ? Number(i.height_in) : null,
      width_in: i.width_in != null ? Number(i.width_in) : null,
      depth_in: i.depth_in != null ? Number(i.depth_in) : null,
      weight_lbs: i.weight_lbs != null ? Number(i.weight_lbs) : null,
      packing: i.packing,
      handling_flags: i.handling_flags ?? [],
    })),
    checklist: byPos(job.checklist).map((c) => ({ label: c.label, checked: !!c.checked_at })),
  };
}

/** All printable jobs (not deleted, not cancelled), in start order. */
export function toSheetJobs(jobs: JobLike[], src: SheetSources, opts: SheetOptions = {}): SheetJob[] {
  return jobs
    .filter((j) => !j.deleted_at && j.status !== 'cancelled')
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((j) => toSheetJob(j, src, opts));
}

export const PACKING_LABEL: Record<string, string> = { crated: 'Crated', soft_pack: 'Soft-pack' };
