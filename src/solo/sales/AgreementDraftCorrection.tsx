import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, ArrowRight, FileText, Loader2, RefreshCw } from 'lucide-react';
import { AgreementBodyEditor } from './AgreementBodyEditor';
import { nativeAgreementText, type AgreementCorrectionCommand } from './agreementCorrectionApi';
import type { AgreementPreparation } from './agreementPreparationApi';

export type AgreementCorrectionSession = {
  original: AgreementPreparation['agreement']; title: string; body: string;
  state: 'editing' | 'saving' | 'unconfirmed' | 'conflict' | 'blocked';
  command: AgreementCorrectionCommand | null; current: AgreementPreparation | null;
  reading: boolean; message: string;
};
type Props = {
  session: AgreementCorrectionSession; tenantId: string; sessionId: number; clientName: string;
  onChange: (patch: { title?: string; body?: string }) => void; onSave: () => void;
  onRead: () => void; onReturn: () => void;
};
export function AgreementDraftCorrection({ session:s, tenantId, sessionId, clientName, onChange, onSave, onRead, onReturn }: Props) {
  const title = React.useRef<HTMLInputElement>(null), body = React.useRef<HTMLDivElement>(null);
  const [validation, setValidation] = React.useState('');
  React.useEffect(() => { title.current?.focus(); }, []);
  const locked = s.command !== null || s.state !== 'editing';
  const changed = nativeAgreementText(s.title) !== s.original.title || nativeAgreementText(s.body) !== s.original.body_markdown;
  const canRetry = s.state === 'unconfirmed' && s.current?.agreement.can_edit === true
    && s.current.agreement.updated_at === s.command?.expectedUpdatedAt;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!s.title.trim()) { setValidation('Give the agreement a title.'); title.current?.focus(); return; }
    if (!s.body.trim()) { setValidation('Add the agreement wording before saving.'); body.current?.querySelector<HTMLElement>('textarea,[contenteditable="true"]')?.focus(); return; }
    setValidation(''); onSave();
  };
  return <section aria-label="Correct draft wording">
    <button className="e04-preparation-back" onClick={onReturn} disabled={s.state==='saving'}><ArrowLeft size={16}/>Return to current agreement</button>
    <form onSubmit={submit} className="e04-preparation-layout">
      <div className="e04-preparation-document"><label className="e04-correction-title">Draft title<input ref={title} value={s.title} readOnly={locked} onChange={event=>onChange({title:event.target.value})}/></label>
        <div ref={body}><AgreementBodyEditor scopeKey={`${tenantId}:${s.original.id}:correction:${sessionId}`} value={s.body} onChange={value=>onChange({body:value})} readOnly={locked}/></div>
      </div>
      <aside className="e04-preparation-context">
        <div className="e04-preparation-context-card"><FileText size={22} aria-hidden="true"/><h3>Review the correction</h3><dl><dt>Client</dt><dd>{clientName}</dd><dt>Original content version</dt><dd>{s.original.version}</dd></dl><p>The client, offer and commercial references stay with this agreement. Saving does not request signatures or payment.</p></div>
        {(validation || s.message) && <p className="e04-preparation-notice" role="alert">{validation || s.message}</p>}
        {!locked && <button className="e04-preparation-primary" type="submit" disabled={!changed}>Save revised draft<ArrowRight size={16}/></button>}
        {s.state==='saving' && <p role="status"><Loader2 size={16} className="e04-preparation-spinner" aria-hidden="true"/>Confirming correction…</p>}
        {locked && s.state!=='saving' && <div className="e04-preparation-context-card"><h3>{s.state==='unconfirmed'?'Correction not confirmed':s.state==='conflict'?'Current agreement has changed':'Correction unavailable'}</h3><p>Your proposed wording is retained here. Reading the current document does not confirm who changed it or apply this proposal.</p><button type="button" onClick={onRead} disabled={s.reading}><RefreshCw size={16}/>{s.reading?'Reading current agreement…':'Read current agreement'}</button>{canRetry && <button className="e04-preparation-primary" type="submit" disabled={s.reading}>Retry original correction</button>}</div>}
      </aside>
    </form>
    {s.current && <section className="e04-preparation-current" aria-label="Current stored wording"><h3>Current stored wording · content version {s.current.agreement.version}</h3><p>This is a separate read of the original agreement. Your proposal above has not been reapplied.</p>{s.current.agreement.body_markdown !== null ? <div className="e04-preparation-paper"><ReactMarkdown components={{img:({alt})=><span>[Embedded image: {alt || 'document image'}]</span>}}>{s.current.agreement.body_markdown}</ReactMarkdown></div> : <p>The current record references an uploaded document. It cannot be replaced in this text editor.</p>}</section>}
  </section>;
}
