import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ASSET_CAPABILITIES,
  ASSET_CAPABILITY_LABEL,
  ASSET_KINDS,
  ASSET_KIND_LABEL,
  ASSET_STATUSES,
  ASSET_STATUS_LABEL,
  type AssetCapability,
  type AssetKind,
  type AssetStatus,
} from '../../../shared/dispatch';
import { listAssets, saveAsset, type Asset } from '../data';
import { ErrorNote } from '../../components/ui';

const blank = { kind: 'truck' as AssetKind, name: '', capabilities: [] as string[], length: '', status: 'in_service' as AssetStatus, notes: '', active: true };

export function Assets({ canEdit }: { canEdit: boolean }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);

  const reload = () => listAssets().then(setAssets).catch((e: Error) => setError(e.message));
  useEffect(() => void reload(), []);

  function startEdit(a: Asset | null) {
    setError(null);
    setEditing(a ? a.id : 'new');
    setForm(
      a
        ? { kind: a.kind as AssetKind, name: a.name, capabilities: a.capabilities, length: a.length_ft?.toString() ?? '', status: a.status as AssetStatus, notes: a.notes ?? '', active: a.active }
        : blank,
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 1) return setError('Give the asset a name or unit number.');
    const len = form.length.trim() ? Number(form.length) : null;
    if (len !== null && (!Number.isFinite(len) || len < 1 || len > 80)) return setError('Length must be between 1 and 80 ft.');
    try {
      await saveAsset(editing === 'new' ? null : editing, {
        kind: form.kind,
        name: form.name.trim(),
        capabilities: form.capabilities,
        length_ft: len,
        status: form.status,
        notes: form.notes.trim() || null,
        active: form.active,
      });
      setEditing(null);
      await reload();
    } catch (x) {
      setError((x as Error).message);
    }
  }

  async function quickStatus(a: Asset, status: AssetStatus) {
    const prev = assets;
    setAssets((list) => list?.map((x) => (x.id === a.id ? { ...x, status } : x)) ?? null);
    try {
      await saveAsset(a.id, { kind: a.kind, name: a.name, capabilities: a.capabilities, length_ft: a.length_ft, status, notes: a.notes });
    } catch (x) {
      setAssets(prev);
      setError((x as Error).message);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-2xl font-[800] tracking-tight">Assets</h1>
        {canEdit && (
          <button className="a-btn a-btn-primary" onClick={() => startEdit(null)}>
            Add asset
          </button>
        )}
      </div>
      <ErrorNote error={error} />

      {editing && (
        <form className="a-panel mt-4 grid gap-4 p-5 md:grid-cols-4" onSubmit={onSubmit} noValidate aria-label={editing === 'new' ? 'Add asset' : 'Edit asset'}>
          <div>
            <label htmlFor="as-kind" className="a-label">
              Kind
            </label>
            <select id="as-kind" className="a-select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.currentTarget.value as AssetKind })}>
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ASSET_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="as-name" className="a-label">
              Name / unit number
            </label>
            <input id="as-name" className="a-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          </div>
          <div>
            <label htmlFor="as-len" className="a-label">
              Length (ft)
            </label>
            <input id="as-len" inputMode="decimal" className="a-input" value={form.length} onChange={(e) => setForm({ ...form, length: e.currentTarget.value })} />
          </div>
          <div>
            <label htmlFor="as-status" className="a-label">
              Status
            </label>
            <select id="as-status" className="a-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.currentTarget.value as AssetStatus })}>
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ASSET_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="md:col-span-4">
            <legend className="a-label">Capabilities</legend>
            <div className="flex flex-wrap gap-2">
              {ASSET_CAPABILITIES.map((c) => (
                <label key={c} className="flex min-h-[44px] items-center gap-2 border border-line px-3">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={form.capabilities.includes(c)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setForm((f) => ({ ...f, capabilities: on ? [...f.capabilities, c] : f.capabilities.filter((x) => x !== c) }));
                    }}
                  />
                  {ASSET_CAPABILITY_LABEL[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="md:col-span-3">
            <label htmlFor="as-notes" className="a-label">
              Notes
            </label>
            <input id="as-notes" className="a-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} />
          </div>
          <label className="flex min-h-[44px] items-center gap-2 self-end">
            <input type="checkbox" className="size-4" checked={form.active} onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })} />
            Active
          </label>
          <div className="flex gap-2 md:col-span-4">
            <button className="a-btn a-btn-primary">Save asset</button>
            <button type="button" className="a-btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="a-panel mt-4 overflow-x-auto">
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Kind</th>
              <th scope="col">Capabilities</th>
              <th scope="col">Length</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {assets?.map((a) => (
              <tr key={a.id} className={`!cursor-default ${a.active ? '' : 'opacity-60'}`}>
                <td className="font-semibold">
                  {a.name}
                  {!a.active && <span className="ml-2 font-normal text-muted">(inactive)</span>}
                  {a.notes && <span className="block text-[0.75rem] font-normal text-muted">{a.notes}</span>}
                </td>
                <td>{ASSET_KIND_LABEL[a.kind as AssetKind]}</td>
                <td>
                  <ul className="flex flex-wrap gap-1">
                    {a.capabilities.map((c) => (
                      <li key={c} className="skill-chip">
                        {ASSET_CAPABILITY_LABEL[c as AssetCapability] ?? c}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="whitespace-nowrap">{a.length_ft ? `${a.length_ft} ft` : '·'}</td>
                <td>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`Status of ${a.name}`}>
                      {ASSET_STATUSES.map((s) => (
                        <button key={s} type="button" className="a-toggle" aria-pressed={a.status === s} onClick={() => a.status !== s && quickStatus(a, s)}>
                          {ASSET_STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    ASSET_STATUS_LABEL[a.status as AssetStatus]
                  )}
                </td>
                <td className="text-right">
                  {canEdit && (
                    <button className="a-btn a-btn-sm" onClick={() => startEdit(a)} aria-label={`Edit ${a.name}`}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
