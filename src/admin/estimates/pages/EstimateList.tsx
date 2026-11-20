import '../estimates.css';
import { useCallback, useEffect, useState } from 'react';
import { Link, navigate } from '../../router';
import { Confirm, ErrorNote } from '../../components/ui';
import {
  ESTIMATE_STATUSES,
  STATUS_LABEL,
  callAction,
  listClients,
  listEstimates,
  listEstimators,
  listTemplates,
  type ClientRow,
  type EstimateAction,
  type EstimateListRow,
  type EstimateStatus,
} from '../data';
import { Field, MarginBadge, Money, QuoteLinkPanel, StatusPill } from '../builder/shared';

export function EstimateList({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<EstimateStatus[]>([]);
  const [clientId, setClientId] = useState('');
  const [estimator, setEstimator] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<EstimateListRow[] | null>(null);
  const [templates, setTemplates] = useState<EstimateListRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [estimators, setEstimators] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendFor, setSendFor] = useState<EstimateListRow | null>(null);
  const [link, setLink] = useState<{ number: string; path: string; valid_until: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await listEstimates({ status, client_id: clientId || undefined, estimator_email: estimator || undefined, from: from || undefined, to: to || undefined }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status, clientId, estimator, from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    Promise.all([listClients(), listEstimators(), listTemplates()]).then(
      ([c, e, t]) => {
        setClients(c);
        setEstimators(e);
        setTemplates(t);
      },
      (e) => setError((e as Error).message),
    );
  }, []);

  const run = async (row: EstimateListRow, action: EstimateAction, body: Record<string, unknown> = {}) => {
    setBusy(row.id);
    setError(null);
    try {
      return await callAction(row.id, action, body);
    } catch (e) {
      setError(`${row.estimate_number}: ${(e as Error).message}`);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const open = (id: string) => navigate(`/admin/estimates/${id}`);
  const duplicate = async (row: EstimateListRow) => {
    const r = await run(row, 'duplicate');
    if (r?.id) open(r.id);
  };
  const revise = async (row: EstimateListRow) => {
    const r = await run(row, 'revise');
    if (r?.id) open(r.id);
  };
  const send = async () => {
    const row = sendFor;
    setSendFor(null);
    if (!row) return;
    const r = await run(row, 'send', { expected_version: row.version, client_total_cents: row.total_cents });
    if (r?.path) {
      setLink({ number: row.estimate_number, path: r.path, valid_until: r.valid_until ?? null });
      void load();
    }
  };
  const canSend = (e: EstimateListRow) => (e.status === 'approved' || (e.status === 'draft' && !e.needs_approval)) && e.total_cents > 0;
  const toggleStatus = (s: EstimateStatus) => setStatus((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="est-builder">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="est-h1">Estimates</h1>
        <div className="flex gap-2">
          {isAdmin ? (
            <Link href="/admin/estimates/approvals" className="a-btn">
              Approvals
            </Link>
          ) : null}
          <Link href="/admin/estimates/new" className="a-btn a-btn-primary">
            New estimate
          </Link>
        </div>
      </div>
      <ErrorNote error={error} />
      {notice && (
        <p role="status" className="mt-2 border-l-4 border-ink pl-3 font-semibold">
          {notice}
        </p>
      )}
      {link ? <QuoteLinkPanel path={link.path} validUntil={link.valid_until} onClose={() => setLink(null)} /> : null}

      <section aria-label="Filters" className="a-panel est-filters mt-3">
        <fieldset className="col-span-full">
          <legend className="a-label">Status (choose any)</legend>
          <div className="est-statuses">
            {ESTIMATE_STATUSES.map((s) => (
              <button key={s} type="button" className="a-toggle est-tap" aria-pressed={status.includes(s)} onClick={() => toggleStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Client">
          <select className="a-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estimator">
          <select className="a-select" value={estimator} onChange={(e) => setEstimator(e.target.value)}>
            <option value="">All estimators</option>
            {estimators.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Created from">
          <input className="a-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Created to">
          <input className="a-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button
          type="button"
          className="a-btn"
          onClick={() => {
            setStatus([]);
            setClientId('');
            setEstimator('');
            setFrom('');
            setTo('');
          }}
        >
          Clear filters
        </button>
      </section>

      <section aria-label="Estimates" className="a-panel mt-4">
        {rows === null ? (
          <p className="p-4 text-muted" role="status">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-muted">No estimates match. Try clearing the filters, or start a new estimate.</p>
        ) : (
          <div className="est-table-wrap">
            <table className="a-table est-list">
              <caption className="sr-only">Estimates</caption>
              <thead>
                <tr>
                  <th scope="col">Estimate</th>
                  <th scope="col">Client</th>
                  <th scope="col">Title</th>
                  <th scope="col" className="est-r">
                    Total
                  </th>
                  <th scope="col" className="est-r">
                    Margin
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Valid until</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} onClick={() => open(e.id)}>
                    <td>
                      <Link href={`/admin/estimates/${e.id}`} className="est-mono underline" onClick={(ev) => ev.stopPropagation()}>
                        {e.estimate_number}
                      </Link>
                      <span className="est-hint block">Rev {e.revision}</span>
                    </td>
                    <td>{e.client?.name ?? <span className="text-muted">No client</span>}</td>
                    <td>{e.title}</td>
                    <td className="est-money">
                      <Money cents={e.total_cents} />
                    </td>
                    <td className="est-money">
                      <MarginBadge margin_bp={e.margin_bp} target_bp={e.target_bp} total_cents={e.total_cents} />
                    </td>
                    <td>
                      <StatusPill status={e.status} />
                    </td>
                    <td>{e.valid_until ?? <span className="text-muted">—</span>}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <div className="est-rowactions">
                        <button type="button" className="a-btn a-btn-sm est-tap" disabled={busy === e.id} onClick={() => duplicate(e)}>
                          Duplicate<span className="sr-only"> {e.estimate_number}</span>
                        </button>
                        {e.status !== 'draft' ? (
                          <button type="button" className="a-btn a-btn-sm est-tap" disabled={busy === e.id} onClick={() => revise(e)}>
                            New revision<span className="sr-only"> of {e.estimate_number}</span>
                          </button>
                        ) : null}
                        {canSend(e) ? (
                          <button type="button" className="a-btn a-btn-sm est-tap" disabled={busy === e.id} onClick={() => setSendFor(e)}>
                            Send<span className="sr-only"> {e.estimate_number}</span>
                          </button>
                        ) : null}
                        {e.status === 'accepted' ? (
                          <button
                            type="button"
                            className="a-btn a-btn-sm est-tap"
                            disabled={busy === e.id}
                            onClick={async () => {
                              const r = await run(e, 'convert');
                              if (r?.job_id && isAdmin) navigate(`/admin/dispatch/jobs/${r.job_id}`);
                              else if (r?.job_id) {
                                setNotice(`${e.estimate_number} converted to a draft job. A dispatcher will schedule it on the board.`);
                                load();
                              }
                            }}
                          >
                            Convert to job<span className="sr-only"> {e.estimate_number}</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="tmpl-h" className="a-panel est-section mt-4">
        <h2 id="tmpl-h" className="est-h2">
          Templates
        </h2>
        {templates.length === 0 ? (
          <p className="est-hint">No templates yet. Open an estimate and choose “Save as template”.</p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((t) => (
              <li key={t.id} className="est-card flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{t.template_name || t.title}</p>
                  <p className="est-hint">
                    <Money cents={t.total_cents} className="inline" /> · based on {t.estimate_number}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="a-btn est-tap"
                    disabled={busy === t.id}
                    onClick={async () => {
                      const r = await run(t, 'duplicate');
                      if (r?.id) open(r.id);
                    }}
                  >
                    Start from template<span className="sr-only">: {t.template_name || t.title}</span>
                  </button>
                  <Link href={`/admin/estimates/${t.id}`} className="a-btn est-tap">
                    Edit<span className="sr-only"> template {t.template_name || t.title}</span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Confirm open={!!sendFor} title="Send this quote?" confirmLabel="Create quote link" onConfirm={send} onCancel={() => setSendFor(null)}>
        <p>
          This locks {sendFor?.estimate_number} and creates a link for the client. The link is shown once and can’t be shown again.
        </p>
      </Confirm>
    </div>
  );
}
