import '../estimates.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstimateLine, LineCategory } from '../../../shared/estimate';
import { JOB_TYPES, JOB_TYPE_LABEL, type JobType } from '../../../shared/dispatch';
import { Link, navigate } from '../../router';
import { Confirm, ErrorNote } from '../../components/ui';
import {
  EstimateError,
  StaleEstimateError,
  callAction,
  createEstimate,
  getEstimate,
  getEstimateRow,
  isEditable,
  listClients,
  listContacts,
  parseSnapshot,
  saveEstimateInputs,
  saveEstimateItems,
  saveEstimateStops,
  type ClientRow,
  type ContactRow,
  type EstimateAction,
  type EstimateFull,
  type EstimateRow,
} from '../data';
import { draftFromEstimate, draftItems, draftStops, draftToPatch, runEngine, validate, type Draft } from '../builder/model';
import { BasicsSection, CrewSection, ExtrasSection, ItemsSection, StopsSection, type SetDraft } from '../builder/Sections';
import { LinesSection, ManualLinesSection } from '../builder/Lines';
import { TotalsPanel, type SaveState, type TotalsView } from '../builder/Totals';
import { Field, NoteDialog, QuoteLinkPanel, StatusPill } from '../builder/shared';
import { EstimateExports } from '../exports';

export function EstimateBuilder({ id, isAdmin }: { id: string | null; isAdmin: boolean }) {
  return id ? <Loader key={id} id={id} isAdmin={isAdmin} /> : <NewEstimate />;
}

// ── New estimate: the minimum, then straight into the builder ────────────────
function NewEstimate() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [service, setService] = useState<JobType>('delivery');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listClients().then((c) => setClients(c.filter((x) => x.active)), () => setError('Couldn’t load clients.'));
  }, []);
  const create = async () => {
    if (title.trim().length < 2) return setError('Add a title (at least 2 characters).');
    setBusy(true);
    setError(null);
    try {
      const id = await createEstimate({ title: title.trim(), client_id: clientId || null, service_type: service, requested_date: date || null });
      await callAction(id, 'recompute').catch(() => undefined);
      navigate(`/admin/estimates/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="est-builder">
      <p>
        <Link href="/admin/estimates" className="underline">
          ← Estimates
        </Link>
      </p>
      <h1 className="est-h1">New estimate</h1>
      <form
        className="a-panel est-section est-narrow"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label="Title">
            <input className="a-input" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Client" hint="You can add the client later.">
            <select className="a-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client yet</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="est-hint">
            <Link href="/admin/estimates/clients/new" className="underline">
              Add a new client
            </Link>{' '}
            first if they aren’t listed.
          </p>
          <Field label="Service type">
            <select className="a-select" value={service} onChange={(e) => setService(e.target.value as JobType)}>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOB_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Requested date">
            <input className="a-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={error} />
        <div className="mt-4 flex gap-2">
          <button type="submit" className="a-btn a-btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create estimate'}
          </button>
          <Link href="/admin/estimates" className="a-btn">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

// ── Loader: fetch everything, remount the editor on reload ───────────────────
function Loader({ id, isAdmin }: { id: string; isAdmin: boolean }) {
  const [data, setData] = useState<{ est: EstimateFull; clients: ClientRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [est, clients] = await Promise.all([getEstimate(id), listClients()]);
      if (!est) return setError('That estimate doesn’t exist or was deleted.');
      setError(null);
      setData({ est, clients });
      setGen((g) => g + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="text-muted" role="status">Loading estimate…</p>;
  return (
    <Editor
      key={gen}
      est={data.est}
      clients={data.clients}
      isAdmin={isAdmin}
      notice={notice}
      onReload={(msg) => {
        setNotice(msg ?? null);
        void load();
      }}
    />
  );
}

const toLine = (l: EstimateFull['lines'][number]): EstimateLine => ({
  key: l.key,
  category: l.category as LineCategory,
  description: l.description,
  qty: Number(l.qty),
  unit: l.unit,
  unit_price_cents: Number(l.unit_price_cents),
  unit_cost_cents: Number(l.unit_cost_cents),
  amount_cents: Number(l.amount_cents),
  cost_cents: Number(l.cost_cents),
  source: l.source as 'calc' | 'manual',
  client_visible: l.client_visible,
  item_id: l.estimate_item_id ?? undefined,
  overridden: l.overridden,
  original: (l.original as EstimateLine['original']) ?? undefined,
  override_reason: l.override_reason ?? undefined,
  trace: l.trace,
});

const AUTOSAVE_MS = 800;
type Dialog = null | 'send' | 'approve' | 'reject' | 'reprice' | 'convert';

function Editor({ est, clients, isAdmin, notice, onReload }: { est: EstimateFull; clients: ClientRow[]; isAdmin: boolean; notice: string | null; onReload: (msg?: string) => void }) {
  const id = est.id;
  const [meta, setMeta] = useState<EstimateRow>(est);
  const [draft, setDraft] = useState<Draft>(() => draftFromEstimate(est));
  const draftRef = useRef(draft);
  const versionRef = useRef(est.version);
  const dirtyRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [stale, setStale] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [link, setLink] = useState<{ path: string; valid_until: string | null } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const snap = useMemo(() => parseSnapshot(meta.rate_snapshot), [meta.rate_snapshot]);
  const clientBp = clients.find((c) => c.id === draft.client_id)?.default_discount_bp ?? 0;
  const clientBpRef = useRef(clientBp);
  clientBpRef.current = clientBp;
  const lastGood = useRef<ReturnType<typeof runEngine>['result']>(null);
  const live = useMemo(() => (snap ? runEngine(draft, clientBp, snap) : { result: null, error: null }), [draft, clientBp, snap]);
  if (live.result) lastGood.current = live.result;
  const result = live.result ?? lastGood.current;
  const errors = useMemo(() => validate(draft), [draft]);
  const locked = !isEditable(meta.status);

  // Contacts of the chosen client.
  useEffect(() => {
    if (!draft.client_id) return setContacts([]);
    let live = true;
    listContacts(draft.client_id).then((c) => live && setContacts(c), () => live && setContacts([]));
    return () => {
      live = false;
    };
  }, [draft.client_id]);

  const doSave = useCallback(async () => {
    if (!dirtyRef.current || !snap) return;
    const d = draftRef.current;
    const errs = validate(d);
    const first = Object.values(errs)[0];
    if (first) {
      setSaveState('invalid');
      setSaveMessage(`Not saved: ${first}`);
      return;
    }
    const run = runEngine(d, clientBpRef.current, snap);
    if (!run.result) {
      setSaveState('invalid');
      setSaveMessage(`Not saved: ${run.error ?? 'check the numbers'}`);
      return;
    }
    dirtyRef.current = false;
    setSaveState('saving');
    try {
      const row = await saveEstimateInputs(id, versionRef.current, draftToPatch(d));
      await saveEstimateStops(id, draftStops(d));
      await saveEstimateItems(id, draftItems(d));
      await callAction(id, 'recompute', { expected_version: row.version, client_total_cents: run.result.totals.total_cents });
      const fresh = await getEstimateRow(id);
      if (fresh) {
        versionRef.current = fresh.version;
        setMeta(fresh);
      }
      if (!dirtyRef.current) setSaveState('saved');
    } catch (e) {
      dirtyRef.current = true;
      if (e instanceof StaleEstimateError || (e instanceof EstimateError && e.code === 'stale')) {
        setStale(true);
        setSaveState('stale');
        setSaveMessage('Not saved: someone else changed this estimate.');
      } else if (e instanceof EstimateError && e.code === 'totals_mismatch') {
        dirtyRef.current = false;
        onReload(e.message);
      } else {
        setSaveState('error');
        setSaveMessage(`Not saved: ${(e as Error).message}`);
      }
    }
  }, [id, snap, onReload]);

  const save = useCallback(() => {
    chain.current = chain.current.then(doSave, doSave);
    return chain.current;
  }, [doSave]);

  const set: SetDraft = useCallback(
    (fn) => {
      const next = fn(draftRef.current);
      draftRef.current = next;
      setDraft(next);
      dirtyRef.current = true;
      setSaveState('dirty');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    },
    [save],
  );

  /** Saves any pending edit now. False if something still blocks saving. */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    await save();
    return !dirtyRef.current;
  }, [save]);

  // Best-effort save when leaving; warn on tab close with unsaved edits.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.clearTimeout(timer.current);
      if (dirtyRef.current) void save();
    };
  }, [save]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const liveTotal = result?.totals.total_cents;
  const act = async (action: EstimateAction, opts: { body?: Record<string, unknown>; price?: boolean; after?: (r: Awaited<ReturnType<typeof callAction>>) => void | Promise<void> } = {}) => {
    setBusy(true);
    setActionError(null);
    try {
      if (!locked && !(await flush())) {
        setActionError(saveMessage || 'Fix the highlighted fields first; the estimate can’t be saved yet.');
        return false;
      }
      const body: Record<string, unknown> = { ...(opts.body ?? {}) };
      if (!locked) body.expected_version = versionRef.current;
      if (opts.price && liveTotal != null) body.client_total_cents = liveTotal;
      const r = await callAction(id, action, body);
      await opts.after?.(r);
      return true;
    } catch (e) {
      if (e instanceof EstimateError && e.code === 'totals_mismatch') onReload(e.message);
      else if (e instanceof EstimateError && e.code === 'stale') setStale(true);
      else setActionError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };
  const refreshMeta = async () => {
    const fresh = await getEstimateRow(id);
    if (fresh) {
      versionRef.current = fresh.version;
      setMeta(fresh);
    }
  };

  const submit = () => act('submit', { price: true, after: () => onReload() });
  const approve = async (note: string) => {
    setDialogError(null);
    if (!(await act('approve', { price: true, body: { note }, after: () => onReload() }))) setDialogError('Couldn’t approve. See the message at the top.');
  };
  const reject = async (note: string) => {
    setDialogError(null);
    if (!(await act('reject', { body: { note }, after: () => onReload() }))) setDialogError('Couldn’t reject. See the message at the top.');
  };
  const sendQuote = () =>
    act('send', {
      price: true,
      after: async (r) => {
        setLink({ path: r.path ?? '', valid_until: r.valid_until ?? null });
        await refreshMeta();
      },
    });
  const revoke = () => act('revoke', { after: async () => { setLink(null); setActionError(null); } });
  const reprice = () => act('reprice', { after: () => onReload('Re-priced with the current rate card. Line overrides were kept; check them.') });
  const revise = () => act('revise', { after: (r) => { if (r.id) navigate(`/admin/estimates/${r.id}`); } });
  const duplicate = (asTemplate = false) => act('duplicate', { body: { as_template: asTemplate }, after: (r) => { if (r.id) navigate(`/admin/estimates/${r.id}`); } });
  const convert = () => act('convert', { after: (r) => { if (r.job_id) navigate(`/admin/dispatch/jobs/${r.job_id}`); } });

  // ── View model ─────────────────────────────────────────────────────────────
  const lines: EstimateLine[] = locked ? est.lines.map(toLine) : (result?.lines ?? []);
  const targetBp = snap?.rates.policy.target_margin_bp ?? null;
  const totals: TotalsView = locked
    ? {
        subtotal_cents: Number(meta.subtotal_cents),
        discount_bp: meta.discount_bp,
        discount_cents: Number(meta.discount_cents),
        tax_cents: Number(meta.tax_cents),
        total_cents: Number(meta.total_cents),
        cost_cents: Number(meta.cost_cents),
        margin_cents: Number(meta.margin_cents),
        margin_bp: meta.margin_bp,
        needs_approval: meta.needs_approval,
        approval_reasons: meta.approval_reasons,
        below_target: targetBp != null && Number(meta.total_cents) > 0 && meta.margin_bp < targetBp,
      }
    : result
      ? { ...result.totals, needs_approval: result.flags.needs_approval, approval_reasons: result.flags.approval_reasons, below_target: result.flags.below_target_margin }
      : { subtotal_cents: 0, discount_bp: 0, discount_cents: 0, tax_cents: 0, total_cents: 0, cost_cents: 0, margin_cents: 0, margin_bp: 0, needs_approval: false, approval_reasons: [], below_target: false };

  const status = meta.status;
  const client = clients.find((c) => c.id === meta.client_id);
  const hasItems = draft.items.length > 0;
  const canSubmit = !locked && status === 'draft' && totals.needs_approval && !meta.is_template;
  const canSend = ['draft', 'approved', 'sent', 'viewed'].includes(status) && !meta.is_template && hasItems && (!totals.needs_approval || status === 'approved');
  const needsApprovalFirst = ['draft'].includes(status) && totals.needs_approval && !meta.is_template;
  const resend = status === 'sent' || status === 'viewed';

  return (
    <div className="est-builder">
      <p className="no-print">
        <Link href="/admin/estimates" className="underline">
          ← Estimates
        </Link>
      </p>
      <header className="est-head">
        <div>
          <h1 className="est-h1">{draft.title || 'Untitled estimate'}</h1>
          <p className="est-sub">
            <span className="est-mono">{meta.estimate_number}</span> · Revision {meta.revision} · <StatusPill status={status} />
            {meta.is_template ? <span className="est-badge">Template</span> : null}
            {client ? <> · {client.name}</> : null}
          </p>
        </div>
      </header>

      {notice ? (
        <p role="status" className="est-banner">
          {notice}
        </p>
      ) : null}
      {stale ? (
        <div role="alert" className="est-banner est-banner-warn">
          <p>
            <strong>Someone else changed this estimate.</strong> Your latest edits weren’t saved. Reload to see the latest version (your unsaved edits will be lost).
          </p>
          <button type="button" className="a-btn a-btn-primary" onClick={() => onReload()}>
            Reload
          </button>
        </div>
      ) : null}
      {locked ? (
        <div role="note" className="est-banner">
          <p>
            <strong>This estimate is {STATUS_TEXT[status] ?? status} and read-only.</strong> Start a new revision to change it.
          </p>
        </div>
      ) : null}
      {!snap ? (
        <div role="alert" className="est-banner est-banner-warn">
          <p>
            <strong>This estimate has no valid rate card.</strong> An admin needs to activate a rate card (Estimates → Rate cards); then choose “Reprice with current rates”.
          </p>
        </div>
      ) : null}
      {link ? <QuoteLinkPanel path={link.path} validUntil={link.valid_until} onClose={() => setLink(null)} /> : null}

      <div className="est-actions-bar no-print" role="group" aria-label="Estimate actions">
        {canSubmit ? (
          <button type="button" className="a-btn a-btn-primary" disabled={busy} onClick={submit}>
            Submit for approval
          </button>
        ) : null}
        {isAdmin && status === 'pending_approval' ? (
          <>
            <button type="button" className="a-btn a-btn-primary" disabled={busy} onClick={() => setDialog('approve')}>
              Approve
            </button>
            <button type="button" className="a-btn a-btn-danger" disabled={busy} onClick={() => setDialog('reject')}>
              Reject
            </button>
          </>
        ) : null}
        {status === 'pending_approval' && !isAdmin ? <span className="est-hint">Waiting for an admin’s approval.</span> : null}
        {canSend ? (
          <button type="button" className="a-btn a-btn-accent" disabled={busy} onClick={() => setDialog('send')}>
            {resend ? 'Send again (new link)' : 'Send quote'}
          </button>
        ) : needsApprovalFirst ? (
          <span className="est-hint">Needs approval before it can be sent.</span>
        ) : null}
        {resend ? (
          <button type="button" className="a-btn" disabled={busy} onClick={revoke}>
            Revoke link
          </button>
        ) : null}
        {status === 'accepted' ? (
          <button type="button" className="a-btn a-btn-primary" disabled={busy} onClick={() => setDialog('convert')}>
            Convert to job
          </button>
        ) : null}
        {meta.converted_job_id ? (
          <Link href={`/admin/dispatch/jobs/${meta.converted_job_id}`} className="a-btn">
            Open job
          </Link>
        ) : null}
        {status === 'draft' && !!snap ? (
          <button type="button" className="a-btn" disabled={busy} onClick={() => setDialog('reprice')}>
            Reprice with current rates
          </button>
        ) : null}
        {!meta.is_template && status !== 'draft' ? (
          <button type="button" className="a-btn" disabled={busy} onClick={revise}>
            New revision
          </button>
        ) : null}
        <button type="button" className="a-btn" disabled={busy} onClick={() => duplicate(false)}>
          {meta.is_template ? 'Create estimate from template' : 'Duplicate'}
        </button>
        {!meta.is_template ? (
          <button type="button" className="a-btn" disabled={busy} onClick={() => duplicate(true)}>
            Save as template
          </button>
        ) : null}
        <Link href={`/admin/estimates/${id}/build-sheet`} className="a-btn">
          Build sheet
        </Link>
      </div>
      <ErrorNote error={actionError} />
      <div id="estimate-exports" className="est-exports">
        <EstimateExports estimateId={id} isAdmin={isAdmin} />
      </div>

      <div className="est-layout">
        <div className="est-main">
          <fieldset disabled={locked} className="est-fieldset">
            <legend className="sr-only">Estimate details{locked ? ' (read-only)' : ''}</legend>
            <BasicsSection d={draft} set={set} errors={errors} clients={clients} contacts={contacts} />
            <StopsSection d={draft} set={set} errors={errors} result={result} />
            <ItemsSection d={draft} set={set} errors={errors} result={result} />
            {snap ? (
              <>
                <CrewSection d={draft} set={set} errors={errors} rates={snap.rates} result={result} />
                <ExtrasSection d={draft} set={set} errors={errors} rates={snap.rates} result={result} clientDefaultBp={clientBp} />
              </>
            ) : null}
            <ManualLinesSection d={draft} set={set} errors={errors} />
          </fieldset>
          <LinesSection lines={lines} d={draft} set={set} readOnly={locked} />
        </div>
        <div className="est-side">
          <TotalsPanel
            t={totals}
            targetBp={targetBp}
            warnings={locked ? [] : (result?.warnings ?? [])}
            status={status}
            approvalNote={meta.approval_note}
            saveState={saveState}
            saveMessage={saveMessage}
            engineError={live.error}
            readOnly={locked}
          />
        </div>
      </div>

      <Confirm
        open={dialog === 'send'}
        title={resend ? 'Send a new quote link?' : 'Send this quote?'}
        confirmLabel={resend ? 'Create new link' : 'Create quote link'}
        disabled={busy}
        onConfirm={sendQuote}
        onCancel={() => setDialog((d) => (d === 'send' ? null : d))}
      >
        <p>This locks the estimate and creates a link for the client. The link is shown once and can’t be shown again.</p>
        {resend ? <p className="mt-2 font-semibold">Sending again creates a new link and retires the old one.</p> : null}
      </Confirm>
      <Confirm
        open={dialog === 'reprice'}
        title="Reprice with the current rate card?"
        confirmLabel="Reprice"
        disabled={busy}
        onConfirm={reprice}
        onCancel={() => setDialog((d) => (d === 'reprice' ? null : d))}
      >
        <p>Every line is recalculated with today’s active rates. Overrides you entered are kept. An approval would need to be requested again.</p>
      </Confirm>
      <Confirm
        open={dialog === 'convert'}
        title="Convert to a job?"
        confirmLabel="Convert to job"
        disabled={busy}
        onConfirm={convert}
        onCancel={() => setDialog((d) => (d === 'convert' ? null : d))}
      >
        <p>This creates a draft dispatch job from the accepted estimate. Dispatchers will see the stops and items, never the prices.</p>
      </Confirm>
      <NoteDialog
        open={dialog === 'approve'}
        title="Approve this estimate"
        label="Note for the estimator"
        confirmLabel="Approve"
        busy={busy}
        error={dialogError}
        onSubmit={approve}
        onCancel={() => setDialog((d) => (d === 'approve' ? null : d))}
      />
      <NoteDialog
        open={dialog === 'reject'}
        title="Reject this estimate"
        description="It goes back to draft with your note."
        label="What should change"
        minLength={3}
        danger
        confirmLabel="Reject"
        busy={busy}
        error={dialogError}
        onSubmit={reject}
        onCancel={() => setDialog((d) => (d === 'reject' ? null : d))}
      />
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  sent: 'sent to the client',
  viewed: 'viewed by the client',
  accepted: 'accepted',
  declined: 'declined',
  expired: 'expired',
  converted: 'converted to a job',
};
