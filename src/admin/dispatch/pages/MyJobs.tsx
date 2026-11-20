import { useEffect, useState } from 'react';
import { ACCESS_FLAG_LABEL, ASSET_KIND_LABEL, JOB_TYPE_LABEL, STOP_KIND_LABEL, dims, formatPhone, type AccessFlag, type AssetKind, type JobType, type StopKind } from '../../../shared/dispatch';
import { crewSetChecklist, myIncidents, myJobs, type MyJob } from '../data';
import { Link } from '../../router';
import { FlagList, TzNote, officeYmd } from '../ui';
import { addDaysYmd, fmtDay, fmtTime, fmtYmd, getAppTz, todayYmd } from '../tz';

// Office time zone, whatever zone the phone is in.
const time = (iso: string | null | undefined) => fmtTime(iso);
const day = (iso: string) => fmtDay(iso, getAppTz(), 'en-US', true);
const mapsUrl = (address: string) => `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
const tel = (p: string) => `tel:${p}`;

/** Crew home: today, then the next 14 days. Only the signed-in crew member's own jobs. */
export function MyJobs() {
  const [jobs, setJobs] = useState<MyJob[] | null>(null);
  const [incidents, setIncidents] = useState<Awaited<ReturnType<typeof myIncidents>>>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayYmd(getAppTz());
  const until = addDaysYmd(today, 14);

  const reload = () =>
    Promise.all([myJobs(today, until), myIncidents()])
      .then(([j, i]) => {
        setJobs(j);
        setIncidents(i);
      })
      .catch(() => setError('Couldn’t load your jobs. Check your signal and pull to refresh.'));
  useEffect(() => void reload(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const isToday = (j: MyJob) => officeYmd(j.start_at) <= today && officeYmd(j.end_at) >= today;
  const todays = (jobs ?? []).filter(isToday);
  const later = (jobs ?? []).filter((j) => !isToday(j));

  return (
    <div className="crew-page">
      <header className="crew-head">
        <h1 className="text-[1.75rem] font-[850] leading-tight tracking-tight">My jobs</h1>
        <p className="text-[1rem] text-muted">{fmtYmd(today, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <TzNote />
      </header>
      {error && (
        <p role="alert" className="crew-alert">
          {error}
        </p>
      )}
      {jobs === null && !error && <p className="px-4 py-6 text-[1rem]">Loading…</p>}

      {jobs && (
        <>
          <section aria-labelledby="today-h" className="px-4">
            <h2 id="today-h" className="crew-section-h">
              Today
            </h2>
            {todays.length === 0 ? <p className="crew-empty">No jobs today.</p> : todays.map((j) => <JobCard key={j.id} job={j} onChange={reload} />)}
          </section>
          <section aria-labelledby="next-h" className="px-4">
            <h2 id="next-h" className="crew-section-h">
              Next 14 days
            </h2>
            {later.length === 0 ? <p className="crew-empty">Nothing scheduled yet.</p> : later.map((j) => <JobCard key={j.id} job={j} onChange={reload} />)}
          </section>
        </>
      )}

      {incidents.length > 0 && (
        <section aria-labelledby="inc-h" className="px-4 pb-8">
          <h2 id="inc-h" className="crew-section-h">
            My incident reports
          </h2>
          <ul className="space-y-2">
            {incidents.map((i) => (
              <li key={i.id} className="crew-card !p-3 text-[1rem]">
                <p className="font-bold">
                  {i.job_number} · {fmtYmd(officeYmd(i.occurred_at), { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <p className="line-clamp-2">{i.description}</p>
                <p className="text-muted">Status: {i.status.replace('_', ' ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function JobCard({ job, onChange }: { job: MyJob; onChange: () => void }) {
  const [checklist, setChecklist] = useState(job.checklist);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setChecklist(job.checklist), [job.checklist]);
  const done = checklist.filter((c) => c.checked_at).length;

  async function toggle(id: string, checked: boolean) {
    const prev = checklist;
    setErr(null);
    setChecklist((l) => l.map((c) => (c.id === id ? { ...c, checked_at: checked ? new Date().toISOString() : null } : c)));
    try {
      await crewSetChecklist(id, checked);
    } catch {
      setChecklist(prev);
      setErr('Couldn’t save that tick. Try again.');
    }
  }

  return (
    <article className="crew-card" aria-labelledby={`job-${job.id}`}>
      <div className="crew-call">
        <p className="stencil text-[0.75rem]">Call time</p>
        <p className="text-[2.25rem] font-[850] leading-none tracking-tight">{time(job.call_time ?? job.start_at)}</p>
        {job.call_location && <p className="mt-1 text-[1.0625rem] font-semibold">{job.call_location}</p>}
      </div>
      <h3 id={`job-${job.id}`} className="mt-3 text-[1.25rem] font-[800] leading-snug">
        {job.title}
      </h3>
      <p className="text-[1rem] text-muted">
        {job.job_number} · {JOB_TYPE_LABEL[job.job_type as JobType]} · {day(job.start_at)}, {time(job.start_at)}–{time(job.end_at)}
      </p>

      <ol className="mt-4 space-y-3">
        {job.stops.map((s, i) => (
          <li key={i} className="crew-stop">
            <p className="stencil text-[0.75rem]">
              {i + 1}. {STOP_KIND_LABEL[s.kind as StopKind]}
              {s.window_start && ` · ${time(s.window_start)}${s.window_end ? `–${time(s.window_end)}` : ''}`}
            </p>
            {s.site_name && <p className="text-[1.0625rem] font-bold">{s.site_name}</p>}
            <a className="crew-link" href={mapsUrl(s.address)} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">⌖</span> {s.address}
            </a>
            {(s.contact_name || s.contact_phone) && (
              <p className="mt-1 text-[1rem]">
                {s.contact_name}
                {s.contact_phone && (
                  <>
                    {' '}
                    <a className="crew-link" href={tel(s.contact_phone)}>
                      <span aria-hidden="true">✆</span> {formatPhone(s.contact_phone)}
                    </a>
                  </>
                )}
              </p>
            )}
            {s.access_flags.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {s.access_flags.map((f) => (
                  <li key={f} className="access-chip">
                    {ACCESS_FLAG_LABEL[f as AccessFlag] ?? f}
                  </li>
                ))}
              </ul>
            )}
            {s.access_notes && <p className="mt-1 text-[1rem]">{s.access_notes}</p>}
          </li>
        ))}
      </ol>

      {job.items.length > 0 && (
        <section className="mt-4" aria-label="Items">
          <h4 className="crew-sub-h">Items</h4>
          <ul className="space-y-3">
            {job.items.map((it) => (
              <li key={it.id} className="crew-item">
                <p className="text-[1.0625rem] font-bold">
                  {it.quantity > 1 && `${it.quantity}× `}
                  {it.description}
                </p>
                {(it.artist_title || it.medium) && <p className="text-[1rem] text-muted">{[it.artist_title, it.medium].filter(Boolean).join(' · ')}</p>}
                {dims(it) && <p className="text-[1rem]">{dims(it)}</p>}
                <div className="mt-2">
                  <FlagList flags={it.handling_flags} big />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.crew_notes && (
        <section className="mt-4">
          <h4 className="crew-sub-h">Notes from the office</h4>
          <p className="text-[1.0625rem]">{job.crew_notes}</p>
        </section>
      )}

      <section className="mt-4">
        <h4 className="crew-sub-h">Crew</h4>
        <ul className="divide-y divide-line">
          {job.teammates.map((t, i) => (
            <li key={i} className="flex min-h-[48px] flex-wrap items-center gap-x-2 py-1 text-[1.0625rem]">
              <span className="font-semibold">
                {t.is_lead && <span aria-label="Team lead">★ </span>}
                {t.name}
                {t.is_me && <span className="font-normal text-muted"> (you)</span>}
              </span>
              {t.role_on_job && <span className="text-muted">{t.role_on_job}</span>}
              {t.phone && !t.is_me && (
                <a className="crew-link ml-auto" href={tel(t.phone)} aria-label={`Call ${t.name}`}>
                  <span aria-hidden="true">✆</span> {formatPhone(t.phone)}
                </a>
              )}
            </li>
          ))}
        </ul>
        {job.assets.length > 0 && (
          <p className="mt-2 text-[1.0625rem]">
            <span className="font-semibold">Truck / equipment:</span> {job.assets.map((a) => `${a.name} (${ASSET_KIND_LABEL[a.kind as AssetKind]})`).join(', ')}
          </p>
        )}
      </section>

      <section className="mt-4">
        <h4 className="crew-sub-h">
          Checklist <span className="font-normal text-muted">({done}/{checklist.length})</span>
        </h4>
        {!job.is_lead && <p className="text-[0.9375rem] text-muted">The team lead ticks these.</p>}
        <ul className="space-y-1">
          {checklist.map((c) => (
            <li key={c.id}>
              <label className={`crew-check ${job.is_lead ? '' : 'crew-check-ro'}`}>
                <input type="checkbox" checked={!!c.checked_at} disabled={!job.is_lead} onChange={(e) => toggle(c.id, e.currentTarget.checked)} />
                <span>{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
        {err && (
          <p role="alert" className="mt-2 font-semibold text-danger">
            {err}
          </p>
        )}
      </section>

      <Link href={`/admin/my-jobs/${job.id}/incident`} className="crew-incident-btn" onClick={() => void onChange}>
        Report damage / incident
      </Link>
    </article>
  );
}
