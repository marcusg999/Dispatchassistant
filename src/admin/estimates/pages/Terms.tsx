import { useCallback, useEffect, useState } from 'react';
import { ErrorNote, fmtDateTime } from '../../components/ui';
import { supabase } from '../../supabase';

interface TermsRow {
  id: string;
  version: number;
  title: string;
  body: string;
  is_current: boolean;
  created_by: string | null;
  created_at: string;
}

export function Terms() {
  const [rows, setRows] = useState<TermsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('terms_versions').select('*').order('version', { ascending: false });
    if (err) return setError(err.message);
    setRows(data as TermsRow[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const current = rows?.find((r) => r.is_current) ?? rows?.[0];

  function startNew() {
    setTitle(current?.title ?? 'Quote terms');
    setBody(current?.body ?? '');
    setNotice(null);
    setError(null);
    setEditing(true);
  }

  async function publish() {
    if (!rows) return;
    setError(null);
    if (body.trim().length < 10) return setError('The terms need at least 10 characters.');
    if (title.trim().length < 1) return setError('Give the terms a title.');
    setBusy(true);
    try {
      const next = Math.max(0, ...rows.map((r) => r.version)) + 1;
      const ins = await supabase.from('terms_versions').insert({ version: next, title: title.trim(), body, is_current: false }).select('id').single();
      if (ins.error) throw new Error(ins.error.message);
      const cur = await supabase.rpc('make_terms_current', { p_terms: ins.data.id });
      if (cur.error) throw new Error(cur.error.message);
      setNotice(`Version ${next} is now current. New quotes use it; quotes already sent keep the version the client saw.`);
      setEditing(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-[800] tracking-tight">Quote terms</h1>
        <p role="note" className="mt-2 max-w-3xl border-2 border-danger bg-paper p-4 font-bold text-danger">
          Have your own terms reviewed before sending real quotes. The seeded text is a placeholder.
        </p>
        <p className="mt-3 max-w-3xl text-muted">
          Terms are never edited in place. Each change is a new numbered version, so you can always show exactly which terms a client agreed to. The current version is attached to every new quote.
        </p>
        <ErrorNote error={error} />
        {notice && (
          <p role="status" className="mt-2 border-l-4 border-ink pl-3 font-semibold">
            {notice}
          </p>
        )}
      </div>

      {editing ? (
        <section className="a-panel p-5" aria-labelledby="new-h">
          <h2 id="new-h" className="text-lg font-bold">
            New version {rows ? Math.max(0, ...rows.map((r) => r.version)) + 1 : ''}
          </h2>
          <div className="mt-3 max-w-xl">
            <label htmlFor="terms-title" className="a-label">
              Title
            </label>
            <input id="terms-title" className="a-input" value={title} maxLength={120} onChange={(e) => setTitle(e.currentTarget.value)} />
          </div>
          <div className="mt-3">
            <label htmlFor="terms-body" className="a-label">
              Terms text (plain text, up to 40,000 characters)
            </label>
            <textarea id="terms-body" className="a-textarea min-h-[22rem] max-w-4xl font-mono text-[0.8125rem]" value={body} maxLength={40000} onChange={(e) => setBody(e.currentTarget.value)} />
            <p className="mt-1 text-[0.75rem] text-muted">{body.length.toLocaleString()} of 40,000 characters. Prefilled from the current version.</p>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="a-btn a-btn-primary" disabled={busy} onClick={publish}>
              {busy ? 'Saving…' : 'Save as new version and make current'}
            </button>
            <button type="button" className="a-btn" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <button type="button" className="a-btn a-btn-primary" onClick={startNew} disabled={!rows}>
          New version
        </button>
      )}

      <section aria-labelledby="ver-h">
        <h2 id="ver-h" className="text-lg font-bold">
          Versions
        </h2>
        <ul className="mt-3 space-y-3">
          {rows?.map((r) => (
            <li key={r.id} className="a-panel p-4">
              <details open={r.is_current}>
                <summary className="flex min-h-[36px] cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-bold">Version {r.version}</span>
                  <span>{r.title}</span>
                  {r.is_current && <span className="tag-chip tag-urgent">Current</span>}
                  <span className="text-[0.75rem] text-muted">
                    Added {fmtDateTime(r.created_at)}
                    {r.created_by ? ` by ${r.created_by}` : ''}
                  </span>
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap bg-wall p-3 font-sans text-[0.8125rem] leading-relaxed">{r.body}</pre>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
