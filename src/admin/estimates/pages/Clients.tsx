import '../estimates.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, navigate } from '../../router';
import { ErrorNote } from '../../components/ui';
import { CLIENT_KIND_LABEL, listClients, type ClientRow } from '../data';
import { Field } from '../builder/shared';

export function Clients() {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  useEffect(() => {
    listClients().then(setRows, (e) => setError((e as Error).message));
  }, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((c) => (showInactive || c.active) && (!t || c.name.toLowerCase().includes(t)));
  }, [rows, q, showInactive]);
  return (
    <div className="est-builder">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="est-h1">Clients</h1>
        <Link href="/admin/estimates/clients/new" className="a-btn a-btn-primary">
          Add client
        </Link>
      </div>
      <ErrorNote error={error} />
      <div className="a-panel est-filters mt-3">
        <Field label="Search clients">
          <input className="a-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <label className="est-check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span>Show inactive clients</span>
        </label>
      </div>
      <section aria-label="Clients" className="a-panel mt-4">
        {rows === null ? (
          <p className="p-4 text-muted" role="status">
            Loading…
          </p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-muted">No clients match.</p>
        ) : (
          <div className="est-table-wrap">
            <table className="a-table est-list">
              <caption className="sr-only">Clients</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="est-r">
                    Default discount
                  </th>
                  <th scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/admin/estimates/clients/${c.id}`)}>
                    <td>
                      <Link href={`/admin/estimates/clients/${c.id}`} className="font-bold underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                    </td>
                    <td>{CLIENT_KIND_LABEL[c.kind]}</td>
                    <td className="est-money">{(c.default_discount_bp / 100).toFixed(2)}%</td>
                    <td>{c.active ? 'Active' : 'Inactive'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
