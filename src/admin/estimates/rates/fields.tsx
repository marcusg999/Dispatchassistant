/**
 * Form fields for the rate card editor. Each field is addressed by a dotted path into the
 * card (for example "labor.positions.lead.bill"), reads and writes through context, and shows
 * a text marker when its value differs from the active card.
 */
import { createContext, useContext, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Rates } from '../../../shared/estimate';
import { getAt, same } from './diff';
import { displayStored, storedToText, textToStored, type Kind } from './scaled';

export interface EditorCtx {
  draft: Rates;
  /** The active card, when comparing. */
  base: Rates | null;
  editable: boolean;
  set: (path: string, value: unknown) => void;
  mutate: (fn: (d: Rates) => void) => void;
}

export const EditorContext = createContext<EditorCtx | null>(null);
export const useEditor = (): EditorCtx => {
  const c = useContext(EditorContext);
  if (!c) throw new Error('EditorContext missing');
  return c;
};

/** Changed-vs-active state for one path. */
function useChange(path: string, kind: Kind | 'text') {
  const { draft, base } = useEditor();
  if (!base) return { changed: false, note: null as string | null };
  const now = getAt(draft, path);
  const was = getAt(base, path);
  if (same(now, was)) return { changed: false, note: null };
  return { changed: true, note: was === undefined ? 'New row (not on the active card)' : `Changed. Active card: ${displayStored(was, kind)}` };
}

function Wrap({ changed, note, children }: { changed: boolean; note: string | null; children: ReactNode }) {
  return (
    <div className={changed ? 'border-l-4 border-ink bg-wall pl-2' : undefined}>
      {children}
      {changed && note && <p className="mt-1 text-[0.75rem] font-bold">{'▲ '}{note}</p>}
    </div>
  );
}

const AUTO_PREFIX: Record<Kind, string> = { cents: '$', pct: '', mult: '', num: '' };
const AUTO_SUFFIX: Record<Kind, string> = { cents: '', pct: '%', mult: '×', num: '' };

export function NumberField({
  path,
  label,
  unit,
  kind,
  help,
  compact,
  width = 'w-28',
}: {
  path: string;
  label: string;
  /** Words shown after the box ("per hour", "inches", "lb"). */
  unit?: string;
  kind: Kind;
  help?: string;
  /** Table cell: the label becomes an aria-label and the column header carries the visible name. */
  compact?: boolean;
  width?: string;
}) {
  const { draft, editable, set } = useEditor();
  const id = useId();
  const value = getAt(draft, path) as number;
  const [text, setText] = useState(() => storedToText(value, kind));
  useEffect(() => {
    if (textToStored(text, kind) !== value) setText(storedToText(value, kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parsed = textToStored(text, kind);
  const ch = useChange(path, kind);
  const suffix = [AUTO_SUFFIX[kind], unit].filter(Boolean).join(' ');
  return (
    <Wrap {...ch}>
      {!compact && (
        <label htmlFor={id} className="a-label">
          {label}
        </label>
      )}
      <div className="flex items-center gap-1.5">
        {AUTO_PREFIX[kind] && <span aria-hidden="true" className="text-muted">{AUTO_PREFIX[kind]}</span>}
        <input
          id={id}
          className={`a-input ${width} text-right tabular-nums ${parsed === null ? 'border-danger' : ''}`}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          readOnly={!editable}
          aria-label={compact ? label : undefined}
          aria-invalid={parsed === null || undefined}
          aria-describedby={help ? `${id}-h` : undefined}
          onChange={(e) => {
            const t = e.currentTarget.value;
            setText(t);
            const v = textToStored(t, kind);
            if (v !== null) set(path, v);
          }}
          onBlur={() => setText(storedToText(value, kind))}
        />
        {suffix && <span className="text-[0.8125rem] text-muted">{suffix}</span>}
      </div>
      {help && (
        <p id={`${id}-h`} className="mt-1 text-[0.75rem] text-muted">
          {help}
        </p>
      )}
    </Wrap>
  );
}

export function TextField({
  path,
  label,
  help,
  compact,
  width = 'w-full',
  maxLength,
}: {
  path: string;
  label: string;
  help?: string;
  compact?: boolean;
  width?: string;
  maxLength?: number;
}) {
  const { draft, editable, set } = useEditor();
  const id = useId();
  const ch = useChange(path, 'text');
  return (
    <Wrap {...ch}>
      {!compact && (
        <label htmlFor={id} className="a-label">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`a-input ${width}`}
        value={String(getAt(draft, path) ?? '')}
        readOnly={!editable}
        maxLength={maxLength}
        aria-label={compact ? label : undefined}
        aria-describedby={help ? `${id}-h` : undefined}
        onChange={(e) => set(path, e.currentTarget.value)}
      />
      {help && (
        <p id={`${id}-h`} className="mt-1 text-[0.75rem] text-muted">
          {help}
        </p>
      )}
    </Wrap>
  );
}

export function SelectField({
  path,
  label,
  options,
  compact,
  help,
  width = 'w-full',
}: {
  path: string;
  label: string;
  options: { value: string; label: string }[];
  compact?: boolean;
  help?: string;
  width?: string;
}) {
  const { draft, editable, set } = useEditor();
  const id = useId();
  const ch = useChange(path, 'text');
  return (
    <Wrap {...ch}>
      {!compact && (
        <label htmlFor={id} className="a-label">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`a-select ${width}`}
        value={String(getAt(draft, path) ?? '')}
        disabled={!editable}
        aria-label={compact ? label : undefined}
        aria-describedby={help ? `${id}-h` : undefined}
        onChange={(e) => set(path, e.currentTarget.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && (
        <p id={`${id}-h`} className="mt-1 text-[0.75rem] text-muted">
          {help}
        </p>
      )}
    </Wrap>
  );
}

/** A titled group of fields on a responsive grid. */
export function Group({ title, children, cols = 'sm:grid-cols-2 lg:grid-cols-3' }: { title?: string; children: ReactNode; cols?: string }) {
  return (
    <div className="mt-4">
      {title && <h3 className="text-[0.8125rem] font-bold">{title}</h3>}
      <div className={`mt-2 grid gap-x-6 gap-y-4 ${cols}`}>{children}</div>
    </div>
  );
}

/** Table shell for row editors. Column headers carry the visible names and units. */
export function RowTable({
  caption,
  headers,
  children,
  onAdd,
  addLabel,
  note,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  note?: string | null;
}) {
  const { editable } = useEditor();
  return (
    <div className="mt-4">
      <div className="overflow-x-auto border border-line">
        <table className="a-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
              {editable && onAdd && (
                <th scope="col">
                  <span className="sr-only">Remove row</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="[&_tr]:!cursor-default">{children}</tbody>
        </table>
      </div>
      {note && <p className="mt-1 text-[0.75rem] font-bold">{'▲ '}{note}</p>}
      {editable && onAdd && (
        <button type="button" className="a-btn a-btn-sm mt-2" onClick={onAdd}>
          + {addLabel ?? 'Add row'}
        </button>
      )}
    </div>
  );
}

export function RemoveCell({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { editable } = useEditor();
  if (!editable) return null;
  return (
    <td>
      <button type="button" className="a-btn a-btn-sm a-btn-danger" aria-label={`Remove ${label}`} onClick={onRemove}>
        Remove
      </button>
    </td>
  );
}
