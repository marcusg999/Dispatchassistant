/**
 * Dispatch vocabulary, validation and the plain-text job summary.
 * Values match the Postgres enums / CHECK lists in supabase/migrations/2026112000080*.
 * Admin-side only (never imported by the portal build).
 */
import * as z from 'zod/mini';

export const JOB_TYPES = ['pickup', 'delivery', 'install', 'deinstall', 'crating', 'shuttle', 'storage_in', 'storage_out', 'site_survey'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABEL: Record<JobType, string> = {
  pickup: 'Pickup',
  delivery: 'Delivery',
  install: 'Install',
  deinstall: 'De-install',
  crating: 'Crating',
  shuttle: 'Shuttle',
  storage_in: 'Storage in',
  storage_out: 'Storage out',
  site_survey: 'Site survey',
};

export const JOB_STATUSES = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const CREW_POSITIONS = ['driver', 'art_handler', 'crater', 'installer', 'lead', 'other'] as const;
export type CrewPosition = (typeof CREW_POSITIONS)[number];
export const CREW_POSITION_LABEL: Record<CrewPosition, string> = {
  driver: 'Driver',
  art_handler: 'Art handler',
  crater: 'Crater',
  installer: 'Installer',
  lead: 'Lead',
  other: 'Other',
};

export const ASSET_KINDS = ['truck', 'van', 'trailer', 'equipment'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_KIND_LABEL: Record<AssetKind, string> = { truck: 'Truck', van: 'Van', trailer: 'Trailer', equipment: 'Equipment' };

export const ASSET_STATUSES = ['in_service', 'out_of_service', 'maintenance'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  in_service: 'In service',
  out_of_service: 'Out of service',
  maintenance: 'Maintenance',
};

export const ASSET_CAPABILITIES = [
  'air_ride', 'climate_controlled', 'liftgate', 'gps_tracked', 'panel_cart', 'a_frame', 'gantry', 'lift', 'forklift', 'pallet_jack', 'requires_cdl',
] as const;
export type AssetCapability = (typeof ASSET_CAPABILITIES)[number];
export const ASSET_CAPABILITY_LABEL: Record<AssetCapability, string> = {
  air_ride: 'Air-ride',
  climate_controlled: 'Climate-controlled',
  liftgate: 'Liftgate',
  gps_tracked: 'GPS-tracked',
  panel_cart: 'Panel cart',
  a_frame: 'A-frame',
  gantry: 'Gantry',
  lift: 'Lift',
  forklift: 'Forklift',
  pallet_jack: 'Pallet jack',
  requires_cdl: 'Requires CDL',
};

/** Handling flags: every flag has a short code shown in a badge, so color is never the only signal. */
export const HANDLING_FLAGS = ['upright', 'top_heavy', 'fragile', 'glass', 'loose_parts', 'keep_flat', 'no_stack', 'climate_sensitive', 'two_person'] as const;
export type HandlingFlag = (typeof HANDLING_FLAGS)[number];
export const HANDLING_FLAG: Record<HandlingFlag, { label: string; glyph: string }> = {
  upright: { label: 'Must ride upright', glyph: '↑' },
  top_heavy: { label: 'Top-heavy', glyph: '▲' },
  fragile: { label: 'Fragile / sensitive medium', glyph: '!' },
  glass: { label: 'Glass or glazed', glyph: '◇' },
  loose_parts: { label: 'Loose parts packed separately', glyph: '⁂' },
  keep_flat: { label: 'Keep flat', glyph: '▬' },
  no_stack: { label: 'Do not stack', glyph: '⊘' },
  climate_sensitive: { label: 'Climate sensitive', glyph: '❄' },
  two_person: { label: 'Two-person minimum', glyph: '2' },
};

export const ACCESS_FLAGS = [
  'loading_dock', 'stairs', 'freight_elevator', 'elevator_reservation', 'coi_required', 'street_parking_only', 'security_checkin', 'timed_access',
] as const;
export type AccessFlag = (typeof ACCESS_FLAGS)[number];
export const ACCESS_FLAG_LABEL: Record<AccessFlag, string> = {
  loading_dock: 'Loading dock',
  stairs: 'Stairs',
  freight_elevator: 'Freight elevator',
  elevator_reservation: 'Elevator reservation needed',
  coi_required: 'COI required',
  street_parking_only: 'Street parking only',
  security_checkin: 'Security check-in',
  timed_access: 'Timed access',
};

export const STOP_KINDS = ['origin', 'destination', 'stop'] as const;
export type StopKind = (typeof STOP_KINDS)[number];
export const STOP_KIND_LABEL: Record<StopKind, string> = { origin: 'Origin', destination: 'Destination', stop: 'Stop' };

export const INCIDENT_STATUSES = ['open', 'under_review', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = { open: 'Open', under_review: 'Under review', closed: 'Closed' };

export const CONFLICT_LABEL: Record<string, string> = {
  crew_overlap: 'Crew double-booked',
  crew_time_off: 'Crew unavailable',
  asset_double_booked: 'Asset double-booked',
  asset_unavailable: 'Asset unavailable',
  two_person_short: 'Needs 2+ crew',
  skill_missing: 'Missing skill',
  cert_expired: 'Expired certification',
  checklist_incomplete: 'Checklist open',
};

export const STAFF_ROLES = ['admin', 'estimator', 'dispatcher', 'viewer', 'crew'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Where each role lands after sign-in. HR-only users go to the HR inbox. */
export function homeFor(role: StaffRole | null, isHr: boolean): string {
  if (role === 'admin') return '/admin';
  if (role === 'dispatcher' || role === 'viewer') return '/admin/dispatch';
  if (role === 'crew') return '/admin/my-jobs';
  if (role === 'estimator') return '/admin/estimates';
  return isHr ? '/admin/hr' : '/admin';
}

/** Is `path` allowed for this role? (UX only; RLS is the real gate.) */
export function routeAllowed(path: string, role: StaffRole | null, isHr: boolean): boolean {
  if (path === '/admin/account') return role !== null || isHr;
  if (path.startsWith('/admin/hr')) return isHr;
  if (path === '/admin/my-jobs' || path.startsWith('/admin/my-jobs/')) return role === 'crew';
  if (path === '/admin/dispatch/roles') return role === 'admin';
  if (path.startsWith('/admin/dispatch')) return role === 'admin' || role === 'dispatcher' || role === 'viewer';
  // Phase 3 estimates: money is visible to admins and estimators only.
  if (path === '/admin/estimates/approvals' || path === '/admin/estimates/rules' || path === '/admin/estimates/terms') return role === 'admin';
  if (path === '/admin/estimates' || path.startsWith('/admin/estimates/')) return role === 'admin' || role === 'estimator';
  if (path === '/admin/audit') return role === 'admin' || isHr;
  // Phase 1 suggestion-box console: admins only.
  return role === 'admin';
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Normalizes US-style input to E.164 (+1XXXXXXXXXX). Returns null if it can't. */
export function toE164(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

const e164 = z.string().check(z.regex(/^\+[1-9]\d{7,14}$/, 'Use a full phone number, e.g. +1 323 555 1234.'));
const optText = (max: number) => z.optional(z.nullable(z.string().check(z.maxLength(max))));
const dim = (label: string) =>
  z.optional(z.nullable(z.number(`${label} must be a number.`).check(z.gt(0, `${label} must be more than 0.`), z.lte(1200, `${label} must be 1,200 in or less.`))));

export const jobItemSchema = z.object({
  description: z.string().check(z.trim(), z.minLength(2, 'Describe the item.'), z.maxLength(300)),
  artist_title: optText(200),
  medium: optText(120),
  height_in: dim('Height'),
  width_in: dim('Width'),
  depth_in: dim('Depth'),
  weight_lbs: z.optional(z.nullable(z.number('Weight must be a number.').check(z.gt(0, 'Weight must be more than 0.'), z.lte(40000, 'Weight must be 40,000 lb or less.')))),
  quantity: z.number().check(z.int('Quantity must be a whole number.'), z.gte(1, 'Quantity must be at least 1.'), z.lte(999)),
  packing: z.optional(z.nullable(z.enum(['crated', 'soft_pack']))),
  handling_flags: z.array(z.enum(HANDLING_FLAGS)),
});

export const jobStopSchema = z.object({
  kind: z.enum(STOP_KINDS),
  site_name: optText(140),
  address: z.string().check(z.trim(), z.minLength(3, 'Enter an address.'), z.maxLength(300)),
  contact_name: optText(100),
  contact_phone: z.optional(z.nullable(e164)),
  window_start: z.optional(z.nullable(z.string())),
  window_end: z.optional(z.nullable(z.string())),
  access_flags: z.array(z.enum(ACCESS_FLAGS)),
  access_notes: optText(2000),
});

export const jobSchema = z
  .object({
    title: z.string().check(z.trim(), z.minLength(2, 'Give the job a title.'), z.maxLength(140)),
    client_name: optText(140),
    job_type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES),
    start_at: z.string().check(z.minLength(1, 'Pick a start time.')),
    end_at: z.string().check(z.minLength(1, 'Pick an end time.')),
    call_time: z.optional(z.nullable(z.string())),
    call_location: optText(200),
    team_lead_id: z.optional(z.nullable(z.string())),
    office_notes: optText(4000),
    crew_notes: optText(4000),
  })
  .check(
    z.refine((j) => !j.start_at || !j.end_at || new Date(j.end_at) > new Date(j.start_at), {
      message: 'End must be after start.',
      path: ['end_at'],
    }),
  );

export const crewMemberSchema = z.object({
  display_name: z.string().check(z.trim(), z.minLength(2, 'Enter a name.'), z.maxLength(80)),
  phone: z.optional(z.nullable(e164)),
  email: z.optional(z.nullable(z.string().check(z.trim(), z.toLowerCase(), z.regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email.')))),
  position: z.enum(CREW_POSITIONS),
  lift_capacity_lbs: z.optional(z.nullable(z.number().check(z.int(), z.gte(0), z.lte(500, 'Lift capacity must be 500 lb or less.')))),
  sms_opt_in: z.boolean(),
  sms_opt_in_method: optText(120),
  office_notes: optText(4000),
});

export const timeOffSchema = z
  .object({
    crew_member_id: z.string().check(z.minLength(1, 'Pick a crew member.')),
    start_date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date.')),
    end_date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an end date.')),
    start_time: z.optional(z.nullable(z.string())),
    end_time: z.optional(z.nullable(z.string())),
    note: optText(500),
  })
  .check(z.refine((t) => t.end_date >= t.start_date, { message: 'End date must be on or after the start date.', path: ['end_date'] }));

export const incidentSchema = z.object({
  occurred_at: z.string().check(z.minLength(1, 'When did it happen?')),
  job_item_id: z.optional(z.nullable(z.string())),
  handlers_involved: optText(500),
  description: z.string().check(z.trim(), z.minLength(10, 'Describe what happened (at least 10 characters).'), z.maxLength(4000)),
  supervisor_notified: z.boolean(),
  supervisor_name: optText(100),
  fragments_retained: z.boolean(),
  packing_kept: z.boolean(),
});

export function issues(r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): Record<string, string> {
  const out: Record<string, string> = {};
  if (r.success || !r.error) return out;
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? '_');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

// ── Plain-text job summary (printable sheet now; SMS in a future phase) ──────

export interface SummaryJob {
  job_number: string;
  title: string;
  job_type: JobType;
  status?: JobStatus;
  start_at: string;
  end_at: string;
  call_time?: string | null;
  call_location?: string | null;
  crew_notes?: string | null;
  office_notes?: string | null;
  team_lead?: { name: string; phone?: string | null } | null;
  crew: { id?: string; name: string; phone?: string | null; role_on_job?: string | null; call_time_override?: string | null }[];
  assets: { kind: AssetKind; name: string }[];
  stops: {
    kind: StopKind;
    site_name?: string | null;
    address: string;
    contact_name?: string | null;
    contact_phone?: string | null;
    window_start?: string | null;
    window_end?: string | null;
    access_flags: string[];
    access_notes?: string | null;
  }[];
  items: {
    description: string;
    quantity: number;
    height_in?: number | null;
    width_in?: number | null;
    depth_in?: number | null;
    weight_lbs?: number | null;
    packing?: string | null;
    handling_flags: string[];
  }[];
}

export interface SummaryOptions {
  /** Personalize the call time for one crew member (uses their override). */
  forCrewMember?: string;
  includeOfficeNotes?: boolean;
  timeZone?: string;
  locale?: string;
}

export function fmtTime(iso: string | null | undefined, tz?: string, locale = 'en-US'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz });
}
export function fmtDay(iso: string, tz?: string, locale = 'en-US'): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
}
export function dims(i: SummaryJob['items'][number]): string {
  const d = [i.height_in, i.width_in, i.depth_in].filter((x) => x != null);
  const size = d.length === 3 ? `${d.join(' × ')} in` : '';
  const wt = i.weight_lbs != null ? `${i.weight_lbs} lb` : '';
  return [size, wt].filter(Boolean).join(', ');
}

/** One job as plain text. Same content the printable sheet shows; future SMS reuses it. */
export function buildJobSummary(job: SummaryJob, opts: SummaryOptions = {}): string {
  const tz = opts.timeZone;
  const L: string[] = [];
  const me = opts.forCrewMember ? job.crew.find((c) => c.id === opts.forCrewMember || c.name === opts.forCrewMember) : undefined;
  const call = me?.call_time_override ?? job.call_time;
  L.push(`${job.job_number} · ${JOB_TYPE_LABEL[job.job_type]} · ${job.title}`);
  L.push(`${fmtDay(job.start_at, tz)} ${fmtTime(job.start_at, tz)}–${fmtTime(job.end_at, tz)}`);
  if (call) L.push(`Call: ${fmtTime(call, tz)}${job.call_location ? ` at ${job.call_location}` : ''}`);
  if (job.team_lead) L.push(`Lead: ${job.team_lead.name}${job.team_lead.phone ? ` ${formatPhone(job.team_lead.phone)}` : ''}`);
  if (job.crew.length) L.push(`Crew: ${job.crew.map((c) => c.name + (c.role_on_job ? ` (${c.role_on_job})` : '')).join(', ')}`);
  if (job.assets.length) L.push(`Truck/equipment: ${job.assets.map((a) => a.name).join(', ')}`);
  job.stops.forEach((s, i) => {
    const win = s.window_start ? ` ${fmtTime(s.window_start, tz)}${s.window_end ? `–${fmtTime(s.window_end, tz)}` : ''}` : '';
    L.push(`${i + 1}. ${STOP_KIND_LABEL[s.kind]}${win}: ${s.site_name ? `${s.site_name}, ` : ''}${s.address}`);
    if (s.contact_name || s.contact_phone) L.push(`   Contact: ${[s.contact_name, formatPhone(s.contact_phone)].filter(Boolean).join(' ')}`);
    const flags = s.access_flags.map((f) => ACCESS_FLAG_LABEL[f as AccessFlag] ?? f);
    if (flags.length) L.push(`   Access: ${flags.join(', ')}`);
    if (s.access_notes) L.push(`   Notes: ${s.access_notes}`);
  });
  if (job.items.length) {
    L.push('Items:');
    for (const it of job.items) {
      const flags = it.handling_flags.map((f) => HANDLING_FLAG[f as HandlingFlag]?.label ?? f);
      const d = dims(it);
      L.push(`- ${it.quantity > 1 ? `${it.quantity}× ` : ''}${it.description}${d ? ` (${d})` : ''}${flags.length ? ` [${flags.join('; ')}]` : ''}`);
    }
  }
  if (job.crew_notes) L.push(`Crew notes: ${job.crew_notes}`);
  if (opts.includeOfficeNotes && job.office_notes) L.push(`Office notes: ${job.office_notes}`);
  return L.join('\n');
}
