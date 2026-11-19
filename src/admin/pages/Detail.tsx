import { useCallback, useEffect, useState } from 'react';
import { CATEGORY_LABEL, STATUSES, STATUS_LABEL, TAGS, TAG_LABEL, type Status, type Tag } from '../../shared/domain';
import {
  addNote,
  deleteNote,
  getSuggestion,
  hardDelete,
  listAudit,
  listNotes,
  photoUrl,
  restore,
  softDelete,
  updateSuggestion,
  type AuditRow,
  type Note,
  type SuggestionView,
} from '../data';
import { Link, navigate } from '../router';
import { Confirm, ErrorNote, TagChip, fmtDateTime } from '../components/ui';
import { describeAudit } from './Audit';

export function Detail({ id }: { id: string }) {
  const [s, setS] = useState<SuggestionView | null | undefined>(undefined);
  const [notes, setNotes] = useState<Note[]>([]);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [row, n, a] = await Promise.all([getSuggestion(id), listNotes(id), listAudit(0, id)]);
      setS(row);
      setNotes(n);
      setHistory(a.rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function patch(p: Parameters<typeof updateSuggestion>[1], msg: string) {
    setError(null);
    try {
      setS(await updateSuggestion(id, p));
      setSaved(msg);
      setTimeout(() => setSaved(null), 2500);
      setHistory((await listAudit(0, id)).rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (s === undefined) return <p className="text-muted">Loading…</p>;
  if (s === null)
    return (
      <div>
        <p>This suggestion doesn’t exist (it may have been permanently deleted).</p>
        <Link href="/admin" className="a-btn mt-3">
          Back to inbox
        </Link>
      </div>
    );

  return (
    <div>
      <Link href="/admin" className="text-[0.8125rem] font-semibold text-muted">
        ← Inbox
      </Link>
      {s.deleted_at && (
        <p className="mt-3 border-2 border-danger bg-paper p-3 font-semibold text-danger" role="status">
          In the trash since {fmtDateTime(s.deleted_at)}. Submitters can no longer see its status.
        </p>
      )}
      <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <article className="a-panel p-5 lg:p-6" aria-labelledby="body-h">
            <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted">
              <span className="stencil text-[0.6875rem] text-ink">{CATEGORY_LABEL[s.category]}</span>
              <span>·</span>
              <span>Received {fmtDateTime(s.created_at)}</span>
            </div>
            <h1 id="body-h" className="sr-only">
              Suggestion
            </h1>
            <p className="mt-4 whitespace-pre-wrap text-[1.0625rem] leading-relaxed">{s.body}</p>
            {s.photo_path && <Photo path={s.photo_path} />}
            <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4">
              <div>
                <dt className="a-label">Submitter said</dt>
                <dd>
                  <TagChip tag={s.submitter_tag} />
                </dd>
              </div>
              <div>
                <dt className="a-label">Current priority</dt>
                <dd>
                  <TagChip tag={s.admin_tag} />
                </dd>
              </div>
            </dl>
          </article>

          <PublicReply s={s} onSave={(v) => patch({ public_reply: v || null }, 'Reply saved')} />
          <Board s={s} onSave={patch} />
          <Notes
            notes={notes}
            onAdd={async (body) => {
              await addNote(id, body);
              setNotes(await listNotes(id));
              setHistory((await listAudit(0, id)).rows);
            }}
            onDelete={async (nid) => {
              await deleteNote(nid);
              setNotes(await listNotes(id));
              setHistory((await listAudit(0, id)).rows);
            }}
          />
        </div>

        <aside className="space-y-6">
          <section className="a-panel p-4" aria-labelledby="triage-h">
            <h2 id="triage-h" className="text-base font-bold">
              Triage
            </h2>
            <label className="a-label mt-4" htmlFor="admin-tag">
              Priority
            </label>
            <select
              id="admin-tag"
              className="a-select"
              value={s.admin_tag}
              onChange={(e) => patch({ admin_tag: e.currentTarget.value as Tag }, 'Priority updated')}
            >
              {TAGS.map((t) => (
                <option key={t} value={t}>
                  {TAG_LABEL[t]}
                  {t === s.submitter_tag ? ' (submitter’s choice)' : ''}
                </option>
              ))}
            </select>
            <fieldset className="mt-4">
              <legend className="a-label">Status</legend>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    className="a-toggle"
                    aria-pressed={s.status === st}
                    onClick={() => s.status !== st && patch({ status: st as Status }, `Status: ${STATUS_LABEL[st]}`)}
                  >
                    {STATUS_LABEL[st]}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="mt-3 min-h-[1.25rem] text-[0.8125rem] font-semibold text-accent-text" role="status">
              {saved}
            </p>
            <ErrorNote error={error} />
          </section>

          <section className="a-panel p-4" aria-labelledby="hist-h">
            <h2 id="hist-h" className="text-base font-bold">
              History
            </h2>
            <ol className="mt-3 space-y-2 text-[0.8125rem]">
              {history.length === 0 && <li className="text-muted">No admin actions yet.</li>}
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

          <DangerZone s={s} onChanged={reload} />
        </aside>
      </div>
    </div>
  );
}

function Photo({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      photoUrl(path)
        .then((u) => live && setUrl(u))
        .catch(() => live && setErr(true));
    void load();
    // Signed URLs live 5 minutes; refresh just before expiry while the page is open.
    const t = setInterval(load, 270_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [path]);
  if (err) return <p className="mt-4 text-danger">Couldn’t load the photo.</p>;
  if (!url) return <div className="mt-4 h-48 animate-pulse bg-wall" />;
  return (
    <figure className="mt-5">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt="Photo attached by the submitter" className="max-h-[28rem] w-auto border border-ink" />
      </a>
      <figcaption className="mt-1 text-[0.75rem] text-muted">Private photo · link expires in 5 minutes</figcaption>
    </figure>
  );
}

function PublicReply({ s, onSave }: { s: SuggestionView; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(s.public_reply ?? '');
  useEffect(() => setV(s.public_reply ?? ''), [s.public_reply]);
  const dirty = v.trim() !== (s.public_reply ?? '').trim();
  return (
    <section className="a-panel p-5" aria-labelledby="reply-h">
      <h2 id="reply-h" className="text-base font-bold">
        Public reply
      </h2>
      <p className="mt-1 text-muted">The submitter sees this when they check their tracking code.</p>
      <label htmlFor="reply" className="sr-only">
        Public reply
      </label>
      <textarea id="reply" className="a-textarea mt-3" maxLength={4000} value={v} onChange={(e) => setV(e.currentTarget.value)} />
      <div className="mt-2 flex justify-end">
        <button className="a-btn a-btn-primary" disabled={!dirty} onClick={() => onSave(v.trim())}>
          Save reply
        </button>
      </div>
    </section>
  );
}

function Board({
  s,
  onSave,
}: {
  s: SuggestionView;
  onSave: (p: { board_summary?: string | null; published_to_board?: boolean }, msg: string) => Promise<void>;
}) {
  const [v, setV] = useState(s.board_summary ?? '');
  useEffect(() => setV(s.board_summary ?? ''), [s.board_summary]);
  return (
    <section className="a-panel p-5" aria-labelledby="board-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="board-h" className="mr-auto text-base font-bold">
          “You said, we did” board
        </h2>
        <span className={`status-pill ${s.published_to_board ? 'bg-ink text-paper' : ''}`}>
          {s.published_to_board ? 'Published' : 'Not published'}
        </span>
      </div>
      <p className="mt-1 text-muted">
        Write a separate public summary. The original text and photo are never published. Avoid details that could
        identify the person who wrote it.
      </p>
      <label htmlFor="summary" className="sr-only">
        Board summary
      </label>
      <textarea id="summary" className="a-textarea mt-3" maxLength={1000} value={v} onChange={(e) => setV(e.currentTarget.value)} />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {s.published_to_board ? (
          <>
            <button
              className="a-btn"
              disabled={!v.trim() || v.trim() === s.board_summary}
              onClick={() => onSave({ board_summary: v.trim() }, 'Board summary updated')}
            >
              Update summary
            </button>
            <button className="a-btn" onClick={() => onSave({ published_to_board: false }, 'Removed from board')}>
              Unpublish
            </button>
          </>
        ) : (
          <button
            className="a-btn a-btn-accent"
            disabled={!v.trim()}
            onClick={() => onSave({ board_summary: v.trim(), published_to_board: true }, 'Published to board')}
          >
            Publish to board
          </button>
        )}
      </div>
    </section>
  );
}

function Notes({
  notes,
  onAdd,
  onDelete,
}: {
  notes: Note[];
  onAdd: (body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="a-panel p-5" aria-labelledby="notes-h">
      <h2 id="notes-h" className="text-base font-bold">
        Private notes
      </h2>
      <p className="mt-1 text-muted">Only admins see these. Never shown to the submitter.</p>
      <ol className="mt-4 space-y-3">
        {notes.length === 0 && <li className="text-muted">No notes yet.</li>}
        {notes.map((n) => (
          <li key={n.id} className="border-l-2 border-ink pl-3">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="mt-1 flex items-center gap-2 text-[0.75rem] text-muted">
              {n.author_email} · {fmtDateTime(n.created_at)}
              <button className="underline" onClick={() => onDelete(n.id)} aria-label={`Delete note from ${fmtDateTime(n.created_at)}`}>
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
          if (!v.trim()) return;
          setBusy(true);
          setErr(null);
          try {
            await onAdd(v.trim());
            setV('');
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="note" className="a-label">
          Add a note
        </label>
        <textarea id="note" className="a-textarea" maxLength={4000} value={v} onChange={(e) => setV(e.currentTarget.value)} />
        <div className="mt-2 flex justify-end">
          <button className="a-btn a-btn-primary" disabled={busy || !v.trim()}>
            Add note
          </button>
        </div>
        <ErrorNote error={err} />
      </form>
    </section>
  );
}

function DangerZone({ s, onChanged }: { s: SuggestionView; onChanged: () => Promise<void> }) {
  const [confirm, setConfirm] = useState<'soft' | 'hard' | null>(null);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="a-panel p-4" aria-labelledby="danger-h">
      <h2 id="danger-h" className="text-base font-bold">
        Delete
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {s.deleted_at ? (
          <button className="a-btn" onClick={async () => (await restore(s.id), onChanged())}>
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
      <ErrorNote error={err} />

      <Confirm
        open={confirm === 'soft'}
        title="Move to trash?"
        confirmLabel="Move to trash"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          try {
            await softDelete(s.id);
            await onChanged();
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        It disappears from the inbox and the board, and the tracking code stops working. You can restore it later.
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
            await hardDelete(s);
            navigate('/admin');
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <p>The text, photo and notes are erased and can’t be recovered. The audit log keeps a record that it was deleted.</p>
        <label className="a-label mt-4" htmlFor="type-delete">
          Type DELETE to confirm
        </label>
        <input id="type-delete" className="a-input" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} autoComplete="off" />
      </Confirm>
    </section>
  );
}
