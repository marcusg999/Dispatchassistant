import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CATEGORY_LABEL, STATUS_LABEL, TAG_LABEL, type Category, type Status, type Tag } from '../../shared/domain';

export const TagChip = ({ tag }: { tag: Tag }) => <span className={`tag-chip tag-${tag}`}>{TAG_LABEL[tag]}</span>;
export const StatusPill = ({ status }: { status: Status }) => <span className="status-pill">{STATUS_LABEL[status]}</span>;
export const CategoryText = ({ c }: { c: Category }) => <span>{CATEGORY_LABEL[c]}</span>;

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Accessible confirm dialog (native <dialog>: focus trap + Esc for free). */
export function Confirm({
  open,
  title,
  children,
  confirmLabel,
  danger,
  disabled,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="a-dialog" onClose={onCancel} aria-labelledby="confirm-title">
      <h2 id="confirm-title" className="text-lg font-bold">
        {title}
      </h2>
      <div className="mt-2 text-[0.9375rem] leading-relaxed">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="a-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`a-btn ${danger ? 'a-btn-danger' : 'a-btn-primary'}`}
          onClick={onConfirm}
          disabled={disabled}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 border-l-4 border-danger pl-3 font-semibold text-danger">
      {error}
    </p>
  );
}
