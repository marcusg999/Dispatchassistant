/**
 * Estimates module routes (under /admin/estimates). Admin and estimator only:
 * money is never shown to dispatchers, viewers or crew.
 */
import type { StaffRole } from '../../shared/dispatch';
import { Link } from '../router';
import { EstimateList } from './pages/EstimateList';
import { EstimateBuilder } from './pages/EstimateBuilder';
import { BuildSheet } from './pages/BuildSheet';
import { Approvals } from './pages/Approvals';
import { Clients } from './pages/Clients';
import { ClientDetail } from './pages/ClientDetail';
import { RateCards } from './pages/RateCards';
import { RateCardEditor } from './pages/RateCardEditor';
import { Rules } from './pages/Rules';
import { Terms } from './pages/Terms';
import { SampleRatesBanner } from './SampleRatesBanner';

export const isEstimatesPath = (p: string) => p === '/admin/estimates' || p.startsWith('/admin/estimates/');
const UUID = '([0-9a-f-]{36})';

export function EstimatesRoutes({ path, role }: { path: string; role: StaffRole }) {
  const isAdmin = role === 'admin';
  let m: RegExpMatchArray | null;
  let page: React.ReactNode;
  if (path === '/admin/estimates' || path === '/admin/estimates/') page = <EstimateList isAdmin={isAdmin} />;
  else if (path === '/admin/estimates/new') page = <EstimateBuilder id={null} isAdmin={isAdmin} />;
  else if (path === '/admin/estimates/approvals') page = <Approvals />;
  else if (path === '/admin/estimates/clients') page = <Clients />;
  else if ((m = path.match(new RegExp(`^/admin/estimates/clients/(new|${UUID})$`)))) page = <ClientDetail id={m[1] === 'new' ? null : m[1]} />;
  else if (path === '/admin/estimates/rates') page = <RateCards isAdmin={isAdmin} />;
  else if ((m = path.match(new RegExp(`^/admin/estimates/rates/${UUID}$`)))) page = <RateCardEditor id={m[1]} isAdmin={isAdmin} />;
  else if (path === '/admin/estimates/rules') page = <Rules />;
  else if (path === '/admin/estimates/terms') page = <Terms />;
  else if ((m = path.match(new RegExp(`^/admin/estimates/${UUID}/build-sheet$`)))) page = <BuildSheet id={m[1]} />;
  else if ((m = path.match(new RegExp(`^/admin/estimates/${UUID}$`)))) page = <EstimateBuilder id={m[1]} isAdmin={isAdmin} />;
  else page = <p className="text-muted">Page not found.</p>;
  return (
    <>
      <SampleRatesBanner />
      {page}
    </>
  );
}

export function EstimatesSubnav({ path, role }: { path: string; role: StaffRole }) {
  const items = [
    { href: '/admin/estimates', label: 'Estimates', active: path === '/admin/estimates' || /^\/admin\/estimates\/(new|[0-9a-f-]{36})/.test(path) },
    { href: '/admin/estimates/clients', label: 'Clients' },
    ...(role === 'admin' ? [{ href: '/admin/estimates/approvals', label: 'Approvals' }] : []),
    { href: '/admin/estimates/rates', label: 'Rate cards' },
    ...(role === 'admin' ? [{ href: '/admin/estimates/rules', label: 'Packing & crew rules' }, { href: '/admin/estimates/terms', label: 'Terms' }] : []),
  ];
  return (
    <nav aria-label="Estimates" className="no-print border-b border-line bg-wall">
      <div className="mx-auto flex max-w-[110rem] flex-wrap gap-x-1 px-4 lg:px-8">
        {items.map((i) => {
          const active = i.active ?? (path === i.href || path.startsWith(`${i.href}/`));
          return (
            <Link key={i.href} href={i.href} className="nav-link !min-h-[44px] text-[0.8125rem]" aria-current={active ? 'page' : undefined}>
              {i.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
