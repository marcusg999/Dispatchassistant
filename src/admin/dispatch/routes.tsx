/**
 * Dispatch module routes (under /admin/dispatch). Office roles only
 * (admin, dispatcher, viewer); viewers get read-only screens.
 */
import type { StaffRole } from '../../shared/dispatch';
import { Link } from '../router';
import { Board } from './pages/Board';
import { Week } from './pages/Week';
import { JobEditor } from './pages/JobEditor';
import { CrewList } from './pages/CrewList';
import { CrewDetail } from './pages/CrewDetail';
import { Assets } from './pages/Assets';
import { TimeOffPage } from './pages/TimeOffPage';
import { Roles } from './pages/Roles';
import { PrintSheet } from './pages/PrintSheet';
import { Incidents } from './pages/Incidents';

export const isDispatchPath = (p: string) => p === '/admin/dispatch' || p.startsWith('/admin/dispatch/');
const UUID = '([0-9a-f-]{36})';

export function DispatchRoutes({ path, role }: { path: string; role: StaffRole }) {
  const canEdit = role === 'admin' || role === 'dispatcher';
  let m: RegExpMatchArray | null;
  if (path === '/admin/dispatch' || path === '/admin/dispatch/') return <Board canEdit={canEdit} />;
  if (path === '/admin/dispatch/week') return <Week />;
  if (path === '/admin/dispatch/jobs/new') return canEdit ? <JobEditor id={null} canEdit isAdmin={role === 'admin'} /> : <ReadOnly />;
  if ((m = path.match(new RegExp(`^/admin/dispatch/jobs/${UUID}$`)))) return <JobEditor id={m[1]} canEdit={canEdit} isAdmin={role === 'admin'} />;
  if (path === '/admin/dispatch/crew') return <CrewList canEdit={canEdit} />;
  if (path === '/admin/dispatch/crew/new') return canEdit ? <CrewDetail id={null} canEdit /> : <ReadOnly />;
  if ((m = path.match(new RegExp(`^/admin/dispatch/crew/${UUID}$`)))) return <CrewDetail id={m[1]} canEdit={canEdit} />;
  if (path === '/admin/dispatch/assets') return <Assets canEdit={canEdit} />;
  if (path === '/admin/dispatch/time-off') return <TimeOffPage canEdit={canEdit} />;
  if (path === '/admin/dispatch/incidents') return <Incidents canEdit={canEdit} />;
  if (path === '/admin/dispatch/roles') return role === 'admin' ? <Roles /> : <ReadOnly />;
  if (path === '/admin/dispatch/print') return <PrintSheet jobId={null} />;
  if ((m = path.match(new RegExp(`^/admin/dispatch/print/${UUID}$`)))) return <PrintSheet jobId={m[1]} />;
  return <p className="text-muted">Page not found.</p>;
}

function ReadOnly() {
  return (
    <div className="a-panel max-w-xl p-6">
      <h1 className="text-xl font-[800] tracking-tight">Not available for your account</h1>
      <p className="mt-2 text-muted">Your role can view the dispatch board but not change it.</p>
    </div>
  );
}

export function DispatchSubnav({ path, role }: { path: string; role: StaffRole }) {
  const items = [
    { href: '/admin/dispatch', label: 'Day board', active: path === '/admin/dispatch' || path.startsWith('/admin/dispatch/jobs') },
    { href: '/admin/dispatch/week', label: 'Week' },
    { href: '/admin/dispatch/crew', label: 'Crew' },
    { href: '/admin/dispatch/assets', label: 'Assets' },
    { href: '/admin/dispatch/time-off', label: 'Time off' },
    { href: '/admin/dispatch/incidents', label: 'Incidents' },
    ...(role === 'admin' ? [{ href: '/admin/dispatch/roles', label: 'Staff roles' }] : []),
  ];
  return (
    <nav aria-label="Dispatch" className="no-print border-b border-line bg-wall">
      <div className="nav-row mx-auto flex max-w-[120rem] flex-wrap gap-x-1 px-4 lg:px-8">
        {items.map((i) => {
          const active = i.active ?? (path === i.href || path.startsWith(`${i.href}/`));
          return (
            <Link key={i.href} href={i.href} className="nav-link !min-h-[44px] text-[0.8125rem]" aria-current={active ? 'page' : undefined}>
              {i.label}
            </Link>
          );
        })}
        {role === 'viewer' && <span className="ml-auto self-center text-[0.75rem] text-muted">Read-only access</span>}
      </div>
    </nav>
  );
}
