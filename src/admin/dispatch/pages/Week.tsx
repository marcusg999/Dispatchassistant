import { useCallback, useEffect, useMemo, useState } from 'react';
import { JOB_STATUSES, JOB_STATUS_LABEL, JOB_TYPES, JOB_TYPE_LABEL } from '../../../shared/dispatch';
import { fmtTime } from '../tz';
import { Link, navigate } from '../../router';
import { ErrorNote } from '../../components/ui';
import { loadBoard, subscribeBoard, type BoardData } from '../data';
import { JobStatusPill, TzNote, officeDayBounds, officeToday, ymd } from '../ui';
import { addDays, dateFromQuery, setDateQuery, weekStart } from '../board/boardData';

export function Week() {
  const [start, setStart] = useState<Date>(() => weekStart(dateFromQuery()));
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [crew, setCrew] = useState('');
  const [asset, setAsset] = useState('');

  const reload = useCallback(async () => {
    try {
      const b = officeDayBounds(start, 7);
      setData(await loadBoard(b.start, b.end));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [start]);
  useEffect(() => {
    setDateQuery(start);
    void reload();
  }, [start, reload]);
  useEffect(() => subscribeBoard(() => void reload()), [reload]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const jobs = useMemo(() => {
    if (!data) return [];
    return data.jobs.filter(
      (j) =>
        (!type || j.job_type === type) &&
        (!status || j.status === status) &&
        (!crew || data.assignments.some((a) => a.job_id === j.id && a.crew_member_id === crew)) &&
        (!asset || data.jobAssets.some((a) => a.job_id === j.id && a.asset_id === asset)),
    );
  }, [data, type, status, crew, asset]);

  const today = ymd(officeToday());
  const end = addDays(start, 6);

  return (
    <div>
      <div className="board-toolbar">
        <h1 className="text-2xl font-[800] tracking-tight">Week</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className="a-btn" onClick={() => setStart((d) => addDays(d, -7))} aria-label="Previous week">
            ←
          </button>
          <span className="font-semibold">
            {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button className="a-btn" onClick={() => setStart((d) => addDays(d, 7))} aria-label="Next week">
            →
          </button>
          <button className="a-btn" onClick={() => setStart(weekStart(officeToday()))}>
            This week
          </button>
          <TzNote className="w-full" />
        </div>
      </div>

      <fieldset className="week-filters">
        <legend className="sr-only">Filters</legend>
        <Filter id="wf-type" label="Job type" value={type} onChange={setType} options={JOB_TYPES.map((t) => [t, JOB_TYPE_LABEL[t]])} />
        <Filter id="wf-status" label="Status" value={status} onChange={setStatus} options={JOB_STATUSES.map((s) => [s, JOB_STATUS_LABEL[s]])} />
        <Filter
          id="wf-crew"
          label="Crew member"
          value={crew}
          onChange={setCrew}
          options={(data?.crew ?? []).filter((c) => c.active).map((c) => [c.id, c.display_name])}
        />
        <Filter id="wf-asset" label="Asset" value={asset} onChange={setAsset} options={(data?.assets ?? []).map((a) => [a.id, a.name])} />
      </fieldset>
      <ErrorNote error={error} />

      {!data && !error && <p className="mt-6 text-muted">Loading…</p>}
      {data && (
        <div className="week-grid" role="list" aria-label="Days of the week">
          {days.map((d) => {
            const k = ymd(d);
            const ob = officeDayBounds(d);
            const dayStart = ob.start.getTime();
            const dayEnd = ob.end.getTime();
            const list = jobs.filter((j) => new Date(j.start_at).getTime() < dayEnd && new Date(j.end_at).getTime() > dayStart);
            return (
              <section key={k} role="listitem" aria-labelledby={`wd-${k}`} className={`week-day ${k === today ? 'is-today' : ''}`}>
                <h2 id={`wd-${k}`} className="week-day-h">
                  <Link href={`/admin/dispatch?date=${k}`} className="text-ink no-underline hover:underline" aria-label={`Open the board for ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
                    <span className="stencil text-[0.6875rem]">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>{' '}
                    <span className="text-lg font-[800]">{d.getDate()}</span>
                  </Link>
                  {k === today && <span className="ml-auto text-[0.6875rem] font-bold uppercase text-accent-text">Today</span>}
                </h2>
                {list.length === 0 && <p className="px-2 pb-3 text-[0.75rem] text-muted">No jobs</p>}
                <ul className="space-y-1.5 p-2">
                  {list.map((j) => {
                    const crewCount = data.assignments.filter((a) => a.job_id === j.id).length;
                    const warn = data.conflicts.filter((c) => c.job_id === j.id).length;
                    return (
                      <li key={j.id}>
                        <button type="button" className={`week-card week-card-${j.status}`} onClick={() => navigate(`/admin/dispatch/jobs/${j.id}`)}>
                          <span className="flex items-center justify-between gap-1">
                            <span className="stencil text-[0.5625rem] text-muted">{j.job_number}</span>
                            <JobStatusPill status={j.status} />
                          </span>
                          <span className="mt-1 block text-[0.8125rem] font-bold leading-tight">{j.title}</span>
                          <span className="mt-1 block text-[0.75rem]">
                            {fmtTime(j.start_at)}–{fmtTime(j.end_at)} · {JOB_TYPE_LABEL[j.job_type]}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-2 text-[0.6875rem] font-semibold">
                            <span>
                              {crewCount} crew
                            </span>
                            {warn > 0 && (
                              <span className="text-danger">
                                <span aria-hidden="true">⚠</span> {warn} warning{warn === 1 ? '' : 's'}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Filter({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label htmlFor={id} className="a-label">
        {label}
      </label>
      <select id={id} className="a-select" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
