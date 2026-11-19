import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { brand, displayName } from '../brand/brand.config';
import { configured, supabase } from './supabase';
import { amIAdmin } from './data';
import { amIHr } from './hrData';
import { Link, navigate, usePath } from './router';
import { Inbox } from './pages/Inbox';
import { Detail } from './pages/Detail';
import { Admins } from './pages/Admins';
import { Audit } from './pages/Audit';
import { Tools } from './pages/Tools';
import { HrInbox } from './pages/HrInbox';
import { HrDetail } from './pages/HrDetail';
import { HrStaff } from './pages/HrStaff';

type Gate = 'loading' | 'signed-out' | 'not-admin' | 'allowed';

export function App() {
  const path = usePath();
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<Gate>('loading');
  const [roles, setRoles] = useState({ admin: false, hr: false });

  useEffect(() => {
    let alive = true;
    const resolve = async (s: Session | null) => {
      if (!alive) return;
      setSession(s);
      if (!s) return setGate('signed-out');
      // UX checks only: the database enforces access with RLS regardless of what these say.
      const [admin, hr] = await Promise.all([amIAdmin(), amIHr()]);
      if (!alive) return;
      setRoles({ admin, hr });
      setGate(admin || hr ? 'allowed' : 'not-admin');
    };
    supabase.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      void resolve(s);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (path === '/auth/callback' && gate !== 'loading') navigate('/admin');
  }, [path, gate]);

  if (!configured)
    return <Centered title="Not configured">Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</Centered>;
  if (gate === 'loading') return <Centered title="Loading…" />;
  if (gate === 'signed-out') return <SignIn />;
  if (gate === 'not-admin')
    return (
      <Centered title="This account isn’t allowed">
        <p>{session?.user.email} is not on the admin or HR list. Ask an existing admin (or HR member) to add you.</p>
        <button className="a-btn mt-4" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Centered>
    );

  const notAvailable = (
    <div className="a-panel max-w-xl p-6">
      <h1 className="text-xl font-[800] tracking-tight">Not available for your account</h1>
      <p className="mt-2 text-muted">This page is for a different role.</p>
    </div>
  );
  const adminOnly = (el: React.ReactNode) => (roles.admin ? el : notAvailable);
  const hrOnly = (el: React.ReactNode) => (roles.hr ? el : notAvailable);

  let page;
  const detail = path.match(/^\/admin\/s\/([0-9a-f-]{36})$/);
  const hrDetail = path.match(/^\/admin\/hr\/r\/([0-9a-f-]{36})$/);
  const isHrPath = path === '/admin/hr' || path.startsWith('/admin/hr/');
  if (detail) page = adminOnly(<Detail id={detail[1]} />);
  else if (hrDetail) page = hrOnly(<HrDetail id={hrDetail[1]} />);
  else if (path === '/admin/hr/team') page = hrOnly(<HrStaff />);
  else if (isHrPath) page = hrOnly(<HrInbox />);
  else if (path === '/admin/admins') page = adminOnly(<Admins />);
  else if (path === '/admin/audit') page = <Audit />;
  else if (path === '/admin/tools') page = adminOnly(<Tools />);
  else page = roles.admin ? <Inbox /> : <HrInbox />;

  const nav = [
    ...(roles.admin ? [{ href: '/admin', label: 'Inbox', active: path === '/admin' || !!detail }] : []),
    ...(roles.hr
      ? [
          {
            href: '/admin/hr',
            label: 'HR inbox',
            active: (isHrPath && path !== '/admin/hr/team') || (!roles.admin && path === '/admin'),
          },
          { href: '/admin/hr/team', label: 'HR team', active: path === '/admin/hr/team' },
        ]
      : []),
    { href: '/admin/audit', label: 'Audit log', active: path === '/admin/audit' },
    ...(roles.admin
      ? [
          { href: '/admin/admins', label: 'Admins', active: path === '/admin/admins' },
          { href: '/admin/tools', label: 'Backup & flyer', active: path === '/admin/tools' },
        ]
      : []),
  ];

  return (
    <div className="min-h-dvh">
      <header className="no-print border-b border-ink bg-paper">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-6 px-4 lg:px-8">
          <Link href="/admin" className="stencil flex min-h-[52px] items-center text-[0.75rem] text-ink no-underline">
            {brand.logoPath ? <img src={brand.logoPath} alt="" className="mr-2 h-6" /> : null}
            {displayName()}
          </Link>
          <nav aria-label="Admin" className="-mb-px flex flex-wrap">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="nav-link" aria-current={n.active ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 py-2 text-[0.8125rem] text-muted">
            <span className="hidden sm:inline">{session?.user.email}</span>
            <button className="a-btn a-btn-sm" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[90rem] px-4 py-6 lg:px-8">{page}</main>
    </div>
  );
}

function Centered({ title, children }: { title: string; children?: React.ReactNode }) {
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

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error_description');
  return (
    <Centered title="Sign in">
      <p className="text-muted">Admins only. Use the Google account your office added to the admin list.</p>
      <button
        className="a-btn a-btn-primary mt-6 w-full"
        onClick={async () => {
          const { error: e } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } },
          });
          if (e) setError(e.message);
        }}
      >
        Continue with Google
      </button>
      {(error || oauthError) && (
        <p role="alert" className="mt-3 text-danger">
          {oauthError ? 'That account isn’t allowed to sign in.' : error}
        </p>
      )}
    </Centered>
  );
}
