import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { displayName } from '../../brand/brand.config';
import { supabase } from '../supabase';

/**
 * Console sign-in: email + password (primary) or Google.
 *
 * - "Create your password": for someone already on the admin or HR list. Supabase emails a
 *   confirmation link; the before-user-created hook refuses anyone not on a list.
 * - "Forgot password?": emails a one-time reset link (token_hash, so it works in any browser).
 *
 * Messages are deliberately generic so this page can't be used to test which emails are admins.
 */
type Mode = 'signin' | 'forgot' | 'create';
export const MIN_PASSWORD = 12;

export function passwordProblem(pw: string, confirm?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use both letters and numbers.';
  if (confirm !== undefined && pw !== confirm) return 'The two passwords don’t match.';
  return null;
}

export function AuthCard({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="a-panel w-full max-w-md p-8">
        <p className="stencil text-[0.6875rem] text-muted">{displayName()}</p>
        <h1 className="mt-3 text-2xl font-[800] tracking-tight">{title}</h1>
        {children && <div className="mt-3 text-[0.9375rem] leading-relaxed">{children}</div>}
      </div>
    </main>
  );
}

export function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const oauthError = new URLSearchParams(location.search).get('error_description');
  const confirmUrl = `${location.origin}/auth/confirm`;

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    setPassword('');
    setConfirm('');
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const addr = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (err) {
          setError(
            /confirm/i.test(err.message)
              ? 'Confirm your email first: check your inbox for the confirmation link.'
              : 'That email and password don’t match. Try again, or use “Forgot password?”.',
          );
        }
      } else if (mode === 'forgot') {
        await supabase.auth.resetPasswordForEmail(addr, { redirectTo: confirmUrl });
        setNotice('If that email belongs to an account, a reset link is on its way. It works once and expires in an hour.');
      } else {
        const problem = passwordProblem(password, confirm);
        if (problem) return setError(problem);
        await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: confirmUrl } });
        setNotice(
          'If that email is on the admin or HR list, a confirmation link is on its way. Open it, then sign in with your new password.',
        );
      }
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Reset your password' : 'Create your password';

  return (
    <AuthCard title={title}>
      <p className="text-muted">
        {mode === 'signin' && 'For people on the admin or HR list only.'}
        {mode === 'forgot' && 'Enter your email and we’ll send a link to choose a new password.'}
        {mode === 'create' &&
          `First time here? If an admin added your email, choose a password (at least ${MIN_PASSWORD} characters, letters and numbers).`}
      </p>

      <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="auth-email" className="a-label">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            className="a-input"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
          />
        </div>
        {mode !== 'forgot' && (
          <div>
            <label htmlFor="auth-password" className="a-label">
              {mode === 'create' ? 'New password' : 'Password'}
            </label>
            <input
              id="auth-password"
              type="password"
              className="a-input"
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              minLength={mode === 'create' ? MIN_PASSWORD : undefined}
              required
            />
          </div>
        )}
        {mode === 'create' && (
          <div>
            <label htmlFor="auth-confirm" className="a-label">
              Repeat password
            </label>
            <input
              id="auth-confirm"
              type="password"
              className="a-input"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
              required
            />
          </div>
        )}
        <button className="a-btn a-btn-primary w-full" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create password'}
        </button>
      </form>

      {(error || oauthError) && (
        <p role="alert" className="mt-3 font-semibold text-danger">
          {error ?? 'That account isn’t allowed to sign in.'}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 border-l-4 border-accent pl-3">
          {notice}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-between gap-2 text-[0.875rem]">
        {mode === 'signin' ? (
          <>
            <button type="button" className="min-h-[44px] underline" onClick={() => go('forgot')}>
              Forgot password?
            </button>
            <button type="button" className="min-h-[44px] underline" onClick={() => go('create')}>
              First time? Create your password
            </button>
          </>
        ) : (
          <button type="button" className="min-h-[44px] underline" onClick={() => go('signin')}>
            ← Back to sign in
          </button>
        )}
      </div>

      {mode === 'signin' && (
        <>
          <div className="my-5 flex items-center gap-3 text-[0.75rem] text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <button
            className="a-btn w-full"
            onClick={async () => {
              const { error: err } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } },
              });
              if (err) setError(err.message);
            }}
          >
            Continue with Google
          </button>
          <p className="mt-5 text-[0.8125rem] text-muted">
            Lost access to your email or Google account? Ask another admin to replace your email on the Admins page.
          </p>
        </>
      )}
    </AuthCard>
  );
}
