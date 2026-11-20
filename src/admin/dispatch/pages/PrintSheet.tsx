import { useEffect, useMemo, useState } from 'react';
import { displayName } from '../../../brand/brand.config';
import {
  HANDLING_FLAG,
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  STOP_KIND_LABEL,
  fmtDay,
  fmtTime,
  formatPhone,
  type HandlingFlag,
} from '../../../shared/dispatch';
import { ErrorNote } from '../../components/ui';
import { Link, navigate } from '../../router';
import { appTimeZone, getJob, listAssets, listCrew, loadBoard, logDispatchExport } from '../data';
import { PACKING_LABEL, toSheetJob, toSheetJobs, type SheetJob } from '../print/sheetModel';
import { accessLabel } from '../ui';
import { dayBounds, fmtDateTime, fmtYmd, getAppTz, todayYmd, tzHint } from '../tz';

/**
 * Printable dispatch sheet: /admin/dispatch/print?date=YYYY-MM-DD (all jobs that day)
 * or /admin/dispatch/print/:jobId (one job). Print / Save as PDF, Word and Excel.
 * Office notes are left out unless "Include office notes" is ticked. Every export is audited.
 */
type Raw =
  | { kind: 'day'; date: string; data: Awaited<ReturnType<typeof loadBoard>> }
  | { kind: 'job'; job: NonNullable<Awaited<ReturnType<typeof getJob>>>; crew: Awaited<ReturnType<typeof listCrew>>; assets: Awaited<ReturnType<typeof listAssets>> };

export function PrintSheet({ jobId }: { jobId: string | null }) {
  const initialDate = new URLSearchParams(location.search).get('date') ?? todayYmd(getAppTz());
  const [date, setDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : todayYmd(getAppTz()));
  const [raw, setRaw] = useState<Raw | null>(null);
  const [tz, setTz] = useState<string | undefined>(getAppTz());
  const [includeOffice, setIncludeOffice] = useState(false);
  const [busy, setBusy] = useState<'xlsx' | 'docx' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    appTimeZone().then(setTz).catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    setRaw(null);
    setError(null);
    (async () => {
      try {
        if (jobId) {
          const [job, crew, assets] = await Promise.all([getJob(jobId), listCrew(), listAssets()]);
          if (!job) throw new Error('Job not found.');
          if (live) setRaw({ kind: 'job', job, crew, assets });
        } else {
          const { start, end } = dayBounds(date, getAppTz()); // the office's calendar day
          const data = await loadBoard(start, end);
          if (live) setRaw({ kind: 'day', date, data });
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [jobId, date]);

  const jobs: SheetJob[] = useMemo(() => {
    if (!raw) return [];
    const opts = { includeOfficeNotes: includeOffice };
    if (raw.kind === 'job') {
      const j = raw.job;
      return [toSheetJob(j, { assignments: j.assignments, jobAssets: j.job_assets, crew: raw.crew, assets: raw.assets }, opts)];
    }
    const d = raw.data;
    return toSheetJobs(d.jobs, { assignments: d.assignments, jobAssets: d.jobAssets, crew: d.crew, assets: d.assets }, opts);
  }, [raw, includeOffice]);

  const label = raw?.kind === 'job' ? raw.job.job_number : fmtYmd(date);
  const scope = raw?.kind === 'job' ? { job_id: raw.job.id, job_number: raw.job.job_number } : { date };

  async function exportAs(format: 'xlsx' | 'docx') {
    setBusy(format);
    setError(null);
    try {
      const mod = await import('../print/dispatchExport');
      const meta = { label, exportedAt: new Date(), includeOfficeNotes: includeOffice, timeZone: tz };
      const bytes = format === 'xlsx' ? await mod.buildDispatchXlsx(jobs, meta) : await mod.buildDispatchDocx(jobs, meta);
      const name = mod.dispatchFileName(format, raw?.kind === 'job' ? { jobNumber: raw.job.job_number } : { date });
      mod.downloadBytes(bytes, name, format === 'xlsx' ? mod.XLSX_MIME : mod.DOCX_MIME);
      await logDispatchExport(format, scope, includeOffice);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function print() {
    try {
      await logDispatchExport('print', scope, includeOffice);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    window.print();
  }

  return (
    <div>
      <div className="no-print a-panel mb-5 flex flex-wrap items-end gap-3 p-4">
        <div className="mr-auto">
          <h1 className="text-xl font-[800] tracking-tight">Dispatch sheet</h1>
          <p className="text-muted">{raw?.kind === 'job' ? `One job · ${raw.job.job_number}` : 'All jobs for the day'}</p>
        </div>
        {!jobId && (
          <label className="flex flex-col">
            <span className="a-label">Day</span>
            <input
              type="date"
              className="a-input !w-auto"
              value={date}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (!v) return;
                setDate(v);
                history.replaceState(null, '', `/admin/dispatch/print?date=${v}`);
              }}
            />
          </label>
        )}
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" className="size-4" checked={includeOffice} onChange={(e) => setIncludeOffice(e.currentTarget.checked)} />
          Include office notes
        </label>
        <button className="a-btn a-btn-primary" onClick={print} disabled={!raw}>
          Print / Save as PDF
        </button>
        <button className="a-btn" onClick={() => exportAs('docx')} disabled={!raw || !!busy}>
          {busy === 'docx' ? 'Exporting…' : 'Word (.docx)'}
        </button>
        <button className="a-btn" onClick={() => exportAs('xlsx')} disabled={!raw || !!busy}>
          {busy === 'xlsx' ? 'Exporting…' : 'Excel (.xlsx)'}
        </button>
        {jobId && raw?.kind === 'job' && (
          <button className="a-btn" onClick={() => navigate(`/admin/dispatch/jobs/${jobId}`)}>
            Back to job
          </button>
        )}
      </div>
      <ErrorNote error={error} />

      {!raw && !error && <p className="text-muted">Loading…</p>}
      {raw && (
        <article className="dsheet" aria-label="Dispatch sheet">
          {/* Not a <header>: the console's print CSS hides header elements. */}
          <div className="dsheet-head">
            <span className="stencil">{displayName()}</span>
            <span>
              Dispatch sheet · <strong>{label}</strong>
              {includeOffice && <span className="dsheet-note"> · includes office notes</span>}
            </span>
          </div>
          {jobs.length === 0 && <p className="mt-6">No jobs scheduled for this day.</p>}
          {jobs.map((j, i) => (
            <JobBlock key={j.id} job={j} tz={tz} first={i === 0} includeOffice={includeOffice} />
          ))}
          <p className="dsheet-foot">Printed {fmtDateTime(new Date().toISOString(), tz)} · {tzHint(tz)}</p>
        </article>
      )}
    </div>
  );
}

function JobBlock({ job: j, tz, first, includeOffice }: { job: SheetJob; tz?: string; first: boolean; includeOffice: boolean }) {
  const staggered = j.crew.filter((c) => c.call_time_override);
  return (
    <section className={`dsheet-job ${first ? '' : 'dsheet-break'}`} aria-labelledby={`h-${j.id}`}>
      <div className="dsheet-jobhead">
        <h2 id={`h-${j.id}`}>
          <span className="dsheet-num">{j.job_number}</span> {j.title}
        </h2>
        <p>
          <strong>{JOB_TYPE_LABEL[j.job_type]}</strong> · {fmtDay(j.start_at, tz)} {fmtTime(j.start_at, tz)}–{fmtTime(j.end_at, tz)} · {JOB_STATUS_LABEL[j.status]}
          <Link href={`/admin/dispatch/print/${j.id}`} className="no-print ml-3 underline">
            Print this job only
          </Link>
        </p>
      </div>

      <dl className="dsheet-grid">
        <div>
          <dt>Call</dt>
          <dd>
            {j.call_time ? (
              <>
                <strong>{fmtTime(j.call_time, tz)}</strong>
                {j.call_location ? ` at ${j.call_location}` : ''}
              </>
            ) : (
              '—'
            )}
            {staggered.length > 0 && (
              <span className="block">Staggered: {staggered.map((c) => `${c.name} ${fmtTime(c.call_time_override, tz)}`).join(', ')}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Team lead</dt>
          <dd>{j.team_lead ? `${j.team_lead.name}${j.team_lead.phone ? ` · ${formatPhone(j.team_lead.phone)}` : ''}` : '—'}</dd>
        </div>
        <div>
          <dt>Crew</dt>
          <dd>
            {j.crew.length ? (
              <ul>
                {j.crew.map((c) => (
                  <li key={c.id ?? c.name}>
                    {c.name}
                    {c.role_on_job ? ` (${c.role_on_job})` : ''}
                    {c.phone ? ` · ${formatPhone(c.phone)}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              'None assigned'
            )}
          </dd>
        </div>
        <div>
          <dt>Truck / equipment</dt>
          <dd>{j.assets.length ? j.assets.map((a) => a.name).join(', ') : 'None assigned'}</dd>
        </div>
      </dl>

      {j.stops.length > 0 && (
        <>
          <h3>Stops</h3>
          <ol className="dsheet-stops">
            {j.stops.map((s, i) => (
              <li key={i}>
                <p>
                  <strong>
                    {i + 1}. {STOP_KIND_LABEL[s.kind]}
                    {s.window_start ? ` · ${fmtTime(s.window_start, tz)}${s.window_end ? `–${fmtTime(s.window_end, tz)}` : ''}` : ''}
                  </strong>
                </p>
                <p>{[s.site_name, s.address].filter(Boolean).join(', ')}</p>
                {(s.contact_name || s.contact_phone) && <p>Contact: {[s.contact_name, formatPhone(s.contact_phone)].filter(Boolean).join(' · ')}</p>}
                {s.access_flags.length > 0 && <p>Access: {s.access_flags.map(accessLabel).join(', ')}</p>}
                {s.access_notes && <p>Notes: {s.access_notes}</p>}
              </li>
            ))}
          </ol>
        </>
      )}

      {j.items.length > 0 && (
        <>
          <h3>Items</h3>
          <table className="dsheet-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Qty</th>
                <th scope="col">H × W × D (in)</th>
                <th scope="col">Weight</th>
                <th scope="col">Packing</th>
                <th scope="col">Handling</th>
              </tr>
            </thead>
            <tbody>
              {j.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.description}</td>
                  <td>{it.quantity}</td>
                  <td>{[it.height_in, it.width_in, it.depth_in].every((d) => d != null) ? `${it.height_in} × ${it.width_in} × ${it.depth_in}` : '—'}</td>
                  <td>{it.weight_lbs != null ? `${it.weight_lbs} lb` : '—'}</td>
                  <td>{it.packing ? (PACKING_LABEL[it.packing] ?? it.packing) : '—'}</td>
                  <td>
                    {it.handling_flags.length ? (
                      <ul className="dsheet-flags">
                        {it.handling_flags.map((f) => {
                          const h = HANDLING_FLAG[f as HandlingFlag];
                          return (
                            <li key={f}>
                              <span aria-hidden="true" className="dsheet-glyph">
                                {h?.glyph}
                              </span>{' '}
                              {h?.label ?? f}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {j.checklist.length > 0 && (
        <>
          <h3>Checklist</h3>
          <ul className="dsheet-check">
            {j.checklist.map((c, i) => (
              <li key={i}>
                <span aria-hidden="true" className="dsheet-box">
                  {c.checked ? '☑' : '☐'}
                </span>
                <span>
                  {c.label}
                  <span className="sr-only">{c.checked ? ' (done)' : ' (not done)'}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {j.crew_notes && (
        <div className="dsheet-notes">
          <h3>Crew notes</h3>
          <p>{j.crew_notes}</p>
        </div>
      )}
      {includeOffice && j.office_notes && (
        <div className="dsheet-notes dsheet-office">
          <h3>Office notes</h3>
          <p>{j.office_notes}</p>
        </div>
      )}
    </section>
  );
}
