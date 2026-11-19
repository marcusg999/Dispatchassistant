import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ACCESS_FLAGS,
  ACCESS_FLAG_LABEL,
  HANDLING_FLAGS,
  HANDLING_FLAG,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABEL,
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  JOB_TYPES,
  JOB_TYPE_LABEL,
  STOP_KINDS,
  STOP_KIND_LABEL,
  formatPhone,
  issues,
  jobItemSchema,
  jobSchema,
  jobStopSchema,
  toE164,
  type AccessFlag,
  type HandlingFlag,
  type JobStatus,
  type JobType,
  type StopKind,
} from '../../../shared/dispatch';
import { Link, navigate } from '../../router';
import { Confirm, ErrorNote, fmtDateTime } from '../../components/ui';
import {
  StaleJobError,
  addChecklistItem,
  assignAsset,
  assignCrew,
  createJob,
  deleteChecklistItem,
  duplicateJob,
  getJob,
  hardDeleteJob,
  incidentPhotoUrl,
  jobConflicts,
  listAssets,
  listCrew,
  recordOverride,
  saveItems,
  saveStops,
  setChecklistItem,
  softDeleteJob,
  unassignAsset,
  unassignCrew,
  updateAssignment,
  updateIncident,
  updateJob,
  type Asset,
  type Conflict,
  type JobFull,
} from '../data';
import { ConflictBadges, fromLocalInput, parseYmd, toLocalInput, ymd } from '../ui';
import { OverrideDialog } from '../board/OverrideDialog';

type CrewRow = Awaited<ReturnType<typeof listCrew>>[number];

interface Basics {
  title: string;
  client_name: string;
  job_type: JobType;
  status: JobStatus;
  start_at: string;
  end_at: string;
  call_time: string;
  call_location: string;
  team_lead_id: string;
  crew_notes: string;
  office_notes: string;
}
interface StopForm {
  kind: StopKind;
  site_name: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  window_start: string;
  window_end: string;
  access_flags: AccessFlag[];
  access_notes: string;
}
interface ItemForm {
  id?: string;
  description: string;
  artist_title: string;
  medium: string;
  height_in: string;
  width_in: string;
  depth_in: string;
  weight_lbs: string;
  quantity: string;
  packing: '' | 'crated' | 'soft_pack';
  handling_flags: HandlingFlag[];
}

const emptyStop = (kind: StopKind): StopForm => ({
  kind,
  site_name: '',
  address: '',
  contact_name: '',
  contact_phone: '',
  window_start: '',
  window_end: '',
  access_flags: [],
  access_notes: '',
});
const emptyItem = (): ItemForm => ({
  description: '',
  artist_title: '',
  medium: '',
  height_in: '',
  width_in: '',
  depth_in: '',
  weight_lbs: '',
  quantity: '1',
  packing: '',
  handling_flags: [],
});
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const nn = (s: string) => (s.trim() === '' ? null : s.trim());
const ckey = (c: Conflict) => `${c.code}|${c.message}`;

export function JobEditor(props: { id: string | null; canEdit: boolean; isAdmin: boolean }) {
  // Re-mount when the job id changes (e.g. after creating or duplicating).
  return <Editor key={props.id ?? 'new'} {...props} />;
}

function Editor({ id, canEdit, isAdmin }: { id: string | null; canEdit: boolean; isAdmin: boolean }) {
  const [job, setJob] = useState<JobFull | null>(null);
  const [crew, setCrew] = useState<CrewRow[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [basics, setBasics] = useState<Basics | null>(null);
  const [stops, setStops] = useState<StopForm[]>([]);
  const [items, setItems] = useState<ItemForm[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stopErr, setStopErr] = useState<Record<number, Record<string, string>>>({});
  const [itemErr, setItemErr] = useState<Record<number, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [override, setOverride] = useState<{ conflicts: Conflict[]; undo: (() => Promise<void>) | null } | null>(null);
  const [dialog, setDialog] = useState<'duplicate' | 'trash' | 'delete' | null>(null);
  const [dupDate, setDupDate] = useState('');
  const [typed, setTyped] = useState('');

  async function load(fillForm = true) {
    try {
      const [c, a] = await Promise.all([listCrew(), listAssets()]);
      setCrew(c);
      setAssets(a);
      if (!id) {
        const q = new URLSearchParams(location.search).get('date');
        const d = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? parseYmd(q) : new Date();
        const at = (h: number) => toLocalInput(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString());
        setBasics({
          title: '',
          client_name: '',
          job_type: 'delivery',
          status: 'scheduled',
          start_at: at(8),
          end_at: at(12),
          call_time: at(7),
          call_location: '',
          team_lead_id: '',
          crew_notes: '',
          office_notes: '',
        });
        setStops([emptyStop('origin'), emptyStop('destination')]);
        setItems([]);
        return;
      }
      const [j, cf] = await Promise.all([getJob(id), jobConflicts(id).catch(() => [] as Conflict[])]);
      if (!j) return setNotFound(true);
      setJob(j);
      setConflicts(cf);
      if (fillForm) {
        setBasics({
          title: j.title,
          client_name: j.client_name ?? '',
          job_type: j.job_type,
          status: j.status,
          start_at: toLocalInput(j.start_at),
          end_at: toLocalInput(j.end_at),
          call_time: toLocalInput(j.call_time),
          call_location: j.call_location ?? '',
          team_lead_id: j.team_lead_id ?? '',
          crew_notes: j.crew_notes ?? '',
          office_notes: j.office_notes ?? '',
        });
        setStops(
          j.stops.map((s) => ({
            kind: s.kind,
            site_name: s.site_name ?? '',
            address: s.address,
            contact_name: s.contact_name ?? '',
            contact_phone: s.contact_phone ? formatPhone(s.contact_phone) : '',
            window_start: toLocalInput(s.window_start),
            window_end: toLocalInput(s.window_end),
            access_flags: s.access_flags as AccessFlag[],
            access_notes: s.access_notes ?? '',
          })),
        );
        setItems(
          j.items.map((i) => ({
            id: i.id,
            description: i.description,
            artist_title: i.artist_title ?? '',
            medium: i.medium ?? '',
            height_in: i.height_in?.toString() ?? '',
            width_in: i.width_in?.toString() ?? '',
            depth_in: i.depth_in?.toString() ?? '',
            weight_lbs: i.weight_lbs?.toString() ?? '',
            quantity: String(i.quantity),
            packing: (i.packing ?? '') as ItemForm['packing'],
            handling_flags: i.handling_flags as HandlingFlag[],
          })),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refresh only the server-owned parts (assignments, checklist, incidents, conflicts). */
  async function refreshSide(): Promise<Conflict[]> {
    if (!id) return [];
    const [j, cf] = await Promise.all([getJob(id), jobConflicts(id).catch(() => [] as Conflict[])]);
    if (j) setJob(j);
    setConflicts(cf);
    return cf;
  }

  function validate() {
    const b = basics!;
    const jr = jobSchema.safeParse({
      ...b,
      client_name: nn(b.client_name),
      start_at: fromLocalInput(b.start_at) ?? '',
      end_at: fromLocalInput(b.end_at) ?? '',
      call_time: fromLocalInput(b.call_time),
      call_location: nn(b.call_location),
      team_lead_id: b.team_lead_id || null,
      crew_notes: nn(b.crew_notes),
      office_notes: nn(b.office_notes),
    });
    const je = issues(jr);
    const se: Record<number, Record<string, string>> = {};
    const stopRows = stops.map((s, i) => {
      const phone = s.contact_phone.trim() ? toE164(s.contact_phone) : null;
      const row = {
        kind: s.kind,
        site_name: nn(s.site_name),
        address: s.address.trim(),
        contact_name: nn(s.contact_name),
        contact_phone: phone,
        window_start: fromLocalInput(s.window_start),
        window_end: fromLocalInput(s.window_end),
        access_flags: s.access_flags,
        access_notes: nn(s.access_notes),
        position: i,
      };
      const e = issues(jobStopSchema.safeParse(row));
      if (s.contact_phone.trim() && !phone) e.contact_phone = 'Use a full phone number, e.g. (323) 555-1234.';
      if (Object.keys(e).length) se[i] = e;
      return row;
    });
    const ie: Record<number, Record<string, string>> = {};
    const itemRows = items.map((it, i) => {
      const row = {
        id: it.id,
        description: it.description.trim(),
        artist_title: nn(it.artist_title),
        medium: nn(it.medium),
        height_in: num(it.height_in),
        width_in: num(it.width_in),
        depth_in: num(it.depth_in),
        weight_lbs: num(it.weight_lbs),
        quantity: Number(it.quantity || '0'),
        packing: it.packing || null,
        handling_flags: it.handling_flags,
        position: i,
      };
      const e = issues(jobItemSchema.safeParse(row));
      if (Object.keys(e).length) ie[i] = e;
      return row;
    });
    setErrors(je);
    setStopErr(se);
    setItemErr(ie);
    const ok = !Object.keys(je).length && !Object.keys(se).length && !Object.keys(ie).length;
    return { ok, job: jr.success ? jr.data : null, stopRows, itemRows };
  }

  async function save() {
    setError(null);
    setStatus('');
    const v = validate();
    if (!v.ok || !v.job) {
      setStatus('Please fix the highlighted fields.');
      return;
    }
    setSaving(true);
    const before = new Set(conflicts.map(ckey));
    try {
      const input = {
        title: v.job.title,
        client_name: v.job.client_name ?? null,
        job_type: v.job.job_type,
        status: v.job.status,
        start_at: v.job.start_at,
        end_at: v.job.end_at,
        call_time: v.job.call_time ?? null,
        call_location: v.job.call_location ?? null,
        team_lead_id: v.job.team_lead_id ?? null,
        office_notes: v.job.office_notes ?? null,
        crew_notes: v.job.crew_notes ?? null,
      };
      if (!id) {
        const created = await createJob(input);
        await saveStops(created.id, v.stopRows);
        await saveItems(created.id, v.itemRows);
        navigate(`/admin/dispatch/jobs/${created.id}`);
        return;
      }
      await updateJob(id, job!.version, input);
      await saveStops(id, v.stopRows);
      await saveItems(id, v.itemRows);
      await load(true);
      const after = await jobConflicts(id).catch(() => [] as Conflict[]);
      setConflicts(after);
      setStatus('Saved.');
      const fresh = after.filter((c) => !before.has(ckey(c)));
      if (fresh.length) setOverride({ conflicts: fresh, undo: null });
    } catch (e) {
      if (e instanceof StaleJobError) setStale(true);
      else setError((e as Error).message);
      setStatus('Not saved.');
    } finally {
      setSaving(false);
    }
  }

  /** Immediate assignment changes on a saved job, with the same override rule as the board. */
  async function sideChange(run: () => Promise<void>, undo: () => Promise<void>, msg: string) {
    const before = new Set(conflicts.map(ckey));
    setError(null);
    try {
      await run();
      setStatus(msg);
      const after = await refreshSide();
      const fresh = after.filter((c) => !before.has(ckey(c)));
      if (fresh.length) setOverride({ conflicts: fresh, undo });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (notFound)
    return (
      <div className="a-panel max-w-xl p-6">
        <p>This job doesn’t exist (it may have been deleted).</p>
        <Link href="/admin/dispatch" className="a-btn mt-3 no-underline">
          Back to the board
        </Link>
      </div>
    );
  if (!basics) return <p className="text-muted">{error ?? 'Loading…'}</p>;

  const set = <K extends keyof Basics>(k: K, v: Basics[K]) => setBasics((b) => ({ ...b!, [k]: v }));
  const assignedIds = job?.assignments.map((a) => a.crew_member_id) ?? [];
  const activeCrew = crew.filter((c) => c.active);
  const crewName = (cid: string) => crew.find((c) => c.id === cid)?.display_name ?? 'Unknown';
  const backDate = basics.start_at ? basics.start_at.slice(0, 10) : ymd(new Date());

  return (
    <div className="job-editor">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/admin/dispatch?date=${backDate}`} className="text-[0.8125rem] font-semibold text-muted">
          ← Day board
        </Link>
        <h1 className="mr-auto text-2xl font-[800] tracking-tight">
          {id ? (
            <>
              <span className="stencil mr-2 align-middle text-[0.75rem] text-muted">{job?.job_number}</span>
              {job?.title}
            </>
          ) : (
            'New job'
          )}
        </h1>
        {id && (
          <Link href={`/admin/dispatch/print/${id}`} className="a-btn no-underline">
            Print sheet
          </Link>
        )}
        {canEdit && id && (
          <button className="a-btn" onClick={() => setDialog('duplicate')}>
            Duplicate
          </button>
        )}
        {canEdit && (
          <button className="a-btn a-btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : id ? 'Save changes' : 'Create job'}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-[0.8125rem] font-semibold text-accent-text">
        {status}
      </p>
      {stale && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 border-2 border-danger bg-paper p-3">
          <span className="font-semibold text-danger">Someone else changed this job while you were editing.</span>
          <button
            className="a-btn"
            onClick={() => {
              setStale(false);
              void load(true);
            }}
          >
            Reload latest version
          </button>
          <span className="text-[0.8125rem] text-muted">Your unsaved edits will be replaced.</span>
        </div>
      )}
      <ErrorNote error={error} />
      {job?.deleted_at && <p className="mt-2 border-2 border-danger bg-paper p-3 font-semibold text-danger">This job is in the trash.</p>}
      {conflicts.length > 0 && (
        <section aria-labelledby="cf-h" className="mt-3">
          <h2 id="cf-h" className="a-label">
            Warnings ({conflicts.length})
          </h2>
          <ConflictBadges conflicts={conflicts} detail />
        </section>
      )}

      <fieldset disabled={!canEdit} className="mt-4 min-w-0 border-0 p-0">
        <legend className="sr-only">Job details</legend>
        <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
          <div className="min-w-0 space-y-5">
            <Section title="Basics">
              <div className="grid gap-3 md:grid-cols-2">
                <Field id="j-title" label="Title" error={errors.title} className="md:col-span-2">
                  <input id="j-title" className="a-input" value={basics.title} onChange={(e) => set('title', e.currentTarget.value)} maxLength={140} />
                </Field>
                <Field id="j-client" label="Client">
                  <input id="j-client" className="a-input" value={basics.client_name} onChange={(e) => set('client_name', e.currentTarget.value)} maxLength={140} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="j-type" label="Job type">
                    <select id="j-type" className="a-select" value={basics.job_type} onChange={(e) => set('job_type', e.currentTarget.value as JobType)}>
                      {JOB_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {JOB_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="j-status" label="Status">
                    <select id="j-status" className="a-select" value={basics.status} onChange={(e) => set('status', e.currentTarget.value as JobStatus)}>
                      {JOB_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {JOB_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field id="j-start" label="Start" error={errors.start_at}>
                  <input id="j-start" type="datetime-local" className="a-input" value={basics.start_at} onChange={(e) => set('start_at', e.currentTarget.value)} />
                </Field>
                <Field id="j-end" label="End" error={errors.end_at}>
                  <input id="j-end" type="datetime-local" className="a-input" value={basics.end_at} onChange={(e) => set('end_at', e.currentTarget.value)} />
                </Field>
                <Field id="j-call" label="Crew call time">
                  <input id="j-call" type="datetime-local" className="a-input" value={basics.call_time} onChange={(e) => set('call_time', e.currentTarget.value)} />
                </Field>
                <Field id="j-callloc" label="Call location">
                  <input id="j-callloc" className="a-input" value={basics.call_location} placeholder="e.g. Shop, bay 2" onChange={(e) => set('call_location', e.currentTarget.value)} maxLength={200} />
                </Field>
                <Field id="j-lead" label="Team lead">
                  <select id="j-lead" className="a-select" value={basics.team_lead_id} onChange={(e) => set('team_lead_id', e.currentTarget.value)}>
                    <option value="">None</option>
                    {assignedIds.length > 0 && (
                      <optgroup label="On this job">
                        {assignedIds.map((cid) => (
                          <option key={cid} value={cid}>
                            {crewName(cid)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="All active crew">
                      {activeCrew
                        .filter((c) => !assignedIds.includes(c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.display_name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </Field>
                <Field id="j-crewnotes" label="Crew notes (visible to the assigned crew)" className="md:col-span-2">
                  <textarea id="j-crewnotes" className="a-textarea" value={basics.crew_notes} onChange={(e) => set('crew_notes', e.currentTarget.value)} maxLength={4000} />
                </Field>
                <Field id="j-officenotes" label="Office notes · Office only (never shown to crew)" className="md:col-span-2">
                  <textarea id="j-officenotes" className="a-textarea office-only" value={basics.office_notes} onChange={(e) => set('office_notes', e.currentTarget.value)} maxLength={4000} />
                </Field>
              </div>
            </Section>

            <Section
              title="Stops"
              action={
                canEdit && (
                  <button type="button" className="a-btn a-btn-sm" onClick={() => setStops((s) => [...s, emptyStop(s.length ? 'stop' : 'origin')])}>
                    + Add stop
                  </button>
                )
              }
            >
              {stops.length === 0 && <p className="text-muted">No stops yet.</p>}
              <ol className="space-y-3">
                {stops.map((s, i) => {
                  const e = stopErr[i] ?? {};
                  const up = (patch: Partial<StopForm>) => setStops((all) => all.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                  return (
                    <li key={i} className="stop-card">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="stencil text-[0.6875rem]">Stop {i + 1}</span>
                        <div className="ml-auto flex gap-1">
                          {canEdit && (
                            <>
                              <button type="button" className="a-btn a-btn-sm" disabled={i === 0} onClick={() => setStops((all) => swap(all, i, i - 1))} aria-label={`Move stop ${i + 1} up`}>
                                ↑
                              </button>
                              <button type="button" className="a-btn a-btn-sm" disabled={i === stops.length - 1} onClick={() => setStops((all) => swap(all, i, i + 1))} aria-label={`Move stop ${i + 1} down`}>
                                ↓
                              </button>
                              <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={() => setStops((all) => all.filter((_, k) => k !== i))} aria-label={`Remove stop ${i + 1}`}>
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-[10rem_1fr_1fr]">
                        <Field id={`s${i}-kind`} label="Kind">
                          <select id={`s${i}-kind`} className="a-select" value={s.kind} onChange={(ev) => up({ kind: ev.currentTarget.value as StopKind })}>
                            {STOP_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {STOP_KIND_LABEL[k]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field id={`s${i}-site`} label="Site name">
                          <input id={`s${i}-site`} className="a-input" value={s.site_name} onChange={(ev) => up({ site_name: ev.currentTarget.value })} />
                        </Field>
                        <Field id={`s${i}-addr`} label="Address" error={e.address}>
                          <input id={`s${i}-addr`} className="a-input" value={s.address} onChange={(ev) => up({ address: ev.currentTarget.value })} />
                        </Field>
                        <Field id={`s${i}-cname`} label="Site contact">
                          <input id={`s${i}-cname`} className="a-input" value={s.contact_name} onChange={(ev) => up({ contact_name: ev.currentTarget.value })} />
                        </Field>
                        <Field id={`s${i}-cphone`} label="Contact phone" error={e.contact_phone}>
                          <input
                            id={`s${i}-cphone`}
                            type="tel"
                            className="a-input"
                            value={s.contact_phone}
                            onChange={(ev) => up({ contact_phone: ev.currentTarget.value })}
                            onBlur={() => {
                              const p = toE164(s.contact_phone);
                              if (p) up({ contact_phone: formatPhone(p) });
                            }}
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field id={`s${i}-ws`} label="Window from">
                            <input id={`s${i}-ws`} type="datetime-local" className="a-input" value={s.window_start} onChange={(ev) => up({ window_start: ev.currentTarget.value })} />
                          </Field>
                          <Field id={`s${i}-we`} label="Window to" error={e.window_end}>
                            <input id={`s${i}-we`} type="datetime-local" className="a-input" value={s.window_end} onChange={(ev) => up({ window_end: ev.currentTarget.value })} />
                          </Field>
                        </div>
                      </div>
                      <fieldset className="mt-3">
                        <legend className="a-label">Access</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {ACCESS_FLAGS.map((f) => (
                            <label key={f} className="check-row">
                              <input
                                type="checkbox"
                                checked={s.access_flags.includes(f)}
                                onChange={(ev) => up({ access_flags: ev.currentTarget.checked ? [...s.access_flags, f] : s.access_flags.filter((x) => x !== f) })}
                              />
                              {ACCESS_FLAG_LABEL[f]}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <Field id={`s${i}-notes`} label="Access notes" className="mt-2">
                        <input id={`s${i}-notes`} className="a-input" value={s.access_notes} onChange={(ev) => up({ access_notes: ev.currentTarget.value })} />
                      </Field>
                    </li>
                  );
                })}
              </ol>
            </Section>

            <Section
              title="Items"
              action={
                canEdit && (
                  <button type="button" className="a-btn a-btn-sm" onClick={() => setItems((s) => [...s, emptyItem()])}>
                    + Add item
                  </button>
                )
              }
            >
              <p className="mb-2 text-[0.8125rem] text-muted">Inches and pounds. Estimates will reuse these sizes and weights.</p>
              {items.length === 0 && <p className="text-muted">No items yet.</p>}
              <ol className="space-y-3">
                {items.map((it, i) => {
                  const e = itemErr[i] ?? {};
                  const up = (patch: Partial<ItemForm>) => setItems((all) => all.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                  return (
                    <li key={it.id ?? `new-${i}`} className="stop-card">
                      <div className="flex items-center gap-2">
                        <span className="stencil text-[0.6875rem]">Item {i + 1}</span>
                        {canEdit && (
                          <button type="button" className="a-btn a-btn-sm a-btn-danger ml-auto" onClick={() => setItems((all) => all.filter((_, k) => k !== i))} aria-label={`Remove item ${i + 1}`}>
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-3">
                        <Field id={`i${i}-desc`} label="Description" error={e.description}>
                          <input id={`i${i}-desc`} className="a-input" value={it.description} onChange={(ev) => up({ description: ev.currentTarget.value })} />
                        </Field>
                        <Field id={`i${i}-art`} label="Artist / title (optional)">
                          <input id={`i${i}-art`} className="a-input" value={it.artist_title} onChange={(ev) => up({ artist_title: ev.currentTarget.value })} />
                        </Field>
                        <Field id={`i${i}-med`} label="Medium">
                          <input id={`i${i}-med`} className="a-input" value={it.medium} onChange={(ev) => up({ medium: ev.currentTarget.value })} />
                        </Field>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {(
                          [
                            ['height_in', 'H (in)'],
                            ['width_in', 'W (in)'],
                            ['depth_in', 'D (in)'],
                            ['weight_lbs', 'Weight (lb)'],
                            ['quantity', 'Qty'],
                          ] as const
                        ).map(([k, l]) => (
                          <Field key={k} id={`i${i}-${k}`} label={l} error={e[k]}>
                            <input
                              id={`i${i}-${k}`}
                              type="number"
                              inputMode="decimal"
                              min={k === 'quantity' ? 1 : 0}
                              step={k === 'quantity' ? 1 : 'any'}
                              className="a-input"
                              value={it[k]}
                              onChange={(ev) => up({ [k]: ev.currentTarget.value } as Partial<ItemForm>)}
                            />
                          </Field>
                        ))}
                        <Field id={`i${i}-pack`} label="Packing">
                          <select id={`i${i}-pack`} className="a-select" value={it.packing} onChange={(ev) => up({ packing: ev.currentTarget.value as ItemForm['packing'] })}>
                            <option value="">—</option>
                            <option value="crated">Crated</option>
                            <option value="soft_pack">Soft-pack</option>
                          </select>
                        </Field>
                      </div>
                      <fieldset className="mt-3">
                        <legend className="a-label">Handling flags</legend>
                        <div className="flex flex-wrap gap-2">
                          {HANDLING_FLAGS.map((f) => (
                            <label key={f} className={`flag-toggle ${it.handling_flags.includes(f) ? 'is-on' : ''}`}>
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={it.handling_flags.includes(f)}
                                onChange={(ev) => up({ handling_flags: ev.currentTarget.checked ? [...it.handling_flags, f] : it.handling_flags.filter((x) => x !== f) })}
                              />
                              <span className="flag-glyph" aria-hidden="true">
                                {HANDLING_FLAG[f].glyph}
                              </span>
                              {HANDLING_FLAG[f].label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </li>
                  );
                })}
              </ol>
            </Section>
          </div>

          <div className="min-w-0 space-y-5">
            <Section title="Crew & assets">
              {!id ? (
                <p className="text-muted">Create the job first, then add crew and trucks here or on the day board.</p>
              ) : (
                <CrewAssets
                  job={job!}
                  crew={activeCrew}
                  assets={assets}
                  canEdit={canEdit}
                  conflicts={conflicts}
                  onChange={sideChange}
                />
              )}
            </Section>
            <Section title="Checklist">
              {!id ? (
                <p className="text-muted">The checklist for this job type is added when you create the job.</p>
              ) : (
                <Checklist job={job!} canEdit={canEdit} onChanged={() => void refreshSide()} onError={setError} />
              )}
            </Section>
            {id && (
              <Section title="Incidents">
                <Incidents job={job!} canEdit={canEdit} onChanged={() => void refreshSide()} onError={setError} />
              </Section>
            )}
            {id && canEdit && (
              <Section title="Cancel or delete">
                <div className="flex flex-wrap gap-2">
                  {basics.status !== 'cancelled' && (
                    <button
                      type="button"
                      className="a-btn"
                      onClick={async () => {
                        try {
                          await updateJob(id, job!.version, { status: 'cancelled' });
                          setStatus('Job cancelled.');
                          await load(true);
                        } catch (e) {
                          if (e instanceof StaleJobError) setStale(true);
                          else setError((e as Error).message);
                        }
                      }}
                    >
                      Cancel job
                    </button>
                  )}
                  {!job?.deleted_at && (
                    <button type="button" className="a-btn" onClick={() => setDialog('trash')}>
                      Move to trash
                    </button>
                  )}
                  {isAdmin && (
                    <button type="button" className="a-btn a-btn-danger" onClick={() => setDialog('delete')}>
                      Delete permanently
                    </button>
                  )}
                </div>
              </Section>
            )}
          </div>
        </div>
      </fieldset>

      <OverrideDialog
        open={!!override}
        jobLabel={job ? `${job.job_number} · ${job.title}` : ''}
        conflicts={override?.conflicts ?? []}
        undoLabel={override?.undo ? 'Undo change' : 'Go back and fix it'}
        onKeep={async (reason) => {
          await recordOverride(id!, reason);
          setStatus('Saved. Override reason recorded.');
          setOverride(null);
        }}
        onUndo={async () => {
          const o = override!;
          setOverride(null);
          if (o.undo) {
            try {
              await o.undo();
              await refreshSide();
              setStatus('Change undone.');
            } catch (e) {
              setError((e as Error).message);
            }
          } else setStatus('Saved, but the warnings still need fixing.');
        }}
      />

      <dialog
        className="a-dialog"
        ref={(d) => {
          if (!d) return;
          if (dialog === 'duplicate' && !d.open) d.showModal();
          if (dialog !== 'duplicate' && d.open) d.close();
        }}
        onClose={() => dialog === 'duplicate' && setDialog(null)}
        aria-labelledby="dup-h"
      >
        <h2 id="dup-h" className="text-lg font-bold">
          Duplicate job
        </h2>
        <p className="mt-1 text-[0.875rem] text-muted">Copies stops, items, crew and trucks. The copy starts as a draft.</p>
        <label htmlFor="dup-date" className="a-label mt-4">
          New date
        </label>
        <input id="dup-date" type="date" className="a-input" value={dupDate} onChange={(e) => setDupDate(e.currentTarget.value)} />
        <div className="mt-5 flex justify-end gap-2">
          <button className="a-btn" onClick={() => setDialog(null)}>
            Cancel
          </button>
          <button
            className="a-btn a-btn-primary"
            disabled={!dupDate}
            onClick={async () => {
              const src = new Date(job!.start_at);
              const d = parseYmd(dupDate);
              d.setHours(src.getHours(), src.getMinutes());
              try {
                const copy = await duplicateJob(id!, d);
                setDialog(null);
                navigate(`/admin/dispatch/jobs/${copy.id}`);
              } catch (e) {
                setError((e as Error).message);
                setDialog(null);
              }
            }}
          >
            Duplicate
          </button>
        </div>
      </dialog>

      <Confirm
        open={dialog === 'trash'}
        title="Move this job to the trash?"
        confirmLabel="Move to trash"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          setDialog(null);
          try {
            await softDeleteJob(id!, job!.version);
            navigate(`/admin/dispatch?date=${backDate}`);
          } catch (e) {
            if (e instanceof StaleJobError) setStale(true);
            else setError((e as Error).message);
          }
        }}
      >
        It disappears from the board and from crew screens. An admin can still delete it permanently.
      </Confirm>
      <Confirm
        open={dialog === 'delete'}
        title="Delete this job permanently?"
        confirmLabel="Delete forever"
        danger
        disabled={typed !== 'DELETE'}
        onCancel={() => {
          setDialog(null);
          setTyped('');
        }}
        onConfirm={async () => {
          setDialog(null);
          setTyped('');
          try {
            await hardDeleteJob(id!);
            navigate(`/admin/dispatch?date=${backDate}`);
          } catch (e) {
            setError(
              /incident/i.test((e as Error).message) || /foreign key/i.test((e as Error).message)
                ? 'This job has incident reports, so it can’t be deleted permanently. Move it to the trash instead.'
                : (e as Error).message,
            );
          }
        }}
      >
        <p>Stops, items, assignments and the checklist are erased. The audit log keeps a record.</p>
        <label className="a-label mt-4" htmlFor="type-delete-job">
          Type DELETE to confirm
        </label>
        <input id="type-delete-job" className="a-input" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} autoComplete="off" />
      </Confirm>
    </div>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const hid = `sec-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="a-panel p-4 lg:p-5" aria-labelledby={hid}>
      <div className="mb-3 flex items-center gap-2">
        <h2 id={hid} className="text-base font-bold">
          {title}
        </h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, error, className = '', children }: { id: string; label: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="a-label">
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[0.8125rem] font-semibold text-danger" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

function CrewAssets({
  job,
  crew,
  assets,
  canEdit,
  conflicts,
  onChange,
}: {
  job: JobFull;
  crew: CrewRow[];
  assets: Asset[];
  canEdit: boolean;
  conflicts: Conflict[];
  onChange: (run: () => Promise<void>, undo: () => Promise<void>, msg: string) => Promise<void>;
}) {
  const [addCrew, setAddCrew] = useState('');
  const [addAsset, setAddAsset] = useState('');
  const assigned = job.assignments;
  const onJobAssets = job.job_assets.map((a) => assets.find((x) => x.id === a.asset_id)).filter((a): a is Asset => !!a);
  const name = (cid: string) => crew.find((c) => c.id === cid)?.display_name ?? 'Former crew member';

  return (
    <div className="space-y-4">
      <div>
        <h3 className="a-label">Crew ({assigned.length})</h3>
        {assigned.length === 0 && <p className="text-[0.875rem] text-muted">No crew yet.</p>}
        <ul className="space-y-2">
          {assigned.map((a) => (
            <AssignmentRow
              key={a.crew_member_id}
              name={name(a.crew_member_id)}
              lead={job.team_lead_id === a.crew_member_id}
              warn={conflicts.some((c) => c.crew_member_id === a.crew_member_id)}
              role={a.role_on_job ?? ''}
              call={toLocalInput(a.call_time_override)}
              canEdit={canEdit}
              onSave={(role, call) => onChange(() => updateAssignment(job.id, a.crew_member_id, { role_on_job: role || null, call_time_override: fromLocalInput(call) }), async () => undefined, 'Assignment updated.')}
              onRemove={() =>
                onChange(
                  () => unassignCrew(job.id, a.crew_member_id),
                  () => assignCrew(job.id, a.crew_member_id),
                  `Removed ${name(a.crew_member_id)}.`,
                )
              }
            />
          ))}
        </ul>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <label className="sr-only" htmlFor="add-crew">
              Add crew member
            </label>
            <select id="add-crew" className="a-select" value={addCrew} onChange={(e) => setAddCrew(e.currentTarget.value)}>
              <option value="">Add crew member…</option>
              {crew
                .filter((c) => !assigned.some((a) => a.crew_member_id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="a-btn"
              disabled={!addCrew}
              onClick={() => {
                const cid = addCrew;
                setAddCrew('');
                void onChange(() => assignCrew(job.id, cid), () => unassignCrew(job.id, cid), `Added ${name(cid)}.`);
              }}
            >
              Add
            </button>
          </div>
        )}
      </div>
      <div>
        <h3 className="a-label">Truck & equipment ({onJobAssets.length})</h3>
        {onJobAssets.length === 0 && <p className="text-[0.875rem] text-muted">None yet.</p>}
        <ul className="space-y-1">
          {onJobAssets.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="drag-chip grow">
                {conflicts.some((c) => c.asset_id === a.id) && (
                  <>
                    <span aria-hidden="true" className="text-danger">
                      ⚠
                    </span>
                    <span className="sr-only">Has a warning:</span>
                  </>
                )}
                {a.name}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="a-btn a-btn-sm"
                  onClick={() => onChange(() => unassignAsset(job.id, a.id), () => assignAsset(job.id, a.id), `Removed ${a.name}.`)}
                  aria-label={`Remove ${a.name}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <label className="sr-only" htmlFor="add-asset">
              Add truck or equipment
            </label>
            <select id="add-asset" className="a-select" value={addAsset} onChange={(e) => setAddAsset(e.currentTarget.value)}>
              <option value="">Add truck or equipment…</option>
              {assets
                .filter((a) => a.active && !job.job_assets.some((x) => x.asset_id === a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.status !== 'in_service' ? ` (${a.status === 'maintenance' ? 'in maintenance' : 'out of service'})` : ''}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="a-btn"
              disabled={!addAsset}
              onClick={() => {
                const aid = addAsset;
                setAddAsset('');
                const n = assets.find((x) => x.id === aid)?.name ?? 'asset';
                void onChange(() => assignAsset(job.id, aid), () => unassignAsset(job.id, aid), `Added ${n}.`);
              }}
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssignmentRow({
  name,
  lead,
  warn,
  role,
  call,
  canEdit,
  onSave,
  onRemove,
}: {
  name: string;
  lead: boolean;
  warn: boolean;
  role: string;
  call: string;
  canEdit: boolean;
  onSave: (role: string, call: string) => void;
  onRemove: () => void;
}) {
  const [r, setR] = useState(role);
  const [c, setC] = useState(call);
  const slug = name.replace(/\W+/g, '-');
  const dirty = r !== role || c !== call;
  return (
    <li className="stop-card !p-2">
      <div className="flex items-center gap-2">
        <span className="font-semibold">
          {lead && (
            <>
              <span aria-hidden="true">★ </span>
              <span className="sr-only">Team lead: </span>
            </>
          )}
          {warn && (
            <>
              <span aria-hidden="true" className="text-danger">
                ⚠{' '}
              </span>
              <span className="sr-only">Has a warning: </span>
            </>
          )}
          {name}
        </span>
        {canEdit && (
          <button type="button" className="a-btn a-btn-sm ml-auto" onClick={onRemove} aria-label={`Remove ${name}`}>
            Remove
          </button>
        )}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div>
          <label className="a-label" htmlFor={`role-${slug}`}>
            Role on job
          </label>
          <input id={`role-${slug}`} className="a-input" value={r} onChange={(e) => setR(e.currentTarget.value)} maxLength={60} />
        </div>
        <div>
          <label className="a-label" htmlFor={`call-${slug}`}>
            Own call time
          </label>
          <input id={`call-${slug}`} type="datetime-local" className="a-input" value={c} onChange={(e) => setC(e.currentTarget.value)} />
        </div>
      </div>
      {canEdit && dirty && (
        <button type="button" className="a-btn a-btn-sm mt-2" onClick={() => onSave(r, c)}>
          Save {name}’s details
        </button>
      )}
    </li>
  );
}

function Checklist({ job, canEdit, onChanged, onError }: { job: JobFull; canEdit: boolean; onChanged: () => void; onError: (e: string) => void }) {
  const [label, setLabel] = useState('');
  const done = job.checklist.filter((c) => c.checked_at).length;
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div>
      <p className="mb-2 text-[0.8125rem] text-muted">
        {done} of {job.checklist.length} done
      </p>
      <ul className="space-y-1">
        {job.checklist.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <label className="check-row grow">
              <input type="checkbox" checked={!!c.checked_at} onChange={(e) => void run(() => setChecklistItem(c.id, e.currentTarget.checked))} />
              <span>
                {c.label}
                {c.checked_at && (
                  <span className="block text-[0.6875rem] text-muted">
                    {c.checked_by} · {fmtDateTime(c.checked_at)}
                  </span>
                )}
              </span>
            </label>
            {canEdit && (
              <button type="button" className="a-btn a-btn-sm" onClick={() => void run(() => deleteChecklistItem(c.id))} aria-label={`Remove checklist item ${c.label}`}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim().length < 2) return;
            const l = label.trim();
            setLabel('');
            void run(() => addChecklistItem(job.id, l, job.checklist.length + 1));
          }}
        >
          <label className="sr-only" htmlFor="new-check">
            New checklist item
          </label>
          <input id="new-check" className="a-input" value={label} placeholder="Add an item…" onChange={(e) => setLabel(e.currentTarget.value)} maxLength={120} />
          <button className="a-btn" disabled={label.trim().length < 2}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function Incidents({ job, canEdit, onChanged, onError }: { job: JobFull; canEdit: boolean; onChanged: () => void; onError: (e: string) => void }) {
  if (!job.incidents.length) return <p className="text-[0.875rem] text-muted">No incidents reported on this job.</p>;
  return (
    <ul className="space-y-3">
      {[...job.incidents]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r) => (
          <IncidentRow key={r.id} incident={r} job={job} canEdit={canEdit} onChanged={onChanged} onError={onError} />
        ))}
    </ul>
  );
}

function IncidentRow({
  incident: r,
  job,
  canEdit,
  onChanged,
  onError,
}: {
  incident: JobFull['incidents'][number];
  job: JobFull;
  canEdit: boolean;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const [follow, setFollow] = useState(r.office_followup ?? '');
  const item = job.items.find((i) => i.id === r.job_item_id);
  return (
    <li className="stop-card">
      <p className="text-[0.75rem] text-muted">
        Reported by <strong className="text-ink">{r.reported_by}</strong> · happened {fmtDateTime(r.occurred_at)}
      </p>
      {item && <p className="mt-1 text-[0.8125rem] font-semibold">Item: {item.description}</p>}
      <p className="mt-1 whitespace-pre-wrap">{r.description}</p>
      <ul className="mt-1 text-[0.75rem] text-muted">
        {r.handlers_involved && <li>Handlers: {r.handlers_involved}</li>}
        <li>Supervisor notified: {r.supervisor_notified ? `yes${r.supervisor_name ? ` (${r.supervisor_name})` : ''}` : 'no'}</li>
        <li>Fragments kept: {r.fragments_retained ? 'yes' : 'no'} · Packing kept: {r.packing_kept ? 'yes' : 'no'}</li>
      </ul>
      {r.photos.length > 0 && <Photos paths={r.photos.map((p) => p.path)} />}
      <div className="mt-2 grid gap-2">
        <div>
          <label className="a-label" htmlFor={`inc-st-${r.id}`}>
            Status
          </label>
          <select
            id={`inc-st-${r.id}`}
            className="a-select"
            value={r.status}
            disabled={!canEdit}
            onChange={async (e) => {
              try {
                await updateIncident(r.id, { status: e.currentTarget.value as (typeof INCIDENT_STATUSES)[number] });
                onChanged();
              } catch (x) {
                onError((x as Error).message);
              }
            }}
          >
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INCIDENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="a-label" htmlFor={`inc-fu-${r.id}`}>
            Office follow-up (office only)
          </label>
          <textarea id={`inc-fu-${r.id}`} className="a-textarea office-only" value={follow} disabled={!canEdit} onChange={(e) => setFollow(e.currentTarget.value)} maxLength={4000} />
          {canEdit && follow !== (r.office_followup ?? '') && (
            <button
              type="button"
              className="a-btn a-btn-sm mt-1"
              onClick={async () => {
                try {
                  await updateIncident(r.id, { office_followup: follow.trim() || null });
                  onChanged();
                } catch (x) {
                  onError((x as Error).message);
                }
              }}
            >
              Save follow-up
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Photos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const loadAll = () =>
      Promise.all(paths.map(async (p) => [p, await incidentPhotoUrl(p).catch(() => '')] as const)).then((pairs) => {
        if (alive.current) setUrls(Object.fromEntries(pairs));
      });
    void loadAll();
    const t = setInterval(loadAll, 270_000); // signed URLs expire after 5 minutes
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [paths.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Incident photos">
      {paths.map((p, i) => (
        <li key={p}>
          {urls[p] ? (
            <a href={urls[p]} target="_blank" rel="noopener noreferrer">
              <img src={urls[p]} alt={`Incident photo ${i + 1}`} className="h-20 w-20 border border-ink object-cover" />
            </a>
          ) : (
            <span className="block h-20 w-20 animate-pulse bg-wall" aria-label="Loading photo" />
          )}
        </li>
      ))}
    </ul>
  );
}

