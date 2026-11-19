import { useEffect, useState } from 'react';
import { addAdmin, listAdmins, removeAdmin, type Admin } from '../data';
import { supabase } from '../supabase';
import { Confirm, ErrorNote, fmtDateTime } from '../components/ui';

export function Admins() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [email, setEmail] = useState('');
  const [me, setMe] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const reload = () => listAdmins().then(setAdmins).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void reload();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.email?.toLowerCase() ?? ''));
  }, []);

  const onlyOne = (admins?.length ?? 0) <= 1;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-[800] tracking-tight">Admins</h1>
      <p className="mt-1 text-muted">
        Only these Google accounts can sign in to the console. Everyone else is refused before an account is even
        created.
      </p>

      <form
        className="a-panel mt-6 flex flex-wrap items-end gap-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await addAdmin(email);
            setEmail('');
            await reload();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="new-admin" className="a-label">
            Add an admin (Google email)
          </label>
          <input
            id="new-admin"
            type="email"
            required
            className="a-input"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="name@example.com"
          />
        </div>
        <button className="a-btn a-btn-primary">Add admin</button>
      </form>
      <ErrorNote error={error} />

      <table className="a-table a-panel mt-6">
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Added by</th>
            <th scope="col">Added</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {admins?.map((a) => (
            <tr key={a.email} className="!cursor-default">
              <td className="font-semibold">
                {a.email}
                {a.email === me && <span className="ml-2 font-normal text-muted">(you)</span>}
              </td>
              <td className="text-muted">{a.added_by ?? '·'}</td>
              <td className="whitespace-nowrap text-muted">{fmtDateTime(a.created_at)}</td>
              <td className="text-right">
                <button
                  className="a-btn a-btn-sm a-btn-danger"
                  disabled={onlyOne}
                  title={onlyOne ? 'The last admin can’t be removed' : undefined}
                  onClick={() => setRemoving(a.email)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {onlyOne && <p className="mt-2 text-muted">You’re the only admin. Add another before removing yourself.</p>}

      <Confirm
        open={!!removing}
        title="Remove admin?"
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing!;
          setRemoving(null);
          setError(null);
          try {
            await removeAdmin(target);
            if (target === me) await supabase.auth.signOut();
            else await reload();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        {removing === me
          ? 'You are removing yourself. You’ll be signed out and lose access immediately.'
          : `${removing} will lose access to the console immediately.`}
      </Confirm>
    </div>
  );
}
