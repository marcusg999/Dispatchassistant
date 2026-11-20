import '../estimates.css';
import { useCallback, useEffect, useState } from 'react';
import { formatPhone, toE164 } from '../../../shared/dispatch';
import { formatCents } from '../../../shared/estimate';
import { Link, navigate } from '../../router';
import { Confirm, ErrorNote } from '../../components/ui';
import {
  CLIENT_KINDS,
  CLIENT_KIND_LABEL,
  STATUS_LABEL,
  clientHistory,
  deleteContact,
  getClient,
  listContacts,
  saveClient,
  saveContact,
  setPrimaryContact,
  type ClientHistory,
  type ClientKind,
  type ContactRow,
  type EstimateStatus,
} from '../data';
import { Field, StatusPill } from '../builder/shared';

export function ClientDetail({ id }: { id: string | null }) {
  return <Detail key={id ?? 'new'} id={id} />;
}

function Detail({ id }: { id: string | null }) {
  const [loaded, setLoaded] = useState(id === null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ClientKind>('other');
  const [address, setAddress] = useState('');
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getClient(id).then(
      (c) => {
        if (!c) return setError('That client doesn’t exist.');
        setName(c.name);
        setKind(c.kind);
        setAddress(c.billing_address ?? '');
        setDiscount(String(c.default_discount_bp / 100));
        setNotes(c.notes ?? '');
        setActive(c.active);
        setLoaded(true);
      },
      (e) => setError((e as Error).message),
    );
  }, [id]);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Add a name (at least 2 characters).';
    const pctNum = Number(discount.trim() === '' ? 0 : discount);
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 50) errs.discount = 'Use a percentage from 0 to 50.';
    else if (Math.abs(pctNum * 100 - Math.round(pctNum * 100)) > 1e-6) errs.discount = 'Up to 2 decimal places.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const c = await saveClient(id, {
        name: name.trim(),
        kind,
        billing_address: address.trim() || null,
        default_discount_bp: Math.round(pctNum * 100),
        notes: notes.trim() || null,
        active,
      });
      if (!id) navigate(`/admin/estimates/clients/${c.id}`);
      else setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded && !error) return <p className="text-muted" role="status">Loading…</p>;
  return (
    <div className="est-builder">
      <p>
        <Link href="/admin/estimates/clients" className="underline">
          ← Clients
        </Link>
      </p>
      <h1 className="est-h1">{id ? name || 'Client' : 'New client'}</h1>
      <ErrorNote error={error} />
      <form
        className="a-panel est-section mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="est-h2 mb-3">Details</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Name" error={errors.name}>
            <input className="a-input" value={name} maxLength={140} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Kind">
            <select className="a-select" value={kind} onChange={(e) => setKind(e.target.value as ClientKind)}>
              {CLIENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CLIENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Billing address" className="md:col-span-2">
            <textarea className="a-textarea" value={address} maxLength={400} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Default discount (%)" error={errors.discount} hint="Applied to new estimates unless the estimator sets another. 0 to 50.">
            <input className="a-input est-num" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <label className="est-check self-end">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Active (inactive clients are hidden from new estimates)</span>
          </label>
          <Field label="Notes" className="md:col-span-2">
            <textarea className="a-textarea" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="a-btn a-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : id ? 'Save client' : 'Create client'}
          </button>
          <p role="status" aria-live="polite" className="font-semibold">
            {saved ? 'Saved' : ''}
          </p>
        </div>
      </form>
      {id ? (
        <>
          <Contacts clientId={id} />
          <History clientId={id} />
        </>
      ) : (
        <p className="est-hint mt-3">Save the client first, then add contacts.</p>
      )}
    </div>
  );
}

interface ContactForm {
  id: string | null;
  name: string;
  role: string;
  email: string;
  phone: string;
  is_primary: boolean;
  error?: string;
  saved?: boolean;
}
const fromRow = (c: ContactRow): ContactForm => ({ id: c.id, name: c.name, role: c.role ?? '', email: c.email ?? '', phone: formatPhone(c.phone) || (c.phone ?? ''), is_primary: c.is_primary });

function Contacts({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<ContactForm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<ContactForm | null>(null);
  const load = useCallback(async () => {
    try {
      setRows((await listContacts(clientId)).map(fromRow));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [clientId]);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = (i: number, p: Partial<ContactForm>) => setRows((r) => (r ?? []).map((x, j) => (j === i ? { ...x, ...p, saved: false } : x)));
  const saveRow = async (i: number) => {
    const c = rows![i];
    let msg = '';
    let phone: string | null = null;
    if (c.name.trim().length < 2) msg = 'Add a name (at least 2 characters).';
    else if (c.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) msg = 'That email doesn’t look right.';
    else if (c.phone.trim()) {
      phone = toE164(c.phone);
      if (!phone) msg = 'Use a full phone number, e.g. 323 555 1234.';
    }
    if (msg) return setRows((r) => (r ?? []).map((x, j) => (j === i ? { ...x, error: msg } : x)));
    try {
      const row = await saveContact(clientId, c.id, { name: c.name.trim(), role: c.role.trim() || null, email: c.email.trim() || null, phone });
      setRows((r) => (r ?? []).map((x, j) => (j === i ? { ...fromRow(row), is_primary: x.is_primary, saved: true } : x)));
    } catch (e) {
      setRows((r) => (r ?? []).map((x, j) => (j === i ? { ...x, error: (e as Error).message } : x)));
    }
  };
  const makePrimary = async (i: number) => {
    const c = rows![i];
    if (!c.id) return;
    try {
      await setPrimaryContact(clientId, c.id);
      setRows((r) => (r ?? []).map((x, j) => ({ ...x, is_primary: j === i })));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    const c = del;
    setDel(null);
    if (!c) return;
    try {
      if (c.id) await deleteContact(c.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section aria-labelledby="contacts-h" className="a-panel est-section mt-4">
      <h2 id="contacts-h" className="est-h2 mb-3">
        Contacts
      </h2>
      <ErrorNote error={error} />
      {rows === null ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <fieldset>
          <legend className="sr-only">Contacts. Choose the primary contact with the radio button.</legend>
          <ul className="space-y-3">
            {rows.length === 0 ? <li className="text-muted">No contacts yet.</li> : null}
            {rows.map((c, i) => (
              <li key={c.id ?? `new-${i}`} className="est-card">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <Field label="Name">
                    <input className="a-input" value={c.name} maxLength={100} onChange={(e) => patch(i, { name: e.target.value, error: undefined })} />
                  </Field>
                  <Field label="Role">
                    <input className="a-input" value={c.role} maxLength={80} onChange={(e) => patch(i, { role: e.target.value, error: undefined })} />
                  </Field>
                  <Field label="Email">
                    <input className="a-input" type="email" value={c.email} onChange={(e) => patch(i, { email: e.target.value, error: undefined })} />
                  </Field>
                  <Field label="Phone">
                    <input className="a-input" inputMode="tel" value={c.phone} onChange={(e) => patch(i, { phone: e.target.value, error: undefined })} />
                  </Field>
                </div>
                {c.error ? (
                  <p role="alert" className="est-err">
                    {c.error}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="est-check">
                    <input type="radio" name="primary-contact" checked={c.is_primary} disabled={!c.id} onChange={() => makePrimary(i)} />
                    <span>Primary contact{!c.id ? ' (save first)' : ''}</span>
                  </label>
                  <button type="button" className="a-btn" onClick={() => saveRow(i)}>
                    Save contact<span className="sr-only"> {c.name}</span>
                  </button>
                  <button type="button" className="a-btn a-btn-danger" onClick={() => (c.id ? setDel(c) : setRows((r) => (r ?? []).filter((_, j) => j !== i)))}>
                    Remove<span className="sr-only"> {c.name}</span>
                  </button>
                  <span role="status" aria-live="polite" className="font-semibold">
                    {c.saved ? 'Saved' : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <button type="button" className="a-btn est-add" onClick={() => setRows((r) => [...(r ?? []), { id: null, name: '', role: '', email: '', phone: '', is_primary: false }])}>
        + Add contact
      </button>
      <Confirm open={!!del} title="Remove this contact?" confirmLabel="Remove" danger onConfirm={remove} onCancel={() => setDel(null)}>
        <p>{del?.name} will be removed from this client. Estimates that used them keep working without a contact.</p>
      </Confirm>
    </section>
  );
}

function History({ clientId }: { clientId: string }) {
  const [h, setH] = useState<ClientHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    clientHistory(clientId).then(setH, (e) => setError((e as Error).message));
  }, [clientId]);
  return (
    <section aria-labelledby="history-h" className="a-panel est-section mt-4">
      <h2 id="history-h" className="est-h2 mb-3">
        History
      </h2>
      <ErrorNote error={error} />
      {!h ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <h3 className="a-label">Estimates</h3>
            {h.estimates.length === 0 ? (
              <p className="text-muted">No estimates yet.</p>
            ) : (
              <div className="est-table-wrap">
                <table className="a-table est-list">
                  <caption className="sr-only">Estimates for this client</caption>
                  <thead>
                    <tr>
                      <th scope="col">Number</th>
                      <th scope="col">Title</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="est-r">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.estimates.map((e) => (
                      <tr key={e.id} onClick={() => navigate(`/admin/estimates/${e.id}`)}>
                        <td>
                          <Link href={`/admin/estimates/${e.id}`} className="est-mono underline" onClick={(ev) => ev.stopPropagation()}>
                            {e.estimate_number}
                          </Link>
                          <span className="est-hint block">Rev {e.revision}</span>
                        </td>
                        <td>{e.title}</td>
                        <td>
                          <StatusPill status={e.status as EstimateStatus} />
                          <span className="sr-only"> {STATUS_LABEL[e.status as EstimateStatus]}</span>
                        </td>
                        <td className="est-money">{formatCents(Number(e.total_cents))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h3 className="a-label">Jobs</h3>
            {h.jobsError ? (
              <p className="est-hint">Jobs aren’t visible to your role.</p>
            ) : h.jobs.length === 0 ? (
              <p className="text-muted">No jobs yet.</p>
            ) : (
              <div className="est-table-wrap">
                <table className="a-table est-list">
                  <caption className="sr-only">Jobs for this client</caption>
                  <thead>
                    <tr>
                      <th scope="col">Job</th>
                      <th scope="col">Title</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.jobs.map((j) => (
                      <tr key={j.id} onClick={() => navigate(`/admin/dispatch/jobs/${j.id}`)}>
                        <td>
                          <Link href={`/admin/dispatch/jobs/${j.id}`} className="est-mono underline" onClick={(ev) => ev.stopPropagation()}>
                            {j.job_number}
                          </Link>
                        </td>
                        <td>{j.title}</td>
                        <td>{j.status.replace('_', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
