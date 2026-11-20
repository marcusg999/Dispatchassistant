import '../estimates.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from '../../router';
import { ErrorNote } from '../../components/ui';
import { approvalQueue, callAction, type ApprovalRow } from '../data';
import { MarginBadge, Money, NoteDialog, StatusPill } from '../builder/shared';

export function Approvals() {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<{ row: ApprovalRow; kind: 'approve' | 'reject' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await approvalQueue());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (note: string) => {
    if (!target) return;
    setBusy(true);
    setDialogError(null);
    try {
      // Send the stored total: the server refuses the approval if its own price differs.
      await callAction(target.row.id, target.kind, {
        note,
        expected_version: target.row.version,
        ...(target.kind === 'approve' ? { client_total_cents: target.row.total_cents } : {}),
      });
      setTarget(null);
      await load();
    } catch (e) {
      setDialogError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="est-builder">
      <h1 className="est-h1">Approvals</h1>
      <p className="est-hint">Estimates waiting for approval, and open estimates whose margin is under their rate card’s target.</p>
      <ErrorNote error={error} />
      {rows === null ? (
        <p className="mt-4 text-muted" role="status">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="a-panel mt-4 p-4">Nothing needs approval right now.</p>
      ) : (
        <ul className="est-queue mt-4 space-y-3">
          {rows.map((e) => (
            <li key={e.id}>
              <div className="est-queue-grid">
                <div>
                  <p className="font-bold">
                    <Link href={`/admin/estimates/${e.id}`} className="est-mono underline">
                      {e.estimate_number}
                    </Link>{' '}
                    · rev {e.revision} · {e.title}
                  </p>
                  <p className="est-hint">
                    {e.client?.name ?? 'No client'} · estimator {e.estimator_email ?? 'unknown'} · <StatusPill status={e.status} />
                  </p>
                </div>
                <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
                  <div>
                    <dt className="a-label">Total</dt>
                    <dd>
                      <Money cents={e.total_cents} />
                    </dd>
                  </div>
                  <div>
                    <dt className="a-label">Margin</dt>
                    <dd>
                      <MarginBadge margin_bp={e.margin_bp} target_bp={e.target_bp} total_cents={e.total_cents} />
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="mt-2">
                <h3 className="a-label">Why</h3>
                {e.approval_reasons.length ? (
                  <ul className="est-reasons">
                    {e.approval_reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="est-hint">Margin is below the target. The estimator hasn’t submitted it for approval.</p>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {e.status === 'pending_approval' ? (
                  <>
                    <button type="button" className="a-btn a-btn-primary" onClick={() => setTarget({ row: e, kind: 'approve' })}>
                      Approve<span className="sr-only"> {e.estimate_number}</span>
                    </button>
                    <button type="button" className="a-btn a-btn-danger" onClick={() => setTarget({ row: e, kind: 'reject' })}>
                      Reject<span className="sr-only"> {e.estimate_number}</span>
                    </button>
                  </>
                ) : null}
                <Link href={`/admin/estimates/${e.id}`} className="a-btn">
                  Open estimate<span className="sr-only"> {e.estimate_number}</span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <NoteDialog
        open={!!target}
        title={target?.kind === 'approve' ? `Approve ${target.row.estimate_number}` : `Reject ${target?.row.estimate_number ?? ''}`}
        description={target?.kind === 'reject' ? 'It goes back to draft with your note.' : undefined}
        label={target?.kind === 'approve' ? 'Note for the estimator' : 'What should change'}
        minLength={target?.kind === 'reject' ? 3 : 0}
        danger={target?.kind === 'reject'}
        confirmLabel={target?.kind === 'approve' ? 'Approve' : 'Reject'}
        busy={busy}
        error={dialogError}
        onSubmit={submit}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
