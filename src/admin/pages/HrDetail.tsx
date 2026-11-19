import { useCallback, useEffect, useState } from 'react';
import { STATUSES, STATUS_LABEL, type Status } from '../../shared/domain';
import { listAudit, type AuditRow } from '../data';
import {
  addHrNote,
  deleteHrNote,
  getHrReport,
  hrHardDelete,
  listHrNotes,
  updateHrReport,
  type HrNote,
  type HrPatch,
  type HrReport,
} from '../hrData';
import { Link, navigate } from '../router';
import { Confirm, ErrorNote, fmtDateTime } from '../components/ui';
import { describeAudit } from './Audit';
import { HrBanner } from './HrInbox';

export function HrDetail({ id }: { id: string }) {
  const [r, setR] = useState<HrReport | null | undefined>(undefined);
  const [notes, setNotes] = useState<HrNote[]>([]);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'soft' | 'hard' | null>(null);
  const [typed, setTyped] = useState('');

  const refreshHistory = useCallback(async () => setHistory((await listAudit(0, id)).rows), [id]);
  const reload = useCallback(async () => {
    try {
      const [row, n] = await Promise.all([getHrReport(id), listHrNotes(id)]);
      setR(row);
      setReply(row?.public_reply ?? '');
      setNotes(n);
      await refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, refreshHistory]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function patch(p: HrPatch, msg: string) {
    setError(null);
    try {
      const row = await updateHrReport(id, p);
      setR(row);
      setSaved(msg);
      setTimeout(() => setSaved(null), 2500);
      await refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (r === undefined) return <p className="text-muted">Loading…</p>;
  if (r === null)
    return (
      <div className="space-y-3">
        <HrBanner />
        <p>This report doesn’t exist, or your account can’t see it.</p>
        <Link href="/admin/hr" className="a-btn">
          Back to HR inbox
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <HrBanner />
      <Link href="/admin/hr" className="text-[0.8125rem] font-semibold text-muted">
        ← HR inbox
      </Link>
      {r.deleted_at && (
        <p className="border-2 border-danger bg-paper p-3 font-semibold text-danger" role="status">
          In the trash since {fmtDateTime(r.deleted_at)}. The tracking code no longer works.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <article className="a-panel p-5 lg:p-6" aria-labelledby="hr-name">
            <p className="a-label">Reported by</p>
            <h1 id="hr-name" className="text-2xl font-[800] tracking-tight">
              {r.full_name}
            </h1>
            <p className="mt-1">
              <span className="text-muted">Contact: </span>
              {r.contact || <span className="text-muted">none given</span>}
            </p>
            <p className="mt-1 text-[0.8125rem] text-muted">Received {fmtDateTime(r.created_at)}</p>
            <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-[1.0625rem] leading-relaxed">
              {r.body}
            </p>
          </article>

          <section className="a-panel p-5" aria-labelledby="hr-reply-h">
            <h2 id="hr-reply-h" className="text-base font-bold">
              Reply to the person
            </h2>
            <p className="mt-1 text-muted">They see this when they check their tracking code.</p>
            <label htmlFor="hr-reply" className="sr-only">
              Reply to the person
            </label>
            <textarea
              id="hr-reply"
              className="a-textarea mt-3"
              maxLength={4000}
              value={reply}
              onChange={(e) => setReply(e.currentTarget.value)}
            />
            <div className="mt-2 flex justify-end">
              <button
                className="a-btn a-btn-primary"
                disabled={reply.trim() === (r.public_reply ?? '').trim()}
                onClick={() => patch({ public_reply: reply.trim() || null }, 'Reply saved')}
              >
                Save reply
              </button>
            </div>
          </section>

          <section className="a-panel p-5" aria-labelledby="hr-notes-h">
            <h2 id="hr-notes-h" className="text-base font-bold">
              Private HR notes
            </h2>
            <p className="mt-1 text-muted">Only HR members see these.</p>
            <ol className="mt-4 space-y-3">
              {notes.length === 0 && <li className="text-muted">No notes yet.</li>}
              {notes.map((n) => (
                <li key={n.id} className="border-l-2 border-ink pl-3">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 flex items-center gap-2 text-[0.75rem] text-muted">
                    {n.author_email} · {fmtDateTime(n.created_at)}
                    <button
                      className="underline"
                      onClick={async () => {
                        await deleteHrNote(n.id);
                        setNotes(await listHrNotes(id));
                        await refreshHistory();
                      }}
                    >
                      Delete
                    </button>
                  </p>
                </li>
              ))}
            </ol>
            <form
              className="mt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!note.trim()) return;
                try {
                  await addHrNote(id, note.trim());
                  setNote('');
                  setNotes(await listHrNotes(id));
                  await refreshHistory();
                } catch (x) {
                  setError((x as Error).message);
                }
              }}
            >
              <label htmlFor="hr-note" className="a-label">
                Add a note
              </label>
              <textarea
                id="hr-note"
                className="a-textarea"
                maxLength={4000}
                value={note}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
              <div className="mt-2 flex justify-end">
                <button className="a-btn a-btn-primary" disabled={!note.trim()}>
                  Add note
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="a-panel p-4" aria-labelledby="hr-status-h">
            <h2 id="hr-status-h" className="text-base font-bold">
              Status
            </h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="a-toggle"
                  aria-pressed={r.status === s}
                  onClick={() => r.status !== s && patch({ status: s as Status }, `Status: ${STATUS_LABEL[s]}`)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="mt-3 min-h-[1.25rem] text-[0.8125rem] font-semibold text-accent-text" role="status">
              {saved}
            </p>
            <ErrorNote error={error} />
          </section>

          <section className="a-panel p-4" aria-labelledby="hr-hist-h">
            <h2 id="hr-hist-h" className="text-base font-bold">
              History
            </h2>
            <ol className="mt-3 space-y-2 text-[0.8125rem]">
              {history.length === 0 && <li className="text-muted">No actions yet.</li>}
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3">
                  <span className="font-semibold">{describeAudit(h)}</span>
                  <span className="block text-muted">
                    {h.actor_email} · {fmtDateTime(h.created_at)}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="a-panel p-4" aria-labelledby="hr-del-h">
            <h2 id="hr-del-h" className="text-base font-bold">
              Delete
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {r.deleted_at ? (
                <button className="a-btn" onClick={() => patch({ deleted_at: null }, 'Restored')}>
                  Restore
                </button>
              ) : (
                <button className="a-btn" onClick={() => setConfirm('soft')}>
                  Move to trash
                </button>
              )}
              <button className="a-btn a-btn-danger" onClick={() => setConfirm('hard')}>
                Delete permanently
              </button>
            </div>
          </section>
        </aside>
      </div>

      <Confirm
        open={confirm === 'soft'}
        title="Move to trash?"
        confirmLabel="Move to trash"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          await patch({ deleted_at: new Date().toISOString() }, 'Moved to trash');
        }}
      >
        It leaves the HR inbox and the tracking code stops working. You can restore it later.
      </Confirm>
      <Confirm
        open={confirm === 'hard'}
        title="Delete permanently?"
        confirmLabel="Delete forever"
        danger
        disabled={typed !== 'DELETE'}
        onCancel={() => {
          setConfirm(null);
          setTyped('');
        }}
        onConfirm={async () => {
          setConfirm(null);
          setTyped('');
          try {
            await hrHardDelete(id);
            navigate('/admin/hr');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <p>The name, contact details, report and notes are erased and can’t be recovered.</p>
        <label className="a-label mt-4" htmlFor="hr-type-delete">
          Type DELETE to confirm
        </label>
        <input
          id="hr-type-delete"
          className="a-input"
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          autoComplete="off"
        />
      </Confirm>
    </div>
  );
}
