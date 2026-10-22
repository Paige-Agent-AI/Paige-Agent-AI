import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, FileText, Loader2, RefreshCw } from 'lucide-react';
import { readAgreementRetainedWording, readAgreementRevisions,
  type AgreementRetainedWording, type AgreementRevisionPage } from './agreementRevisionApi';

type Props = { tenantId: string; agreementId: string; currentVersion: number; currentUpdatedAt: string; onClose: () => void; onAccessRefused: () => void };
type Read<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string; refused: boolean };
const time = (at: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));

/** Read-only child of the existing author-scoped preparation page. */
export function AgreementWordingHistory({ tenantId, agreementId, currentVersion, currentUpdatedAt, onClose, onAccessRefused }: Props) {
  const refused = React.useRef(onAccessRefused);
  refused.current = onAccessRefused;
  const [cursor, setCursor] = React.useState<number | undefined>();
  const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  const [bodyAttempt, retryBody] = React.useReducer((value: number) => value + 1, 0);
  const [page, setPage] = React.useState<Read<AgreementRevisionPage>>({ state: 'loading' });
  const [selectedId, select] = React.useState<string | null>(null);
  const [body, setBody] = React.useState<Read<AgreementRetainedWording> | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const paperHeading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { heading.current?.focus(); }, []);
  React.useEffect(() => {
    let current = true;
    setPage({ state: 'loading' }); select(null); setBody(null);
    void readAgreementRevisions(tenantId, agreementId, cursor).then(result => {
      if (!current) return;
      if (result.ok === true) { setPage({ state: 'ready', value: result.value }); select(result.value.revisions[0]?.id ?? null); }
      else { if (result.reason === 'refused') { refused.current(); return; } setPage({ state: 'error', message: result.message, refused: false }); }
    });
    return () => { current = false; };
  }, [tenantId, agreementId, cursor, attempt]);
  React.useEffect(() => {
    let current = true;
    if (!selectedId || page.state !== 'ready') return;
    const metadata = page.value.revisions.find(row => row.id === selectedId);
    if (!metadata) return;
    setBody({ state: 'loading' });
    void readAgreementRetainedWording(tenantId, agreementId, selectedId).then(result => {
      if (!current) return;
      if (result.ok === false) {
        if (result.reason === 'refused') { select(null); setBody(null); setPage({ state: 'error', message: result.message, refused: true }); refused.current(); }
        else setBody({ state: 'error', message: result.message, refused: false });
        return;
      }
      const value = result.value;
      if (value.revision_no !== metadata.revision_no || value.source_body_version !== metadata.source_body_version ||
        value.snapshot_sha256 !== metadata.snapshot_sha256 || value.title !== metadata.title || value.body_source !== metadata.body_source ||
        value.source_updated_at !== metadata.source_updated_at || value.retained_at !== metadata.retained_at || value.retained_by !== metadata.retained_by) {
        setBody({ state: 'error', message: 'The selected wording does not match its recorded history. Read the original history again.', refused: false }); return;
      }
      setBody({ state: 'ready', value });
    });
    return () => { current = false; };
  }, [tenantId, agreementId, selectedId, page, bodyAttempt]);
  React.useEffect(() => {
    if (body?.state === 'ready') { paperHeading.current?.focus(); paperHeading.current?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }); }
  }, [body]);
  const recorded = body?.state === 'ready' ? body.value : null;
  const changed = page.state === 'ready' && (page.value.current_source_version !== currentVersion || page.value.current_updated_at !== currentUpdatedAt);
  return <section className="e04-wording-history" aria-label="Agreement wording history">
    <button className="e04-preparation-back" onClick={onClose}><ArrowLeft size={16} />Return to current agreement</button>
    <h3 ref={heading} tabIndex={-1}>Wording history</h3>
    <p className="e04-preparation-note">Inspect saved wording under the same agreement. Retained revisions and the document’s content version are different records of change. Earlier wording may not have been retained.</p>
    {changed && <p role="status" className="e04-preparation-notice">The current agreement changed after this page opened. Return and refresh its original record before making a correction.</p>}
    <div className="e04-preparation-layout">
      <section className="e04-preparation-document" aria-label="Selected saved wording" aria-busy={body?.state === 'loading'}>
        {!body && <div className="e04-preparation-message"><FileText size={28} aria-hidden="true" /><h3>{page.state === 'loading' ? 'Checking retained history' : page.state === 'error' ? 'No saved wording is shown' : page.value.revisions.length === 0 ? 'Earlier wording is not available' : 'Choose a saved revision'}</h3><p>{page.state === 'error' ? 'The history read did not establish which earlier wording is available. Retry or return to the current agreement.' : 'Inspect an actual retained record, or return to the current document. Missing earlier versions are not reconstructed.'}</p></div>}
        {body?.state === 'loading' && <div role="status" className="e04-preparation-message"><Loader2 className="e04-preparation-spinner" size={24} /><h3>Reading saved wording</h3><p>Confirming the selected original revision.</p></div>}
        {body?.state === 'error' && <div role="alert" className="e04-preparation-message"><h3>Saved wording could not be verified</h3><p>{body.message}</p><button onClick={retryBody}><RefreshCw size={16} />Retry selected wording</button></div>}
        {recorded && <><div className="e04-preparation-document-heading"><FileText size={17} aria-hidden="true" /><span>Retained revision {recorded.revision_no} · Content version {recorded.source_body_version}</span></div><div className="e04-preparation-paper"><h3 ref={paperHeading} tabIndex={-1}>{recorded.title}</h3>{recorded.body_markdown !== null ? <ReactMarkdown components={{ img: ({ alt }) => <span>[Embedded image: {alt || 'document image'}]</span> }}>{recorded.body_markdown}</ReactMarkdown> : <><p>This revision references an uploaded document.</p><p>Its retained file bytes cannot be verified in this view. Return to the current agreement to inspect available files.</p></>}<p className="e04-preparation-note">Read-only draft evidence. This wording does not establish what was signed, paid or delivered.</p></div></>}
      </section>
      <aside className="e04-preparation-context">
        <div className="e04-preparation-context-card"><h3>Saved revisions</h3>
          {page.state === 'loading' && <p role="status">Reading the agreement’s retained history…</p>}
          {page.state === 'error' && <><p role="alert">{page.refused ? 'Agreement author access must be checked in the original business.' : page.message}</p><button onClick={retry}><RefreshCw size={16} />{page.refused ? 'Recheck history access' : 'Retry history read'}</button></>}
          {page.state === 'ready' && <>{page.value.revisions.length ? <label className="e04-wording-picker">Saved revision<select aria-label="Saved revision" value={selectedId ?? ''} onChange={event => { if (event.target.value === selectedId) return; setBody(null); select(event.target.value); }}>{page.value.revisions.map(row => <option key={row.id} value={row.id}>Retained {row.revision_no} · Content {row.source_body_version} · {time(row.retained_at)}</option>)}</select><span>{page.value.revisions.length} retained {page.value.revisions.length === 1 ? 'revision' : 'revisions'} in this page</span></label> : <p role="status">No retained wording was returned. The current document remains available.</p>}{page.value.truncated && <button onClick={() => setCursor(page.value.next_before_revision_no ?? undefined)}>Read older wording</button>}{cursor !== undefined && <button onClick={() => setCursor(undefined)}>Return to latest wording</button>}</>}
        </div>
        {recorded && <div className="e04-preparation-context-card"><h3>Original source</h3><dl><dt>Source last updated</dt><dd>{time(recorded.source_updated_at)}</dd><dt>Retained in history</dt><dd>{time(recorded.retained_at)}</dd><dt>Source</dt><dd>{recorded.body_source === 'tenant_upload' ? 'Uploaded document reference' : recorded.body_source === 'tenant_template' ? 'Business template wording' : 'Authored agreement wording'}</dd></dl><p className="e04-preparation-note">Retention time does not recreate missing earlier activity or a signature.</p></div>}
      </aside>
    </div>
  </section>;
}
