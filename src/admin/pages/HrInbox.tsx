import { useEffect, useState } from 'react';
import { STATUSES, STATUS_LABEL, type Status } from '../../shared/domain';
import {
  EMPTY_HR_FILTERS,
  HR_PAGE_SIZE,
  allHrReports,
  hrBackup,
  hrLogExport,
  listHrReports,
  type HrFilters,
  type HrReport,
} from '../hrData';
import { navigate } from '../router';
import { ErrorNote, StatusPill, fmtDate } from '../components/ui';

function HrBanner() {
  return (
    <p className="border-l-4 border-ink bg-paper px-3 py-2 font-semibold" role="note">
      HR eyes only: named reports. Admins can’t see this page.
    </p>
  );
}
export { HrBanner };

export function HrInbox() {
  const [filters, setFilters] = useState<HrFilters>(EMPTY_HR_FILTERS);
  const [qDraft, setQDraft] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<HrReport[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'xlsx' | 'json' | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    listHrReports(filters, page)
      .then((r) => {
        if (!live) return;
        setRows(r.rows);
        setCount(r.count);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [filters, page]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== filters.q) {
        setPage(0);
        setFilters((f) => ({ ...f, q: qDraft }));
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qDraft, filters.q]);

  const set = (patch: Partial<HrFilters>) => {
    setPage(0);
    setFilters((f) => ({ ...f, ...patch }));
  };
  const pages = Math.max(1, Math.ceil(count / HR_PAGE_SIZE));
  const open = (id: string) => navigate(`/admin/hr/r/${id}`);

  async function exportXlsx() {
    setBusy('xlsx');
    setError(null);
    try {
      const [mod, data] = await Promise.all([import('../hrExport'), allHrReports(filters)]);
      const { download, XLSX_MIME } = await import('../exporters');
      download(await mod.buildHrXlsx(data), mod.hrExportFileName(), XLSX_MIME);
      await hrLogExport('xlsx', data.length);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function backup() {
    setBusy('json');
    setError(null);
    try {
      const data = await hrBackup();
      const blob = new Blob(
        [JSON.stringify({ exported_at: new Date().toISOString(), confidential: 'HR eyes only', ...data }, null, 2)],
        {
          type: 'application/json',
        },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hr_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await hrLogExport('backup_json', data.reports.length);
    } catch (e) {
      setError(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <HrBanner />
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-[800] tracking-tight">{filters.trash ? 'HR reports: deleted' : 'HR inbox'}</h1>
          <p className="text-muted" aria-live="polite">
            {rows === null ? 'Loading…' : `${count.toLocaleString()} ${count === 1 ? 'report' : 'reports'}`}
          </p>
        </div>
        <button className="a-btn" onClick={exportXlsx} disabled={!!busy || !count}>
          {busy === 'xlsx' ? 'Exporting…' : 'Export Excel'}
        </button>
        <button className="a-btn" onClick={backup} disabled={!!busy}>
          {busy === 'json' ? 'Preparing…' : 'Download HR backup (.json)'}
        </button>
      </div>

      <div className="a-panel flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-[14rem] flex-1">
          <label className="a-label" htmlFor="hr-q">
            Search
          </label>
          <input
            id="hr-q"
            type="search"
            className="a-input"
            placeholder="Name or words in the report…"
            value={qDraft}
            onChange={(e) => setQDraft(e.currentTarget.value)}
          />
        </div>
        <fieldset>
          <legend className="a-label">Status</legend>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className="a-toggle"
                aria-pressed={filters.statuses.includes(s)}
                onClick={() =>
                  set({
                    statuses: filters.statuses.includes(s)
                      ? filters.statuses.filter((x) => x !== s)
                      : ([...filters.statuses, s] as Status[]),
                  })
                }
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-[44px] items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={filters.trash}
            onChange={(e) => set({ trash: e.currentTarget.checked })}
          />
          Show deleted only
        </label>
      </div>
      <ErrorNote error={error} />

      {rows && rows.length === 0 && <p className="a-panel p-6 text-muted">No HR reports match.</p>}
      {rows && rows.length > 0 && (
        <>
          <div className="a-panel hidden overflow-x-auto md:block">
            <table className="a-table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="w-full">
                    Report
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => open(r.id)}>
                    <td className="whitespace-nowrap text-muted">{fmtDate(r.created_at)}</td>
                    <td className="whitespace-nowrap font-semibold">{r.full_name}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td>
                      <a
                        href={`/admin/hr/r/${r.id}`}
                        className="line-clamp-2 text-ink no-underline hover:underline"
                        onClick={(e) => {
                          e.preventDefault();
                          open(r.id);
                        }}
                      >
                        {r.body}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <a
                  href={`/admin/hr/r/${r.id}`}
                  className="a-panel block p-3 text-ink no-underline"
                  onClick={(e) => {
                    e.preventDefault();
                    open(r.id);
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.full_name}</span>
                    <StatusPill status={r.status} />
                    <span className="ml-auto text-[0.75rem] text-muted">{fmtDate(r.created_at)}</span>
                  </div>
                  <p className="mt-2 line-clamp-3">{r.body}</p>
                </a>
              </li>
            ))}
          </ul>
          <nav aria-label="Pages" className="flex items-center justify-between">
            <button className="a-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              ← Previous
            </button>
            <span className="text-muted">
              Page {page + 1} of {pages}
            </span>
            <button className="a-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
