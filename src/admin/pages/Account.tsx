import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../supabase';
import { ErrorNote } from '../components/ui';
import { MIN_PASSWORD, passwordProblem } from './SignIn';

/** Signed-in account settings: change password, and how recovery works. */
export function Account({ email }: { email: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(
        /reauth|recent/i.test(err.message)
          ? 'For safety, sign out and back in, then change your password within a few minutes.'
          : err.message,
      );
      return;
    }
    setPassword('');
    setConfirm('');
    setSaved(true);
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-[800] tracking-tight">Your account</h1>
      <section className="a-panel p-5" aria-labelledby="pw-h">
        <h2 id="pw-h" className="text-base font-bold">
          Change password
        </h2>
        <p className="mt-1 text-muted">
          Signed in as <strong>{email}</strong>. Use at least {MIN_PASSWORD} characters with letters and numbers. You’ll
          get an email confirming the change.
        </p>
        <form className="mt-4 space-y-3" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="acct-pw" className="a-label">
              New password
            </label>
            <input id="acct-pw" type="password" className="a-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          </div>
          <div>
            <label htmlFor="acct-pw2" className="a-label">
              Repeat password
            </label>
            <input id="acct-pw2" type="password" className="a-input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          </div>
          <button className="a-btn a-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
          {saved && (
            <p role="status" className="font-semibold text-accent-text">
              Password changed.
            </p>
          )}
          <ErrorNote error={error} />
        </form>
      </section>

      <section className="a-panel p-5" aria-labelledby="rec-h">
        <h2 id="rec-h" className="text-base font-bold">
          If you lose access
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            <strong>Forgot your password:</strong> use “Forgot password?” on the sign-in page. A one-time link goes to
            this email address.
          </li>
          <li>
            <strong>Lost this email account (or your Google account):</strong> ask another admin to add your new email on
            the Admins page and remove the old one. Then use “First time? Create your password” with the new email.
          </li>
          <li>
            <strong>Every admin is locked out:</strong> the Supabase project owner can add an email from the Supabase
            dashboard (see SETUP_CHECKLIST.md → “Break-glass recovery”).
          </li>
        </ul>
        <p className="mt-3 text-muted">Keep at least two admins so nobody is ever the only way back in.</p>
      </section>
    </div>
  );
}
