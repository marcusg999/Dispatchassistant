import { useEffect, useRef, useState } from 'react';
import type { Conflict } from '../data';
import { ConflictBadges } from '../ui';

/**
 * "Warn, don't block": shown when a change creates new conflicts. Keeping the change
 * requires a short reason, which is recorded in the audit log.
 */
export function OverrideDialog({
  open,
  jobLabel,
  conflicts,
  undoLabel = 'Undo change',
  onKeep,
  onUndo,
}: {
  open: boolean;
  jobLabel: string;
  conflicts: Conflict[];
  undoLabel?: string;
  onKeep: (reason: string) => Promise<void>;
  onUndo: () => Promise<void> | void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setReason('');
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const ok = reason.trim().length >= 3 && reason.trim().length <= 500;

  return (
    <dialog
      ref={ref}
      className="a-dialog !max-w-lg"
      aria-labelledby="override-title"
      onCancel={(e) => {
        e.preventDefault(); // a decision is required
      }}
    >
      <h2 id="override-title" className="text-lg font-bold">
        This creates {conflicts.length === 1 ? 'a warning' : `${conflicts.length} warnings`}
      </h2>
      <p className="mt-1 text-[0.875rem] text-muted">{jobLabel}</p>
      <div className="mt-3">
        <ConflictBadges conflicts={conflicts} detail />
      </div>
      <form
        className="mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return setError('Give a short reason (3–500 characters).');
          setBusy(true);
          try {
            await onKeep(reason.trim());
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="override-reason" className="a-label">
          Reason for overriding (required, saved in the audit log)
        </label>
        <input
          id="override-reason"
          className="a-input"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.currentTarget.value)}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p role="alert" className="mt-2 font-semibold text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="a-btn" disabled={busy} onClick={() => void onUndo()}>
            {undoLabel}
          </button>
          <button type="submit" className="a-btn a-btn-primary" disabled={busy || !ok}>
            Keep it, record reason
          </button>
        </div>
      </form>
    </dialog>
  );
}
