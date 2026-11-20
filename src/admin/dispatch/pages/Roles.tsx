import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { STAFF_ROLES, type StaffRole } from '../../../shared/dispatch';
import { listStaffRoles, removeStaffRole, setStaffRole, type StaffRoleRow } from '../data';
import { supabase } from '../../supabase';
import { Link } from '../../router';
import { Confirm, ErrorNote, fmtDateTime } from '../../components/ui';

const ROLE_HINT: Record<StaffRole, string> = {
  admin: 'Everything, including the suggestion box and staff roles.',
  dispatcher: 'Creates, edits and assigns jobs, crew, assets and time off.',
  viewer: 'Sees the board and details; can’t change anything.',
  crew: 'Sees only their own assigned jobs (My jobs).',
};
const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Admin', dispatcher: 'Dispatcher', viewer: 'Viewer', crew: 'Crew' };

export function Roles() {
  const [rows, setRows] = useState<StaffRoleRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('dispatcher');
  const [me, setMe] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const reload = () => listStaffRoles().then(setRows).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void reload();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.email?.toLowerCase() ?? ''));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Enter a valid email.');
    try {
      await setStaffRole(email, role);
      setEmail('');
      await reload();
    } catch (x) {
      setError((x as Error).message);
    }
  }

  const admins = rows?.filter((r) => r.role === 'admin').length ?? 0;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-[800] tracking-tight">Staff roles</h1>
      <p className="mt-1 text-muted">
        One role per email. People sign in with this email (password or Google). For crew, use the same email as on their{' '}
        <Link href="/admin/dispatch/crew" className="underline">
          crew record
        </Link>{' '}
        so My jobs shows their work. HR access is managed separately on the HR team page.
      </p>

      <form className="a-panel mt-6 grid gap-3 p-4 md:grid-cols-[1fr_12rem_auto] md:items-end" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="sr-email" className="a-label">
            Email
          </label>
          <input id="sr-email" type="email" className="a-input" value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="name@example.com" />
        </div>
        <div>
          <label htmlFor="sr-role" className="a-label">
            Role
          </label>
          <select id="sr-role" className="a-select" value={role} onChange={(e) => setRole(e.currentTarget.value as StaffRole)}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <button className="a-btn a-btn-primary">Save role</button>
        <p className="text-[0.8125rem] text-muted md:col-span-3">{ROLE_HINT[role]} If the email already has a role, it’s replaced.</p>
      </form>
      <ErrorNote error={error} />

      <div className="a-panel mt-6 overflow-x-auto">
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col" className="hidden sm:table-cell">
                Added by
              </th>
              <th scope="col" className="hidden sm:table-cell">
                Added
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.email} className="!cursor-default">
                <td className="break-all font-semibold">
                  {r.email}
                  {r.email === me && <span className="ml-2 font-normal text-muted">(you)</span>}
                </td>
                <td>
                  <label className="sr-only" htmlFor={`role-${r.email}`}>
                    Role for {r.email}
                  </label>
                  <select
                    id={`role-${r.email}`}
                    className="a-select !min-h-[36px] !w-auto"
                    value={r.role}
                    onChange={async (e) => {
                      setError(null);
                      try {
                        await setStaffRole(r.email, e.currentTarget.value as StaffRole);
                      } catch (x) {
                        setError((x as Error).message);
                      }
                      await reload();
                    }}
                  >
                    {STAFF_ROLES.map((x) => (
                      <option key={x} value={x}>
                        {ROLE_LABEL[x]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="hidden text-muted sm:table-cell">{r.added_by ?? '·'}</td>
                <td className="hidden whitespace-nowrap text-muted sm:table-cell">{fmtDateTime(r.created_at)}</td>
                <td className="text-right">
                  <button
                    className="a-btn a-btn-sm a-btn-danger"
                    disabled={r.role === 'admin' && admins <= 1}
                    title={r.role === 'admin' && admins <= 1 ? 'The last admin can’t be removed' : undefined}
                    onClick={() => setRemoving(r.email)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Confirm
        open={!!removing}
        title="Remove access?"
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing!;
          setRemoving(null);
          setError(null);
          try {
            await removeStaffRole(target);
            if (target === me) await supabase.auth.signOut();
            else await reload();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        {removing === me ? 'You are removing your own access. You’ll be signed out.' : `${removing} will lose access immediately.`}
      </Confirm>
    </div>
  );
}
