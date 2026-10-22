import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, RefreshCw, Users } from 'lucide-react';
import { useTenantContext } from '@/hooks/useTenantContext';
import type { AgreementClient } from '../useSoloCommercialTerms';
import type { SigningsState, SigningEventsResult } from '../useSoloAgreementSignings';
import { useSalesDraftExit } from '../sales-dialog';
import { AgreementBodyEditor } from './AgreementBodyEditor';
import { AgreementWordingHistory } from './AgreementWordingHistory';
import { createAgreementDraft, readAgreementPreparation, recoverAgreementCreation, type AgreementPreparation } from './agreementPreparationApi';
import { SIGNER_STATE, signingPreparationLabel } from './agreementVocabulary';
import './agreement-preparation.css';

type Props = {
  tenantId: string | null; canManage: boolean; authorityUnknown: boolean; authorizationReady: boolean;
  clients: readonly AgreementClient[]; clientsReady: boolean; clientsReadable: boolean;
  agreementId: string; requestId: string | null; requestTenantId: string | null; freshlyOpened: boolean;
  onDraftAttempted: (requestId: string) => void;
  onOpenRecord: (id: string) => void; onClose: () => void; onOpenClients?: () => void;
  signings: Pick<SigningsState, 'signingEvents' | 'signedCopyUrl'>; onRefresh: () => void;
};
type Phase = 'loading' | 'editing' | 'saving' | 'uncertain' | 'record' | 'error';

/** Mount only inside the existing Sales Terms & Agreements page. */
export function AgreementPreparationWorkspace(props: Props) {
  const scope = useTenantContext();
  const subject = scope.accountContextStatus === 'signed_out' ? null : scope.activeUserId;
  return <ScopedPreparation key={`${scope.activeTenantId}:${subject}:${props.agreementId}`} {...props}
    activeTenantId={scope.activeTenantId} activeUserId={subject} scopeReady={scope.accountContextStatus === 'ready'} />;
}
function WorkspaceMessage({ title, text, onClose, onRetry }: { title: string; text: string; onClose: () => void; onRetry?: () => void }) {
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { heading.current?.focus(); }, [title]);
  return <section className="e04-preparation"><button className="e04-preparation-back" onClick={onClose}><ArrowLeft size={16} />Agreements and terms</button><div className="e04-preparation-message"><FileText size={28} aria-hidden="true" /><h2 tabIndex={-1} ref={heading}>{title}</h2><p>{text}</p>{onRetry && <button onClick={onRetry}><RefreshCw size={16} />Check again</button>}</div></section>;
}
type SessionProps = Props & { activeTenantId: string | null; activeUserId: string | null; scopeReady: boolean };
function ScopedPreparation({ tenantId, agreementId, requestId, requestTenantId, freshlyOpened, clients, clientsReady, clientsReadable, onClose, onOpenRecord, onOpenClients, signings, onRefresh, activeTenantId, activeUserId, scopeReady, canManage, authorityUnknown, authorizationReady, onDraftAttempted }: SessionProps) {
  const originalFresh = React.useRef(freshlyOpened && agreementId === 'new');
  const [phase, setPhase] = React.useState<Phase>(originalFresh.current ? 'editing' : 'loading');
  const [title, setTitle] = React.useState('');
  const [clientId, setClientId] = React.useState('');
  const [body, setBody] = React.useState('');
  const [record, setRecord] = React.useState<AgreementPreparation | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const historyTrigger = React.useRef<HTMLButtonElement>(null);
  const historyReturnPending = React.useRef(false);
  const recordEpoch = React.useRef(-1);
  const [clockTick, refreshClock] = React.useReducer((value: number) => value + 1, 0);
  const [message, setMessage] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const [foundOriginal, setFoundOriginal] = React.useState<string | null>(null);
  const enteredWording = React.useRef(false);
  enteredWording.current = Boolean(title || body || clientId);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const titleField = React.useRef<HTMLInputElement>(null);
  const clientField = React.useRef<HTMLSelectElement>(null);
  const bodyPanel = React.useRef<HTMLDivElement>(null);
  const busy = phase === 'saving';
  const scopeMatches = Boolean(scopeReady && activeUserId && tenantId && activeTenantId === tenantId);
  // A request URL preserves its originating business across reload and business
  // switching. This is an intent fence; canonical native authority still decides.
  const requestScopeMatches = agreementId !== 'new' || requestTenantId === tenantId;
  const allowed = scopeMatches && requestScopeMatches && authorizationReady && canManage && !authorityUnknown;
  const accessEpoch = React.useRef({ allowed, value: 0 });
  if (accessEpoch.current.allowed !== allowed) accessEpoch.current = { allowed, value: accessEpoch.current.value + 1 };
  const visibleClients = clientsReady && clientsReadable ? clients : [];
  const exit = useSalesDraftExit({ title, clientId, body }, busy, onClose, {
    uncertain: agreementId === 'new' && !originalFresh.current && !foundOriginal,
    recordedDraftFound: foundOriginal !== null,
  });
  const navigation = React.useRef({ open: onOpenRecord, finish: exit.exitAfterSave });
  navigation.current = { open: onOpenRecord, finish: exit.exitAfterSave };

  React.useEffect(() => {
    let current = true;
    if (!allowed || !tenantId) return;
    const expectedTenant = tenantId;
    const readEpoch = accessEpoch.current.value;
    if (originalFresh.current && attempt === 0) return;
    setPhase('loading'); setMessage('');
    void (async () => {
      if (agreementId === 'new') {
        if (!requestId) return;
        const result = await recoverAgreementCreation(expectedTenant, requestId);
        if (!current) return;
        if (result.ok === true && result.value.state === 'recovered') {
          const originalId = result.value.signing_id;
          if (enteredWording.current) {
            setFoundOriginal(originalId); setPhase('uncertain');
            setMessage('A retained draft was found. Review it before leaving or replacing the wording currently in this editor.');
          } else navigation.current.finish(() => navigation.current.open(originalId));
        } else {
          setPhase('uncertain');
          setMessage(result.ok === true ? 'The original save is not confirmed yet. Check again, inspect recent agreements, or continue the same draft.' : result.message);
        }
      } else {
        const result = await readAgreementPreparation(expectedTenant, agreementId);
        if (!current) return;
        if (result.ok === true) { recordEpoch.current = readEpoch; setRecord(result.value); setPhase('record'); }
        else { recordEpoch.current = -1; setRecord(null); setPhase('error'); setMessage(result.message); }
      }
    })();
    return () => { current = false; };
  }, [allowed, tenantId, agreementId, requestId, attempt]);
  React.useEffect(() => {
    // Unknown authority hides retained RAM work. A conclusive revocation retires it.
    if (scopeMatches && authorizationReady && !authorityUnknown && !canManage) {
      setBody(''); setTitle(''); setClientId(''); setRecord(null);
    }
  }, [scopeMatches, authorizationReady, authorityUnknown, canManage]);
  React.useEffect(() => {
    if (!allowed && phase === 'saving') setPhase('uncertain');
  }, [allowed, phase]);
  React.useLayoutEffect(() => {
    if (phase === 'error') historyReturnPending.current = false;
    if (phase === 'record' && historyReturnPending.current && historyTrigger.current) {
      historyTrigger.current.focus(); historyReturnPending.current = false; return;
    }
    if (phase !== 'saving') heading.current?.focus();
  }, [phase, allowed]);

  const openConfirmed = (id: string) => exit.exitAfterSave(() => onOpenRecord(id));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowed || !tenantId) return;
    const openedEpoch = accessEpoch.current.value;
    if (!clientId) { setMessage('Choose the client this agreement belongs to.'); clientField.current?.focus(); return; }
    if (!title.trim()) { setMessage('Give the agreement a title.'); titleField.current?.focus(); return; }
    if (!body.trim()) { setMessage('Add the agreement wording before saving.'); bodyPanel.current?.querySelector<HTMLElement>('textarea,[contenteditable="true"]')?.focus(); return; }
    if (!requestId || !clientsReady || !clientsReadable) return;
    onDraftAttempted(requestId);
    originalFresh.current = false;
    setPhase('saving'); setMessage('');
    // The SAME native request atomically creates, recovers an identical intent,
    // or refuses a conflict. No read-then-create check or replacement request.
    const result = await createAgreementDraft({ tenantId, requestId, clientId, title, body });
    if (!exit.alive.current || !accessEpoch.current.allowed || accessEpoch.current.value !== openedEpoch) return;
    if (result.ok === true) openConfirmed(result.value.signing_id);
    else { setPhase(result.reason === 'unconfirmed' || result.reason === 'conflict' ? 'uncertain' : 'editing'); setMessage(result.message); }
  };
  const visibleRecord = recordEpoch.current === accessEpoch.current.value ? record : null;
  const agreement = visibleRecord?.agreement;
  const currentClient = visibleClients.find(client => client.id === (agreement?.contact_id ?? clientId));
  const savedStatus = agreement ? signingPreparationLabel(agreement.status, agreement.expires_at) : null;
  const reading = phase === 'loading' || (phase === 'record' && !visibleRecord);
  const statusLabel = agreement ? savedStatus : reading ? 'Checking original record' : phase === 'error' ? 'Record unavailable' : busy ? 'Confirming save' : foundOriginal ? 'Retained draft found' : !originalFresh.current ? 'Save unconfirmed' : 'Draft preparation';
  React.useEffect(() => {
    // Re-render at the recorded instant using the SAME existing display rule.
    // This UI wake-up schedules no business job, follow-up or external action.
    const expires = agreement?.expires_at ? Date.parse(agreement.expires_at) : NaN;
    const remaining = expires - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(refreshClock, Math.min(remaining + 5, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [agreement?.expires_at, clockTick]);

  if (!scopeMatches || !tenantId) return <><WorkspaceMessage title="Checking the agreement workspace" text="The selected business must be confirmed before agreement wording is shown." onClose={exit.close} />{exit.confirmation}</>;
  if (!requestScopeMatches) return <><WorkspaceMessage title="Return to the original agreement business" text="This draft request was opened in a different business. Select that business to check the original request, or return to its agreement register." onClose={exit.close} />{exit.confirmation}</>;
  if (!authorizationReady || authorityUnknown || !canManage) return <><WorkspaceMessage title={!authorizationReady || authorityUnknown ? 'Agreement access is being checked' : 'Agreement author access required'} text="An owner or authorized agreement administrator can prepare this document." onClose={exit.close} onRetry={onRefresh} />{exit.confirmation}</>;
  if (agreementId === 'new' && !requestId) return <><WorkspaceMessage title="Open a new agreement from Sales" text="Return to agreements to start a draft in the selected business." onClose={exit.close} />{exit.confirmation}</>;
  return <article className="e04-preparation" aria-busy={reading || busy}>
    <header className="e04-preparation-top"><div><button className="e04-preparation-back" onClick={exit.close} disabled={busy}><ArrowLeft size={16} />Agreements and terms</button><h2 ref={heading} tabIndex={-1}>{agreement?.title ?? 'Prepare an agreement'}</h2></div><span className="e04-preparation-status">{statusLabel}</span></header>
    {reading && <div className="e04-preparation-message" role="status"><Loader2 className="e04-preparation-spinner" size={24} aria-hidden="true" /><h3>Reading the original record</h3><p>Confirming the agreement in the selected business.</p></div>}
    {phase === 'error' && <div className="e04-preparation-message" role="alert"><h3>The agreement could not be opened</h3><p>{message}</p><button onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />Try again</button></div>}
    {phase === 'record' && agreement && historyOpen && <AgreementWordingHistory key={agreement.id} tenantId={tenantId} agreementId={agreement.id} currentVersion={agreement.version} currentUpdatedAt={agreement.updated_at} onAccessRefused={() => { setRecord(null); setHistoryOpen(false); setMessage('Agreement access could not be confirmed. Recheck the original business and record.'); setPhase('error'); onRefresh(); }} onClose={() => { historyReturnPending.current = true; setHistoryOpen(false); setPhase('loading'); setAttempt(value => value + 1); }} />}
    {phase === 'uncertain' && <div className="e04-preparation-recovery" role="alert"><h3>Check the original save</h3><p>{message}</p><div>{foundOriginal && <button className="e04-preparation-primary" onClick={() => exit.request(() => onOpenRecord(foundOriginal))}>Open recorded draft<ArrowRight size={16} /></button>}<button className="e04-preparation-primary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />Check original save</button><button onClick={() => { setPhase('editing'); setMessage('Continue the original draft. Saving reuses its original request and will not replace an existing document.'); }}>Continue this draft</button></div></div>}
    {(phase === 'editing' || busy) && <form onSubmit={save} className="e04-preparation-layout">
      <div className="e04-preparation-document"><div className="e04-preparation-form-row"><label>Agreement title<input ref={titleField} value={title} onChange={event => setTitle(event.target.value)} disabled={busy} placeholder="Client services agreement" /></label><label>Client<select ref={clientField} value={clientId} onChange={event => setClientId(event.target.value)} disabled={busy || !clientsReady || !clientsReadable}><option value="">Select a client</option>{visibleClients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label></div><div ref={bodyPanel}><AgreementBodyEditor scopeKey={`${tenantId}:${requestId}`} value={body} onChange={setBody} readOnly={busy} /></div></div>
      <aside className="e04-preparation-context"><div className="e04-preparation-context-card"><FileText size={22} aria-hidden="true" /><h3>A draft for review</h3><p>Saving retains the agreement wording and client relationship. It does not request a signature or payment.</p><ul><li><Check size={16} aria-hidden="true" />Review the services and responsibilities.</li><li><Check size={16} aria-hidden="true" />Specify the intended fees and payment dates.</li><li><Check size={16} aria-hidden="true" />Use reviewed terms appropriate to the engagement.</li></ul></div>
        {(!clientsReady || !clientsReadable || visibleClients.length === 0) && <div className="e04-preparation-context-card"><h3>{!clientsReady ? 'Client records are not ready' : !clientsReadable ? 'Client records could not be read' : 'Add the client first'}</h3><p>Select an actual client before retaining an agreement.</p>{clientsReady && clientsReadable && onOpenClients ? <button type="button" onClick={() => exit.request(onOpenClients)}>Open Clients<ArrowRight size={16} /></button> : <button type="button" onClick={onRefresh}>Check client records</button>}</div>}
        {message && <p className="e04-preparation-notice" role="alert">{message}</p>}
        <button className="e04-preparation-primary" type="submit" disabled={busy || !clientsReady || !clientsReadable}>{busy ? <><Loader2 size={16} aria-hidden="true" />Confirming draft…</> : <>Save agreement draft<ArrowRight size={16} /></>}</button>
      </aside>
    </form>}
    {phase === 'record' && visibleRecord && agreement && !historyOpen && <div className="e04-preparation-layout"><section className="e04-preparation-document"><div className="e04-preparation-document-heading"><FileText size={17} aria-hidden="true" /><span>Recorded wording · content version {agreement.version}</span></div>{agreement.body_markdown !== null ? <div className="e04-preparation-paper"><ReactMarkdown components={{ img: ({ alt }) => <span>[Embedded image: {alt || 'document image'}]</span> }}>{agreement.body_markdown}</ReactMarkdown></div> : <div className="e04-preparation-message"><FileText size={28} aria-hidden="true" /><h3>Original PDF document</h3><p>Use signature history and files to inspect the retained documents available for this agreement.</p></div>}</section><aside className="e04-preparation-context"><div className="e04-preparation-context-card"><h3>Agreement details</h3><dl><dt>Client</dt><dd>{currentClient?.name ?? 'Client details are not loaded'}</dd><dt>Document source</dt><dd>{agreement.body_source === 'tenant_template' ? 'Business template version' : agreement.body_source === 'tenant_upload' ? 'Uploaded document' : 'Authored agreement'}</dd>{agreement.expires_at && <><dt>Signing link deadline</dt><dd>{historyTime(agreement.expires_at)}</dd></>}<dt>Last recorded</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(agreement.updated_at))}</dd></dl></div><div className="e04-preparation-context-card"><Users size={22} aria-hidden="true" /><h3>Signing progress</h3>{visibleRecord.signers.length ? <ol className="e04-preparation-signers">{visibleRecord.signers.map(signer => <li key={signer.id}><strong>{signer.full_name}</strong><span>{signer.email}</span><small>{signer.signer_role === 'counterparty' ? 'Client signer' : signer.signer_role === 'tenant_signatory' ? 'Business signer' : 'Witness'} · Order {signer.signing_order} · {SIGNER_STATE[signer.status] ?? 'Status unavailable'}</small></li>)}</ol> : <p>No signer is recorded. A signer is required before signatures can be requested.</p>}</div><div className="e04-preparation-context-card"><h3>Document changes</h3><p>Inspect wording retained under this agreement. Earlier saved versions may not be available.</p><button ref={historyTrigger} onClick={() => setHistoryOpen(true)}>Inspect wording history</button></div><AgreementRecordHistory key={agreement.id} id={agreement.id} tenantId={tenantId} completed={agreement.status === 'completed'} signings={signings} /><p className="e04-preparation-note">A signing status does not establish payment or completion of the agreed services.</p></aside></div>}
    {exit.confirmation}
  </article>;
}

const eventLabels: Record<string, string> = {
  created: 'Draft recorded', edited: 'Draft revised', sent: 'Signature request issued',
  viewed: 'Signing page opened', signed: 'Signature recorded', completed: 'Signing completed',
  declined: 'Signing declined', voided: 'Agreement stopped', expired: 'Signing request expired',
  signer_added: 'Signer added', signer_removed: 'Signer removed',
};
function historyTime(value: string | null) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time) : 'Time unavailable';
}
function AgreementRecordHistory({ id, tenantId, completed, signings }: { id: string; tenantId: string; completed: boolean; signings: Props['signings'] }) {
  const [trail, setTrail] = React.useState<SigningEventsResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copyBusy, setCopyBusy] = React.useState(false);
  const [copyMessage, setCopyMessage] = React.useState('');
  const [copyUrl, setCopyUrl] = React.useState<string | null>(null);
  const live = React.useRef(true), historyRequest = React.useRef(0), copyRequest = React.useRef(0), retainedUrl = React.useRef<string | null>(null);
  React.useEffect(() => { live.current = true; return () => { live.current = false; if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current); }; }, []);
  const load = async () => {
    const turn = ++historyRequest.current; setLoading(true);
    let result: SigningEventsResult;
    try { result = await signings.signingEvents(id, tenantId); }
    catch { result = { ok: false, message: 'Agreement history could not be read. Try the original record again.' }; }
    if (!live.current || turn !== historyRequest.current) return;
    setTrail(result); setLoading(false);
  };
  const copy = async () => {
    const turn = ++copyRequest.current; setCopyBusy(true); setCopyMessage('');
    let result: Awaited<ReturnType<Props['signings']['signedCopyUrl']>>;
    try { result = await signings.signedCopyUrl(id, tenantId); }
    catch { result = { ok: false, message: 'The retained document could not be read. Try again from the original agreement.' }; }
    if (!live.current || turn !== copyRequest.current) { if (result.ok === true && result.url.startsWith('blob:')) URL.revokeObjectURL(result.url); return; }
    setCopyBusy(false);
    if (result.ok === false) { setCopyMessage(result.message); return; }
    if (!result.url.startsWith('blob:')) { setCopyMessage('The retained copy could not be verified for this view. Try again from the original agreement.'); return; }
    if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current);
    retainedUrl.current = result.url; setCopyUrl(result.url);
  };
  return <section className="e04-preparation-context-card" aria-label="Agreement history and files"><h3>History and files</h3>
    {loading ? <><p role="status">Reading recorded agreement activity…</p><button onClick={() => { historyRequest.current++; setLoading(false); }}>Stop waiting</button></> : <button onClick={() => { void load(); }}><RefreshCw size={16} />{trail ? 'Refresh history' : 'View signing history'}</button>}
    {trail && (trail.ok === true ? <>{trail.events.length ? <ol className="e04-agreement-history">{trail.events.map(event => <li key={event.id}><strong>{eventLabels[event.type] ?? 'Agreement activity recorded'}</strong><span>{historyTime(event.at)}</span><small>{event.actorKind === 'system' ? 'System record' : event.actorKind === 'signer' ? 'Signer record' : 'Authorized account record'}{event.actorEmail ? ` · ${event.actorEmail}` : ''}</small></li>)}</ol> : <p>No agreement activity was returned.</p>}{trail.truncated && <p>Older activity is outside this view. The latest {trail.events.length} recorded events are shown.</p>}</> : <p role="alert">{trail.message}</p>)}
    {completed && <>{copyBusy ? <><p role="status">Reading the retained document…</p><button onClick={() => { copyRequest.current++; setCopyBusy(false); }}>Stop waiting</button></> : <button onClick={() => { void copy(); }}><FileText size={16} />Prepare retained document</button>}{copyUrl && <a className="e04-agreement-file" href={copyUrl} download="completed-agreement.pdf" target="_blank" rel="noopener noreferrer">Download retained document<ArrowRight size={16} /></a>}{copyMessage && <p role="alert">{copyMessage}</p>}</>}
  </section>;
}
