import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  ASSET_CAPABILITIES,
  ASSET_CAPABILITY_LABEL,
  ASSET_KIND_LABEL,
  type AssetCapability,
  type AssetKind,
} from '../../../shared/dispatch';
import { Link } from '../../router';
import { ErrorNote } from '../../components/ui';
import {
  assignAsset,
  assignCrew,
  listSkills,
  loadBoard,
  recordOverride,
  subscribeBoard,
  unassignAsset,
  unassignCrew,
  type BoardData,
  type Conflict,
  type Skill,
} from '../data';
import { ConflictBadges, FlagList, JobStatusPill, TzNote, jobTypeLabel, officeDayBounds, officeToday, officeYmd, parseYmd, ymd } from '../ui';
import { fmtDay, fmtTime } from '../tz';
import {
  addDays,
  assetGroups,
  crewGroups,
  dateFromQuery,
  makeKeyboardGetter,
  newConflicts,
  setDateQuery,
  type RosterGroup,
} from '../board/boardData';
import { OverrideDialog } from '../board/OverrideDialog';

type Kind = 'crew' | 'asset';
interface DragData {
  kind: Kind;
  id: string;
  name: string;
  fromJob: string | null;
}
const ROSTER = 'roster';
const GROUP_LABEL: Record<RosterGroup, string> = { available: 'Available', assigned: 'Assigned', unavailable: 'Unavailable' };

const detectCollision: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args));

export function Board({ canEdit }: { canEdit: boolean }) {
  const [day, setDay] = useState<Date>(dateFromQuery);
  const [data, setData] = useState<BoardData | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [active, setActive] = useState<DragData | null>(null);
  const [override, setOverride] = useState<{ jobId: string; conflicts: Conflict[]; undo: () => Promise<void> } | null>(null);
  const dataRef = useRef<BoardData | null>(null);
  dataRef.current = data;

  const reload = useCallback(async () => {
    try {
      const b = officeDayBounds(day);
      const d = await loadBoard(b.start, b.end);
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [day]);

  useEffect(() => {
    setDateQuery(day);
    setData(null);
    void reload();
  }, [day, reload]);
  useEffect(() => subscribeBoard(() => void reload()), [reload]);
  useEffect(() => {
    listSkills().then(setSkills).catch(() => undefined);
  }, []);

  const jobLabel = (id: string) => {
    const j = data?.jobs.find((x) => x.id === id);
    return j ? `${j.job_number} · ${j.title}` : 'this job';
  };

  /** Optimistic change → server → reload → ask for an override reason if new warnings appear. */
  async function change(
    describe: string,
    optimistic: (d: BoardData) => BoardData,
    run: () => Promise<void>,
    undo: () => Promise<void>,
    watchJob: string | null,
  ) {
    const before = dataRef.current;
    if (!before) return;
    setData(optimistic(before));
    setStatus('');
    try {
      await run();
    } catch (e) {
      setData(before);
      setError((e as Error).message);
      setStatus(`Couldn’t save: ${describe}.`);
      return;
    }
    setStatus(`Saved: ${describe}.`);
    const after = await reload();
    if (after && watchJob) {
      const fresh = newConflicts(before.conflicts, after.conflicts, watchJob);
      if (fresh.length) setOverride({ jobId: watchJob, conflicts: fresh, undo });
    }
  }

  const name = (k: Kind, id: string) =>
    k === 'crew' ? (data?.crew.find((c) => c.id === id)?.display_name ?? 'Crew member') : (data?.assets.find((a) => a.id === id)?.name ?? 'Asset');

  function assign(kind: Kind, id: string, toJob: string, fromJob: string | null) {
    if (fromJob === toJob) return;
    const n = name(kind, id);
    const table = kind === 'crew' ? 'assignments' : 'jobAssets';
    const field = kind === 'crew' ? 'crew_member_id' : 'asset_id';
    const doAssign = kind === 'crew' ? () => assignCrew(toJob, id) : () => assignAsset(toJob, id);
    const doUnassign = (job: string) => (kind === 'crew' ? unassignCrew(job, id) : unassignAsset(job, id));
    void change(
      fromJob ? `moved ${n} to ${jobLabel(toJob)}` : `assigned ${n} to ${jobLabel(toJob)}`,
      (d) => {
        const rows = (d[table] as { job_id: string }[]).filter((r) => !(fromJob && r.job_id === fromJob && (r as Record<string, unknown>)[field] === id));
        return { ...d, [table]: [...rows, { job_id: toJob, [field]: id, created_at: new Date().toISOString() }] } as BoardData;
      },
      async () => {
        await doAssign();
        if (fromJob) await doUnassign(fromJob);
      },
      async () => {
        await doUnassign(toJob);
        if (fromJob) await (kind === 'crew' ? assignCrew(fromJob, id) : assignAsset(fromJob, id));
        await reload();
      },
      toJob,
    );
  }

  function unassign(kind: Kind, id: string, fromJob: string) {
    const n = name(kind, id);
    const table = kind === 'crew' ? 'assignments' : 'jobAssets';
    const field = kind === 'crew' ? 'crew_member_id' : 'asset_id';
    void change(
      `removed ${n} from ${jobLabel(fromJob)}`,
      (d) => ({ ...d, [table]: (d[table] as { job_id: string }[]).filter((r) => !(r.job_id === fromJob && (r as Record<string, unknown>)[field] === id)) }) as BoardData,
      () => (kind === 'crew' ? unassignCrew(fromJob, id) : unassignAsset(fromJob, id)),
      async () => {
        await (kind === 'crew' ? assignCrew(fromJob, id) : assignAsset(fromJob, id));
        await reload();
      },
      fromJob,
    );
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const jobsSorted = useMemo(() => (data ? [...data.jobs] : []), [data]);
  const orderRef = useRef<UniqueIdentifier[]>([]);
  orderRef.current = [ROSTER, ...jobsSorted.map((j) => `job:${j.id}`)];
  const keyboardGetter = useMemo(() => makeKeyboardGetter(() => orderRef.current), []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardGetter }),
  );

  const zoneName = (id: UniqueIdentifier | undefined) => {
    if (!id) return 'no drop zone';
    if (id === ROSTER) return 'the roster (unassign)';
    return jobLabel(String(id).slice(4));
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${(a.data.current as DragData).name}. Use the arrow keys to move between jobs, Space to drop, Escape to cancel.`,
    onDragOver: ({ active: a, over }) => `${(a.data.current as DragData).name} is over ${zoneName(over?.id)}.`,
    onDragEnd: ({ active: a, over }) => `${(a.data.current as DragData).name} dropped on ${zoneName(over?.id)}.`,
    onDragCancel: ({ active: a }) => `Cancelled. ${(a.data.current as DragData).name} was not moved.`,
  };

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const d = e.active.data.current as DragData;
    const over = e.over?.id;
    if (!over) return;
    if (over === ROSTER) {
      if (d.fromJob) unassign(d.kind, d.id, d.fromJob);
      return;
    }
    assign(d.kind, d.id, String(over).slice(4), d.fromJob);
  }

  const groupsCrew = data ? crewGroups(data, day) : null;
  const groupsAssets = data ? assetGroups(data) : null;
  const conflictsFor = (jobId: string) => data?.conflicts.filter((c) => c.job_id === jobId) ?? [];
  const isToday = ymd(day) === ymd(officeToday());

  return (
    <div>
      <div className="board-toolbar no-print">
        <h1 className="text-2xl font-[800] tracking-tight">Day board</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className="a-btn" onClick={() => setDay((d) => addDays(d, -1))} aria-label="Previous day">
            ←
          </button>
          <label className="sr-only" htmlFor="board-date">
            Date
          </label>
          <input
            id="board-date"
            type="date"
            className="a-input !w-auto"
            value={ymd(day)}
            onChange={(e) => e.currentTarget.value && setDay(parseYmd(e.currentTarget.value))}
          />
          <button className="a-btn" onClick={() => setDay((d) => addDays(d, 1))} aria-label="Next day">
            →
          </button>
          <button className="a-btn" onClick={() => setDay(officeToday())} disabled={isToday}>
            Today
          </button>
          <span className="ml-1 font-semibold">{day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <TzNote className="w-full" />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href={`/admin/dispatch/print?date=${ymd(day)}`} className="a-btn no-underline">
            Print day
          </Link>
          {canEdit && (
            <Link href={`/admin/dispatch/jobs/new?date=${ymd(day)}`} className="a-btn a-btn-primary no-underline">
              + New job
            </Link>
          )}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <ErrorNote error={error} />

      {!data && !error && <p className="mt-6 text-muted">Loading the board…</p>}
      {data && (
        <DndContext
          sensors={sensors}
          collisionDetection={detectCollision}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'To pick up a crew member or asset, press Space or Enter. Arrow keys move between the roster and each job. Press Space or Enter again to drop, or Escape to cancel. You can also use the Assign menu.',
            },
          }}
          onDragStart={(e: DragStartEvent) => setActive(e.active.data.current as DragData)}
          onDragCancel={() => setActive(null)}
          onDragEnd={onDragEnd}
        >
          <div className="board-layout">
            <Roster
              canEdit={canEdit}
              data={data}
              crew={groupsCrew!}
              assets={groupsAssets!}
              skills={skills}
              onAssign={(kind, id, job) => assign(kind, id, job, null)}
            />
            <section aria-label="Jobs" className="board-jobs">
              {jobsSorted.length === 0 && (
                <div className="a-panel p-6 text-muted">
                  No jobs on this day.
                  {canEdit && (
                    <>
                      {' '}
                      <Link href={`/admin/dispatch/jobs/new?date=${ymd(day)}`} className="underline">
                        Create one
                      </Link>
                      .
                    </>
                  )}
                </div>
              )}
              {jobsSorted.map((j) => (
                <JobColumn
                  key={j.id}
                  job={j}
                  data={data}
                  canEdit={canEdit}
                  conflicts={conflictsFor(j.id)}
                  onUnassign={(kind, id) => unassign(kind, id, j.id)}
                />
              ))}
            </section>
          </div>
          <DragOverlay>{active ? <div className="drag-chip drag-chip-overlay">{active.name}</div> : null}</DragOverlay>
        </DndContext>
      )}

      <OverrideDialog
        open={!!override}
        jobLabel={override ? jobLabel(override.jobId) : ''}
        conflicts={override?.conflicts ?? []}
        onKeep={async (reason) => {
          await recordOverride(override!.jobId, reason);
          setStatus('Override recorded.');
          setOverride(null);
        }}
        onUndo={async () => {
          const o = override!;
          setOverride(null);
          try {
            await o.undo();
            setStatus('Change undone.');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
    </div>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────
function Roster({
  canEdit,
  data,
  crew,
  assets,
  skills,
  onAssign,
}: {
  canEdit: boolean;
  data: BoardData;
  crew: ReturnType<typeof crewGroups>;
  assets: ReturnType<typeof assetGroups>;
  skills: Skill[];
  onAssign: (kind: Kind, id: string, job: string) => void;
}) {
  const [tab, setTab] = useState<Kind>('crew');
  const [q, setQ] = useState('');
  const [skill, setSkill] = useState('');
  const [cap, setCap] = useState('');
  const { setNodeRef, isOver } = useDroppable({ id: ROSTER, disabled: !canEdit });
  const jobsFor = (kind: Kind, id: string) =>
    (kind === 'crew' ? data.assignments.filter((a) => a.crew_member_id === id) : data.jobAssets.filter((a) => a.asset_id === id)).map(
      (a) => data.jobs.find((j) => j.id === a.job_id)?.job_number ?? '',
    );
  const needle = q.trim().toLowerCase();

  return (
    <aside ref={setNodeRef} aria-label="Roster" className={`board-roster a-panel ${isOver ? 'is-over' : ''}`}>
      <div className="flex border-b border-line" role="tablist" aria-label="Roster type">
        {(['crew', 'asset'] as Kind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`roster-tab ${tab === k ? 'is-active' : ''}`}
            onClick={() => setTab(k)}
          >
            {k === 'crew' ? 'Crew' : 'Trucks & equipment'}
          </button>
        ))}
      </div>
      <div className="space-y-2 p-3">
        <label className="sr-only" htmlFor="roster-q">
          Search roster
        </label>
        <input id="roster-q" type="search" className="a-input" placeholder="Search…" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        {tab === 'crew' ? (
          <>
            <label className="sr-only" htmlFor="roster-skill">
              Filter by skill
            </label>
            <select id="roster-skill" className="a-select" value={skill} onChange={(e) => setSkill(e.currentTarget.value)}>
              <option value="">All skills</option>
              {skills.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label className="sr-only" htmlFor="roster-cap">
              Filter by capability
            </label>
            <select id="roster-cap" className="a-select" value={cap} onChange={(e) => setCap(e.currentTarget.value)}>
              <option value="">All capabilities</option>
              {ASSET_CAPABILITIES.map((c) => (
                <option key={c} value={c}>
                  {ASSET_CAPABILITY_LABEL[c]}
                </option>
              ))}
            </select>
          </>
        )}
        {canEdit && <p className="text-[0.75rem] text-muted">Drag onto a job, or use Assign. Drop back here to unassign.</p>}
      </div>
      <div className="roster-scroll">
        {(['available', 'assigned', 'unavailable'] as RosterGroup[]).map((g) => {
          const rows =
            tab === 'crew'
              ? crew[g]
                  .filter((c) => !needle || c.display_name.toLowerCase().includes(needle))
                  .filter((c) => !skill || c.skills.includes(skill))
                  .map((c) => ({
                    id: c.id,
                    name: c.display_name,
                    sub: c.skills.map((s) => skills.find((x) => x.slug === s)?.label ?? s).join(', '),
                  }))
              : assets[g]
                  .filter((a) => !needle || a.name.toLowerCase().includes(needle))
                  .filter((a) => !cap || a.capabilities.includes(cap))
                  .map((a) => ({
                    id: a.id,
                    name: a.name,
                    sub:
                      a.status !== 'in_service'
                        ? a.status === 'maintenance'
                          ? 'In maintenance'
                          : 'Out of service'
                        : [ASSET_KIND_LABEL[a.kind as AssetKind], ...a.capabilities.map((c) => ASSET_CAPABILITY_LABEL[c as AssetCapability] ?? c)].join(' · '),
                  }));
          return (
            <section key={g} aria-label={`${GROUP_LABEL[g]} ${tab === 'crew' ? 'crew' : 'assets'}`} className="roster-group">
              <h2 className="roster-group-h">
                {GROUP_LABEL[g]} <span className="font-normal text-muted">({rows.length})</span>
              </h2>
              {rows.length === 0 && <p className="px-3 pb-2 text-[0.75rem] text-muted">None</p>}
              <ul className="space-y-1.5 px-3 pb-3">
                {rows.map((r) => (
                  <li key={r.id}>
                    <RosterCard
                      kind={tab}
                      id={r.id}
                      name={r.name}
                      sub={r.sub}
                      onJobs={jobsFor(tab, r.id)}
                      unavailable={g === 'unavailable'}
                      canEdit={canEdit}
                      jobs={data.jobs.map((j) => ({ id: j.id, label: `${j.job_number} · ${j.title}` }))}
                      onAssign={(job) => onAssign(tab, r.id, job)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function RosterCard({
  kind,
  id,
  name,
  sub,
  onJobs,
  unavailable,
  canEdit,
  jobs,
  onAssign,
}: {
  kind: Kind;
  id: string;
  name: string;
  sub: string;
  onJobs: string[];
  unavailable: boolean;
  canEdit: boolean;
  jobs: { id: string; label: string }[];
  onAssign: (job: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `roster:${kind}:${id}`,
    data: { kind, id, name, fromJob: null } satisfies DragData,
    disabled: !canEdit,
  });
  return (
    <div className={`roster-card ${isDragging ? 'is-dragging' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
      <div
        ref={setNodeRef}
        {...(canEdit ? listeners : {})}
        {...(canEdit ? attributes : {})}
        aria-roledescription={canEdit ? 'draggable' : undefined}
        aria-label={canEdit ? `${name}. ${sub}` : undefined}
        className={`roster-handle ${canEdit ? 'is-draggable' : ''}`}
      >
        {canEdit && (
          <span className="grip" aria-hidden="true">
            ⠿
          </span>
        )}
        <span className="min-w-0">
          <span className="block font-semibold leading-tight">{name}</span>
          <span className="block truncate text-[0.6875rem] text-muted">{sub}</span>
          {onJobs.length > 0 && <span className="block text-[0.6875rem] font-semibold">On {onJobs.join(', ')}</span>}
          {unavailable && kind === 'crew' && <span className="block text-[0.6875rem] font-semibold text-danger">Unavailable today</span>}
        </span>
      </div>
      {canEdit && jobs.length > 0 && (
        <>
          <label className="sr-only" htmlFor={`assign-${kind}-${id}`}>
            Assign {name} to a job
          </label>
          <select
            id={`assign-${kind}-${id}`}
            className="a-select roster-assign"
            value=""
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (v) onAssign(v);
            }}
          >
            <option value="">Assign…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

// ── Job column ───────────────────────────────────────────────────────────────
function JobColumn({
  job,
  data,
  canEdit,
  conflicts,
  onUnassign,
}: {
  job: BoardData['jobs'][number];
  data: BoardData;
  canEdit: boolean;
  conflicts: Conflict[];
  onUnassign: (kind: Kind, id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `job:${job.id}`, disabled: !canEdit });
  const crew = data.assignments
    .filter((a) => a.job_id === job.id)
    .map((a) => data.crew.find((c) => c.id === a.crew_member_id))
    .filter((c): c is BoardData['crew'][number] => !!c);
  const assets = data.jobAssets
    .filter((a) => a.job_id === job.id)
    .map((a) => data.assets.find((x) => x.id === a.asset_id))
    .filter((a): a is BoardData['assets'][number] => !!a);
  const origin = job.stops.find((s) => s.kind === 'origin') ?? job.stops[0];
  const dest = [...job.stops].reverse().find((s) => s.kind === 'destination') ?? (job.stops.length > 1 ? job.stops[job.stops.length - 1] : undefined);
  const flags = [...new Set(job.items.flatMap((i) => i.handling_flags))];
  const done = job.checklist.filter((c) => c.checked_at).length;
  const multiDay = officeYmd(job.start_at) !== officeYmd(job.end_at);
  const where = (s: typeof origin) => (s ? s.site_name || s.address : '');

  return (
    <article ref={setNodeRef} aria-labelledby={`job-h-${job.id}`} className={`job-col ${isOver ? 'is-over' : ''} ${job.status === 'cancelled' ? 'is-cancelled' : ''}`}>
      <header className="job-col-head">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="stencil text-[0.625rem] text-muted">
              {job.job_number} · {jobTypeLabel(job.job_type)}
            </p>
            <h2 id={`job-h-${job.id}`} className="mt-0.5 text-[0.9375rem] font-bold leading-tight">
              <Link href={`/admin/dispatch/jobs/${job.id}`} className="text-ink no-underline hover:underline">
                {job.title}
              </Link>
            </h2>
          </div>
          <JobStatusPill status={job.status} />
        </div>
        <p className="mt-1 text-[0.8125rem] font-semibold">
          {fmtTime(job.start_at)}–{fmtTime(job.end_at)}
          {multiDay && <span className="font-normal text-muted"> (ends {fmtDay(job.end_at)})</span>}
          {job.call_time && <span className="font-normal text-muted"> · call {fmtTime(job.call_time)}</span>}
        </p>
        {(origin || dest) && (
          <p className="mt-1 text-[0.75rem] leading-snug">
            {where(origin)}
            {dest && dest !== origin && (
              <>
                {' '}
                <span aria-hidden="true">→</span>
                <span className="sr-only">to</span> {where(dest)}
              </>
            )}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <FlagList flags={flags} compact />
          {job.checklist.length > 0 && (
            <span className={`checklist-chip ${done === job.checklist.length ? 'is-done' : ''}`}>
              <span aria-hidden="true">☑</span> {done}/{job.checklist.length}
              <span className="sr-only"> checklist items done</span>
            </span>
          )}
        </div>
        {conflicts.length > 0 && (
          <div className="mt-2">
            <ConflictBadges conflicts={conflicts} />
          </div>
        )}
      </header>

      <div className="job-col-body">
        <DropList title="Crew" empty={canEdit ? 'Drop crew here' : 'No crew'}>
          {crew.map((c) => (
            <Chip
              key={c.id}
              kind="crew"
              id={c.id}
              jobId={job.id}
              name={c.display_name}
              lead={job.team_lead_id === c.id}
              warn={conflicts.some((x) => x.crew_member_id === c.id)}
              canEdit={canEdit}
              onUnassign={() => onUnassign('crew', c.id)}
            />
          ))}
        </DropList>
        <DropList title="Truck & equipment" empty={canEdit ? 'Drop a truck or equipment here' : 'None'}>
          {assets.map((a) => (
            <Chip
              key={a.id}
              kind="asset"
              id={a.id}
              jobId={job.id}
              name={a.name}
              warn={conflicts.some((x) => x.asset_id === a.id)}
              canEdit={canEdit}
              onUnassign={() => onUnassign('asset', a.id)}
            />
          ))}
        </DropList>
      </div>
      <footer className="job-col-foot">
        <Link href={`/admin/dispatch/jobs/${job.id}`} className="underline">
          {canEdit ? 'Edit job' : 'Open job'}
        </Link>
        <Link href={`/admin/dispatch/print/${job.id}`} className="underline">
          Print
        </Link>
      </footer>
    </article>
  );
}

function DropList({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div>
      <h3 className="a-label !mb-1">{title}</h3>
      {children.length ? <ul className="space-y-1">{children.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="drop-empty">{empty}</p>}
    </div>
  );
}

function Chip({
  kind,
  id,
  jobId,
  name,
  lead,
  warn,
  canEdit,
  onUnassign,
}: {
  kind: Kind;
  id: string;
  jobId: string;
  name: string;
  lead?: boolean;
  warn?: boolean;
  canEdit: boolean;
  onUnassign: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip:${jobId}:${kind}:${id}`,
    data: { kind, id, name, fromJob: jobId } satisfies DragData,
    disabled: !canEdit,
  });
  return (
    <div className={`drag-chip ${isDragging ? 'is-dragging' : ''} ${warn ? 'has-warning' : ''}`}>
      <span
        ref={setNodeRef}
        {...(canEdit ? listeners : {})}
        {...(canEdit ? attributes : {})}
        aria-roledescription={canEdit ? 'draggable' : undefined}
        aria-label={canEdit ? `${name}${lead ? ', team lead' : ''}, on this job` : undefined}
        className={`chip-handle ${canEdit ? 'is-draggable' : ''}`}
      >
        {lead && (
          <>
            <span aria-hidden="true">★</span>
            <span className="sr-only">Team lead:</span>
          </>
        )}
        {warn && (
          <>
            <span aria-hidden="true" className="text-danger">
              ⚠
            </span>
            <span className="sr-only">Has a warning:</span>
          </>
        )}
        <span className="truncate">{name}</span>
      </span>
      {canEdit && (
        <button type="button" className="chip-remove" onClick={onUnassign} aria-label={`Unassign ${name}`}>
          ×
        </button>
      )}
    </div>
  );
}

