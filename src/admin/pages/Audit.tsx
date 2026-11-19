import { Fragment, useEffect, useState } from 'react';
import { STATUS_LABEL, TAG_LABEL, type Status, type Tag } from '../../shared/domain';
import { AUDIT_PAGE, listAudit, type AuditRow } from '../data';
import { Link } from '../router';
import { ErrorNote, fmtDateTime } from '../components/ui';

type J = Record<string, unknown> | null;

/** Plain-language one-liner for an audit row. */
export function describeAudit(r: AuditRow): string {
  const b = r.before as J;
  const a = r.after as J;
  switch (r.action) {
    case 'retag':
      return `Priority ${TAG_LABEL[b?.admin_tag as Tag] ?? b?.admin_tag} → ${TAG_LABEL[a?.admin_tag as Tag] ?? a?.admin_tag}`;
    case 'status_change':
      return `Status ${STATUS_LABEL[b?.status as Status] ?? b?.status} → ${STATUS_LABEL[a?.status as Status] ?? a?.status}`;
    case 'public_reply':
      return a?.public_reply ? 'Public reply updated' : 'Public reply cleared';
    case 'publish':
      return 'Published to board';
    case 'unpublish':
      return 'Removed from board';
    case 'board_summary':
      return 'Board summary edited';
    case 'soft_delete':
      return 'Moved to trash';
    case 'restore':
      return 'Restored from trash';
    case 'hard_delete':
      return 'Deleted permanently';
    case 'note_added':
      return 'Private note added';
    case 'note_edited':
      return 'Private note edited';
    case 'note_deleted':
      return 'Private note deleted';
    case 'admin_added':
      return `Admin added: ${a?.email}`;
    case 'admin_removed':
      return `Admin removed: ${b?.email}`;
    case 'export':
      return `Exported ${a?.rows} rows (${String(a?.format).toUpperCase()})`;
    case 'backup':
      return `Downloaded full backup (${a?.rows} suggestions)`;
    case 'hr_status_change':
      return `HR report status ${STATUS_LABEL[b?.status as Status] ?? b?.status} → ${STATUS_LABEL[a?.status as Status] ?? a?.status}`;
    case 'hr_reply':
      return a?.reply_set ? 'HR reply updated' : 'HR reply cleared';
    case 'hr_soft_delete':
      return 'HR report moved to trash';
    case 'hr_restore':
      return 'HR report restored';
    case 'hr_hard_delete':
      return 'HR report deleted permanently';
    case 'hr_note_added':
      return 'HR note added';
    case 'hr_note_deleted':
      return 'HR note deleted';
    case 'hr_member_added':
      return `HR member added: ${a?.email}`;
    case 'hr_member_removed':
      return `HR member removed: ${b?.email}`;
    case 'hr_export':
      return `Exported ${a?.rows} HR reports (XLSX)`;
    case 'hr_backup':
      return `Downloaded HR backup (${a?.rows} reports)`;
    default:
      return r.action;
  }
}

export function Audit() {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAudit(page)
      .then((r) => {
        setRows(r.rows);
        setCount(r.count);
      })
      .catch((e: Error) => setError(e.message));
  }, [page]);

  const pages = Math.max(1, Math.ceil(count / AUDIT_PAGE));

  return (
    <div>
      <h1 className="text-2xl font-[800] tracking-tight">Audit log</h1>
      <p className="mt-1 text-muted">
        Every admin and HR action, recorded by the database (HR entries never include names or report text).
        Append-only: nobody, including admins, can edit or delete entries.
      </p>
      <ErrorNote error={error} />
      <div className="a-panel mt-6 overflow-x-auto">
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
              <th scope="col">Suggestion</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <Fragment key={r.id}>
                <tr className="!cursor-default">
                  <td className="whitespace-nowrap text-muted">{fmtDateTime(r.created_at)}</td>
                  <td className="whitespace-nowrap">{r.actor_email}</td>
                  <td>{describeAudit(r)}</td>
                  <td>
                    {r.suggestion_id && r.action !== 'hard_delete' && r.action !== 'hr_hard_delete' ? (
                      <Link
                        href={
                          r.action.startsWith('hr_') ? `/admin/hr/r/${r.suggestion_id}` : `/admin/s/${r.suggestion_id}`
                        }
                        className="underline"
                      >
                        Open
                      </Link>
                    ) : (
                      <span className="text-muted">·</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      className="a-btn a-btn-sm"
                      aria-expanded={open === r.id}
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                    >
                      Before / after
                    </button>
                  </td>
                </tr>
                {open === r.id && (
                  <tr className="!cursor-default">
                    <td colSpan={5}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <pre className="overflow-x-auto bg-wall p-3 text-[0.75rem]">
                          {JSON.stringify(r.before, null, 2) ?? 'null'}
                        </pre>
                        <pre className="overflow-x-auto bg-wall p-3 text-[0.75rem]">
                          {JSON.stringify(r.after, null, 2) ?? 'null'}
                        </pre>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pages" className="mt-4 flex items-center justify-between">
        <button className="a-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← Newer
        </button>
        <span className="text-muted">
          Page {page + 1} of {pages}
        </span>
        <button className="a-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
          Older →
        </button>
      </nav>
    </div>
  );
}
