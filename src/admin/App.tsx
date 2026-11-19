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
import { SignIn } from './pages/SignIn';
import { AuthConfirm } from './pages/AuthConfirm';
import { Account } from './pages/Account';

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
    // Defer: calling Supabase inside the auth callback can deadlock supabase-js's auth lock.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => void resolve(s), 0);
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
  // Emailed links (confirm account, reset password) are handled before the role gate.
  if (path === '/auth/confirm') return <AuthConfirm onDone={() => undefined} />;
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
  else if (path === '/admin/account') page = <Account email={session?.user.email ?? ''} />;
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
            <Link href="/admin/account" className="hidden underline sm:inline" aria-current={path === '/admin/account' ? 'page' : undefined}>
              {session?.user.email}
            </Link>
            <Link href="/admin/account" className="underline sm:hidden">
              Account
            </Link>
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
