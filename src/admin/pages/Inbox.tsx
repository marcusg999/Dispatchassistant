import { useEffect, useMemo, useState } from 'react';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  STATUSES,
  STATUS_LABEL,
  TAGS,
  TAG_LABEL,
  type Category,
  type Status,
  type Tag,
} from '../../shared/domain';
import {
  EMPTY_FILTERS,
  PAGE_SIZE,
  allMatching,
  describeFilters,
  listSuggestions,
  logExport,
  type Filters,
  type SortKey,
  type SuggestionView,
} from '../data';
import { navigate } from '../router';
import { ErrorNote, FiltersToggle, StatusPill, TagChip, fmtDate } from '../components/ui';

const KEY = 'inbox-filters';
function loadFilters(): Filters {
  try {
    return { ...EMPTY_FILTERS, ...(JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<Filters>) };
  } catch {
    return EMPTY_FILTERS;
  }
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function Inbox() {
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [qDraft, setQDraft] = useState(filters.q);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<SuggestionView[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'docx' | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
    let live = true;
    setError(null);
    listSuggestions(filters, page)
      .then((r) => {
        if (!live) return;
        setRows(r.rows);
        setCount(r.count);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [filters, page]);

  // Debounced search: Postgres full-text search on a generated tsvector + GIN index.
  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== filters.q) {
        setPage(0);
        setFilters((f) => ({ ...f, q: qDraft }));
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qDraft, filters.q]);

  const set = (patch: Partial<Filters>) => {
    setPage(0);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const active = useMemo(() => describeFilters(filters), [filters]);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  async function exportAs(format: 'xlsx' | 'docx') {
    setExporting(format);
    setError(null);
    try {
      const [mod, data] = await Promise.all([import('../exporters'), allMatching(filters)]);
      const meta = { exportedAt: new Date(), filters: active };
      const bytes = format === 'xlsx' ? await mod.buildXlsx(data, meta) : await mod.buildDocx(data, meta);
      mod.download(bytes, mod.exportFileName(format), format === 'xlsx' ? mod.XLSX_MIME : mod.DOCX_MIME);
      await logExport(format, active, data.length);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
      <div className="h-fit">
      <FiltersToggle open={showFilters} active={Object.keys(active).length} onToggle={() => setShowFilters((v) => !v)} controls="inbox-filters" />
      <aside id="inbox-filters" aria-label="Filters" className={`a-panel h-fit p-4 ${showFilters ? '' : 'phone-hidden'}`}>
        <label className="a-label" htmlFor="q">
          Search
        </label>
        <input
          id="q"
          type="search"
          className="a-input"
          placeholder="Words in the text…"
          value={qDraft}
          onChange={(e) => setQDraft(e.currentTarget.value)}
        />

        <FilterGroup label="Priority (current)">
          {TAGS.map((t) => (
            <Toggle key={t} on={filters.tags.includes(t)} onClick={() => set({ tags: toggle<Tag>(filters.tags, t) })}>
              {TAG_LABEL[t]}
            </Toggle>
          ))}
        </FilterGroup>
        <FilterGroup label="Status">
          {STATUSES.map((s) => (
            <Toggle
              key={s}
              on={filters.statuses.includes(s)}
              onClick={() => set({ statuses: toggle<Status>(filters.statuses, s) })}
            >
              {STATUS_LABEL[s]}
            </Toggle>
          ))}
        </FilterGroup>
        <FilterGroup label="Category">
          {CATEGORIES.map((c) => (
            <Toggle
              key={c}
              on={filters.categories.includes(c)}
              onClick={() => set({ categories: toggle<Category>(filters.categories, c) })}
            >
              {CATEGORY_LABEL[c]}
            </Toggle>
          ))}
        </FilterGroup>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div>
            <label className="a-label" htmlFor="from">
              From
            </label>
            <input id="from" type="date" className="a-input" value={filters.from} onChange={(e) => set({ from: e.currentTarget.value })} />
          </div>
          <div>
            <label className="a-label" htmlFor="to">
              To
            </label>
            <input id="to" type="date" className="a-input" value={filters.to} onChange={(e) => set({ to: e.currentTarget.value })} />
          </div>
        </div>

        <label className="mt-4 flex min-h-[44px] items-center gap-2">
          <input type="checkbox" checked={filters.hasPhoto} onChange={(e) => set({ hasPhoto: e.currentTarget.checked })} className="size-4" />
          Has a photo
        </label>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" checked={filters.trash} onChange={(e) => set({ trash: e.currentTarget.checked })} className="size-4" />
          Show deleted only
        </label>

        <button
          className="a-btn mt-3 w-full"
          onClick={() => {
            setQDraft('');
            set(EMPTY_FILTERS);
          }}
        >
          Clear filters
        </button>
      </aside>
      </div>

      <section aria-labelledby="inbox-h" className="min-w-0">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 id="inbox-h" className="text-2xl font-[800] tracking-tight">
              {filters.trash ? 'Deleted suggestions' : 'Inbox'}
            </h1>
            <p className="text-muted" aria-live="polite">
              {rows === null ? 'Loading…' : `${count.toLocaleString()} ${count === 1 ? 'suggestion' : 'suggestions'}`}
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="a-label !mb-0">Sort</span>
            <select
              className="a-select !w-auto"
              value={filters.sort}
              onChange={(e) => set({ sort: e.currentTarget.value as SortKey })}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="priority">Priority</option>
            </select>
          </label>
          <button className="a-btn" onClick={() => exportAs('xlsx')} disabled={!!exporting || !count}>
            {exporting === 'xlsx' ? 'Exporting…' : 'Export Excel'}
          </button>
          <button className="a-btn" onClick={() => exportAs('docx')} disabled={!!exporting || !count}>
            {exporting === 'docx' ? 'Exporting…' : 'Export Word'}
          </button>
        </div>
        <ErrorNote error={error} />

        {rows && rows.length === 0 && <p className="a-panel mt-4 p-6 text-muted">No suggestions match these filters.</p>}

        {rows && rows.length > 0 && (
          <>
            {/* Desktop: dense table */}
            <div className="a-panel mt-4 hidden overflow-x-auto md:block">
              <table className="a-table">
                <thead>
                  <tr>
                    <th scope="col">Received</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="w-full">
                      Suggestion
                    </th>
                    <th scope="col">
                      <span className="sr-only">Flags</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/admin/s/${r.id}`)}>
                      <td className="whitespace-nowrap text-muted">{fmtDate(r.created_at)}</td>
                      <td>
                        <TagChip tag={r.admin_tag} />
                      </td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                      <td className="whitespace-nowrap">{CATEGORY_LABEL[r.category]}</td>
                      <td>
                        <a
                          href={`/admin/s/${r.id}`}
                          className="line-clamp-2 text-ink no-underline hover:underline"
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(`/admin/s/${r.id}`);
                          }}
                        >
                          {r.body}
                        </a>
                      </td>
                      <td className="whitespace-nowrap text-[0.75rem] text-muted">
                        {r.photo_path && <span title="Has photo">Photo</span>}
                        {r.published_to_board && <span className="ml-2" title="On the public board">Board</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: cards */}
            <ul className="mt-4 grid gap-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <a
                    href={`/admin/s/${r.id}`}
                    className="a-panel block p-3 text-ink no-underline"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/admin/s/${r.id}`);
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <TagChip tag={r.admin_tag} />
                      <StatusPill status={r.status} />
                      <span className="ml-auto text-[0.75rem] text-muted">{fmtDate(r.created_at)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3">{r.body}</p>
                    <p className="mt-1 text-[0.75rem] text-muted">
                      {CATEGORY_LABEL[r.category]}
                      {r.photo_path ? ' · Photo' : ''}
                    </p>
                  </a>
                </li>
              ))}
            </ul>

            <nav aria-label="Pages" className="mt-4 flex items-center justify-between">
              <button className="a-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ← Previous
              </button>
              <span className="text-muted">
                Page {page + 1} of {pages}
              </span>
              <button className="a-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Next →
              </button>
            </nav>
          </>
        )}
      </section>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-4">
      <legend className="a-label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="a-toggle" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}
