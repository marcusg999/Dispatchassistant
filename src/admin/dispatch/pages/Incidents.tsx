import { useEffect, useState } from 'react';
import { INCIDENT_STATUSES, INCIDENT_STATUS_LABEL, type IncidentStatus } from '../../../shared/dispatch';
import { listIncidents, type IncidentListRow } from '../people/peopleData';
import { Link, navigate } from '../../router';
import { ErrorNote, fmtDateTime } from '../../components/ui';

/** Office list of named incident reports. Follow-up happens on the job page. */
export function Incidents({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<IncidentStatus | null>(null);
  const [rows, setRows] = useState<IncidentListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listIncidents(status)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [status]);

  return (
    <div>
      <h1 className="text-2xl font-[800] tracking-tight">Incident reports</h1>
      <p className="mt-1 text-muted">
        Damage and incident reports filed by crew and office. These are named, not anonymous.{' '}
        {canEdit ? 'Open the job to update status and follow-up notes.' : 'Read-only for your role.'}
      </p>
      <fieldset className="mt-4">
        <legend className="a-label">Status</legend>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="a-toggle" aria-pressed={status === null} onClick={() => setStatus(null)}>
            All
          </button>
          {INCIDENT_STATUSES.map((s) => (
            <button key={s} type="button" className="a-toggle" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {INCIDENT_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <ErrorNote error={error} />
      <div className="a-panel mt-4 overflow-x-auto">
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Occurred</th>
              <th scope="col">Job</th>
              <th scope="col">Reported by</th>
              <th scope="col" className="w-full">
                What happened
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/admin/dispatch/jobs/${r.job_id}`)}>
                <td className="whitespace-nowrap text-muted">{fmtDateTime(r.occurred_at)}</td>
                <td className="whitespace-nowrap">
                  <Link href={`/admin/dispatch/jobs/${r.job_id}`} className="font-semibold text-ink">
                    {r.job?.job_number ?? 'Job'}
                  </Link>
                  <span className="block text-[0.75rem] text-muted">{r.job?.title}</span>
                </td>
                <td className="whitespace-nowrap">{r.reported_by}</td>
                <td>
                  <span className="line-clamp-2">{r.description}</span>
                </td>
                <td>
                  <span className="status-pill">{INCIDENT_STATUS_LABEL[r.status as IncidentStatus]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && <p className="p-4 text-muted">No incident reports.</p>}
      </div>
    </div>
  );
}
