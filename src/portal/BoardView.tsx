import { useEffect, useState } from 'react';
import { brand } from '../brand/brand.config';
import { CATEGORY_LABEL, STATUS_LABEL } from '../shared/domain';
import { fetchBoard, type BoardItem } from './api';

export function BoardView() {
  const [items, setItems] = useState<BoardItem[] | 'error' | null>(null);

  useEffect(() => {
    let live = true;
    fetchBoard().then((r) => live && setItems(r));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="fade-in" aria-labelledby="main-heading">
      <h2 id="main-heading" tabIndex={-1} className="text-[2rem] font-[800] leading-[1.05] tracking-tight lg:text-[2.5rem]">
        You said, we did.
      </h2>
      <p className="mt-3 max-w-[34rem] text-[1.0625rem] leading-relaxed">
        What {brand.officeNoun} has done about suggestions from this box. Summaries are written by {brand.officeNoun};
        original messages and photos are never posted.
      </p>

      <div className="mt-10" aria-busy={items === null}>
        {items === null && <p className="text-muted">Loading…</p>}
        {items === 'error' && <p className="error">Couldn&rsquo;t load the board. Check your signal and try again.</p>}
        {Array.isArray(items) && items.length === 0 && (
          <p className="border-t-2 border-ink pt-4 text-muted">
            Nothing posted yet. When {brand.officeNoun} acts on a suggestion, it shows up here.
          </p>
        )}
        {Array.isArray(items) && items.length > 0 && (
          <ul>
            {items.map((it, i) => (
              <li key={i} className="board-item">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="stencil text-[0.6875rem]">{CATEGORY_LABEL[it.category]}</span>
                  <span className={`status-chip ${it.status}`}>{STATUS_LABEL[it.status]}</span>
                  <span className="ml-auto text-[0.8125rem] text-muted">
                    {new Date(it.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-line text-[1.0625rem] leading-relaxed">{it.board_summary}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
