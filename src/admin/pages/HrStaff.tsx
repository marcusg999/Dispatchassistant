import { useEffect, useState } from 'react';
import { addHrStaff, listHrStaff, removeHrStaff, type HrMember } from '../hrData';
import { supabase } from '../supabase';
import { Confirm, ErrorNote, fmtDateTime } from '../components/ui';

export function HrStaff() {
  const [members, setMembers] = useState<HrMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [me, setMe] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const reload = () =>
    listHrStaff()
      .then(setMembers)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void reload();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.email?.toLowerCase() ?? ''));
  }, []);
  const onlyOne = (members?.length ?? 0) <= 1;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-[800] tracking-tight">HR team</h1>
      <p className="mt-1 text-muted">
        These Google accounts can read “HR eyes only” reports. Only HR members can see or change this list. Admins
        can’t.
      </p>

      <form
        className="a-panel mt-6 flex flex-wrap items-end gap-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await addHrStaff(email);
            setEmail('');
            await reload();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="new-hr" className="a-label">
            Add an HR member (Google email)
          </label>
          <input
            id="new-hr"
            type="email"
            required
            className="a-input"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="name@example.com"
          />
        </div>
        <button className="a-btn a-btn-primary">Add HR member</button>
      </form>
      <ErrorNote error={error} />

      <div className="a-panel mt-6 overflow-x-auto">
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Email</th>
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
            {members?.map((m) => (
              <tr key={m.email} className="!cursor-default">
                <td className="break-all font-semibold">
                  {m.email}
                  {m.email === me && <span className="ml-2 font-normal text-muted">(you)</span>}
                </td>
                <td className="hidden text-muted sm:table-cell">{m.added_by ?? '·'}</td>
                <td className="hidden whitespace-nowrap text-muted sm:table-cell">{fmtDateTime(m.created_at)}</td>
                <td className="text-right">
                  <button
                    className="a-btn a-btn-sm a-btn-danger"
                    disabled={onlyOne}
                    title={onlyOne ? 'The last HR member can’t be removed' : undefined}
                    onClick={() => setRemoving(m.email)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onlyOne && <p className="mt-2 text-muted">You’re the only HR member. Add another before removing yourself.</p>}

      <Confirm
        open={!!removing}
        title="Remove HR member?"
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing!;
          setRemoving(null);
          setError(null);
          try {
            await removeHrStaff(target);
            if (target === me) await supabase.auth.signOut();
            else await reload();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        {removing === me
          ? 'You are removing yourself. You’ll lose access to HR reports immediately.'
          : `${removing} will lose access to HR reports immediately.`}
      </Confirm>
    </div>
  );
}
