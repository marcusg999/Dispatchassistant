import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../supabase';
import { navigate } from '../router';
import { AuthCard, MIN_PASSWORD, passwordProblem } from './SignIn';

/**
 * Landing page for emailed links: /auth/confirm?token_hash=…&type=signup|recovery
 * Uses verifyOtp(token_hash), so links work in any browser or device (no PKCE verifier needed).
 * After a recovery link, the person chooses a new password before entering the console.
 */
export function AuthConfirm({ onDone }: { onDone: () => void }) {
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const [state, setState] = useState<'verifying' | 'set-password' | 'error'>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!tokenHash || (type !== 'signup' && type !== 'recovery' && type !== 'email')) return setState('error');
      const { error: err } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type === 'recovery' ? 'recovery' : 'email',
      });
      if (!live) return;
      // Remove the one-time token from the address bar and history.
      history.replaceState(null, '', '/auth/confirm');
      if (err) return setState('error');
      if (type === 'recovery') setState('set-password');
      else {
        navigate('/admin');
        onDone();
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    navigate('/admin');
    onDone();
  }

  if (state === 'verifying') return <AuthCard title="Checking your link…" />;
  if (state === 'error')
    return (
      <AuthCard title="This link didn’t work">
        <p>It may have expired or already been used. Links work once and expire after an hour.</p>
        <button className="a-btn a-btn-primary mt-5 w-full" onClick={() => (location.href = '/admin')}>
          Back to sign in
        </button>
      </AuthCard>
    );
  return (
    <AuthCard title="Choose a new password">
      <p className="text-muted">At least {MIN_PASSWORD} characters, with letters and numbers.</p>
      <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="new-password" className="a-label">
            New password
          </label>
          <input id="new-password" type="password" className="a-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </div>
        <div>
          <label htmlFor="new-password-2" className="a-label">
            Repeat password
          </label>
          <input id="new-password-2" type="password" className="a-input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
        </div>
        <button className="a-btn a-btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 font-semibold text-danger">
          {error}
        </p>
      )}
    </AuthCard>
  );
}
