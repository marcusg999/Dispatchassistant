import { useEffect, useState } from 'react';
import { brand, displayName } from '../brand/brand.config';
import { SubmitForm } from './SubmitForm';
import { Success } from './Success';
import { StatusView } from './StatusView';
import { BoardView } from './BoardView';

type View = 'submit' | 'status' | 'board';

function viewFromHash(): View {
  const h = location.hash.replace('#', '');
  return h === 'status' || h === 'board' ? h : 'submit';
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [code, setCode] = useState<string | null>(null);
  const [statusPrefill, setStatusPrefill] = useState('');

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.getElementById('main-heading')?.focus({ preventScroll: true });
  }, [view, code]);

  const tabs: { id: View; label: string; short: string; href: string }[] = [
    { id: 'submit', label: 'Make a suggestion', short: 'Suggest', href: '#' },
    { id: 'status', label: 'Check status', short: 'Status', href: '#status' },
    { id: 'board', label: 'You said, we did', short: 'You said, we did', href: '#board' },
  ];

  return (
    <div className="portal">
      <WallPane />
      <main className="form-pane" aria-labelledby="main-heading">
        <nav className="tabs" aria-label="Suggestion box sections">
          {tabs.map((t) => (
            <a
              key={t.id}
              href={t.href}
              className="tab"
              aria-current={view === t.id ? 'page' : undefined}
              onClick={(e) => {
                if (t.id === 'submit') {
                  e.preventDefault();
                  history.pushState(null, '', location.pathname);
                  setView('submit');
                  setCode(null);
                }
              }}
            >
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </a>
          ))}
        </nav>

        <div className={`mx-auto w-full max-w-[44rem] lg:mx-0 ${view === 'submit' && !code ? '' : 'lg:max-w-[48.5rem] lg:pl-[4.5rem]'}`}>
          {view === 'submit' &&
            (code ? (
              <Success
                code={code}
                onAnother={() => setCode(null)}
                onCheck={() => {
                  setStatusPrefill(code);
                  location.hash = 'status';
                }}
              />
            ) : (
              <SubmitForm onSubmitted={setCode} />
            ))}
          {view === 'status' && <StatusView prefill={statusPrefill} />}
          {view === 'board' && <BoardView />}
        </div>

        <footer className="mt-16 border-t border-line pt-5 text-[0.8125rem] leading-relaxed text-muted lg:ml-[4.5rem]">
          <p>{brand.supportLine}</p>
          <p className="mt-1">No accounts, cookies or tracking on this page.</p>
        </footer>
      </main>
    </div>
  );
}

function WallPane() {
  const [first, ...rest] = brand.portal.headline.split(' ');
  return (
    <header className="wall-pane">
      <div className="flex items-center justify-between gap-4">
        {brand.logoPath ? (
          <img src={brand.logoPath} alt={displayName()} className="h-8 w-auto" />
        ) : (
          <span className="stencil text-[0.75rem]">{displayName()}</span>
        )}
        <span className="stencil text-[0.6875rem] text-muted" aria-hidden="true">
          No.&nbsp;01
        </span>
      </div>

      <div>
        <p className="stencil mb-3 text-[0.75rem] text-accent-text lg:mb-4">{brand.portal.eyebrow}</p>
        <h1 className="headline" aria-label={brand.portal.headline}>
          <span className="w">{first}</span> {rest.length > 0 && <span className="w">{rest.join(' ')}</span>}
        </h1>
        <p className="mt-4 max-w-[30rem] text-[1rem] leading-relaxed lg:mt-5 lg:text-[1.1875rem]">{brand.portal.welcome}</p>
      </div>

      <section className="label-plate" aria-label="How this box works">
        <p className="text-[0.9375rem] font-bold leading-snug">{brand.portal.promise}</p>
        <dl>
          <dt className="plate-extra">Medium</dt>
          <dd className="plate-extra">Your words. A photo, if you like.</dd>
          <dt className="plate-extra">Length</dt>
          <dd className="plate-extra">10 to 4,000 characters</dd>
          <dt>Provenance</dt>
          <dd>
            <strong>Anonymous</strong>
          </dd>
        </dl>
      </section>
    </header>
  );
}
