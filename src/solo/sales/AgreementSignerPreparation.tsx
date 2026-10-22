import React from 'react';
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, Users } from 'lucide-react';
import type { AgreementPreparation } from './agreementPreparationApi';
import type { AgreementSignerCommand, AgreementSignerDraft } from './agreementSignerApi';
import { SIGNER_STATE } from './agreementVocabulary';

export type AgreementSignerSession = {
  original: AgreementPreparation; draft: AgreementSignerDraft; requestId: string | null;
  state: 'editing' | 'saving' | 'unconfirmed' | 'checking' | 'conflict' | 'blocked';
  command: AgreementSignerCommand | null; message: string;
};
type Props = {
  session: AgreementSignerSession; clientName: string;
  onChange: (patch: Partial<AgreementSignerDraft>) => void;
  onSave: () => void; onRecover: () => void; onReturn: () => void;
};
export function AgreementSignerPreparation({ session: s, clientName, onChange, onSave, onRecover, onReturn }: Props) {
  const heading = React.useRef<HTMLHeadingElement>(null), name = React.useRef<HTMLInputElement>(null), email = React.useRef<HTMLInputElement>(null), order = React.useRef<HTMLInputElement>(null);
  const [validation, setValidation] = React.useState('');
  const initialState = React.useRef(s.state);
  React.useEffect(() => { if (initialState.current === 'editing') name.current?.focus(); else heading.current?.focus(); }, []);
  const locked = s.command !== null || s.state !== 'editing';
  const busy = s.state === 'saving' || s.state === 'checking';
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!s.draft.fullName.trim() || s.draft.fullName.length > 200) { setValidation('Enter the signer’s name, up to 200 characters.'); name.current?.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.draft.email.trim()) || s.draft.email.trim().length > 320) { setValidation('Enter the signer’s complete email address.'); email.current?.focus(); return; }
    if (s.draft.order !== '' && (!/^[1-9][0-9]*$/.test(s.draft.order) || Number(s.draft.order) > 2_147_483_647)) { setValidation('Use an available signing position starting at 1, or leave it empty for the next position.'); order.current?.focus(); return; }
    setValidation(''); onSave();
  };
  return <section className="e04-signer-preparation" aria-label="Prepare agreement signers">
    <button className="e04-preparation-back" onClick={onReturn} disabled={busy}><ArrowLeft size={16}/>Return to current agreement</button>
    <div className="e04-preparation-layout">
      <div className="e04-signer-main"><header className="e04-signer-heading"><span className="e04-signer-mark"><Users size={22} aria-hidden="true"/></span><div><h3 ref={heading} tabIndex={-1}>Prepare signers</h3><p>Assign the people who will review and sign this agreement.</p></div></header>
        <section className="e04-signer-roster" aria-label="Recorded signing order"><h4>Recorded signing order</h4>{s.original.signers.length ? <ol>{[...s.original.signers].sort((a,b)=>a.signing_order-b.signing_order).map(signer=><li key={signer.id}><span className="e04-signer-position" aria-label={`Position ${signer.signing_order}`}>{signer.signing_order}</span><div><strong>{signer.full_name}</strong><span>{signer.email}</span><small>{signer.signer_role==='counterparty'?'Client signer':signer.signer_role==='tenant_signatory'?'Business signer':'Witness'} · {SIGNER_STATE[signer.status]}</small></div></li>)}</ol>:<p>No signer has been recorded for this agreement.</p>}</section>
        <form className="e04-signer-form" onSubmit={submit} noValidate><h4>{s.command || s.state!=='editing' ? 'Original preparation request' : 'Add a signer'}</h4>
          {s.requestId && !s.command && <p className="e04-preparation-note">The original request can be checked without re-entering private signer details.</p>}
          {(!s.requestId || s.command) && <><div className="e04-preparation-form-row"><label>Full name<input ref={name} value={s.draft.fullName} readOnly={locked} onChange={event=>onChange({fullName:event.target.value})} autoComplete="off" maxLength={200}/></label><label>Email address<input ref={email} type="email" value={s.draft.email} readOnly={locked} onChange={event=>onChange({email:event.target.value})} autoComplete="off" maxLength={320}/></label></div>
          <div className="e04-preparation-form-row"><label>Signer role<select value={s.draft.role} disabled={locked} onChange={event=>onChange({role:event.target.value as AgreementSignerDraft['role']})}><option value="counterparty">Client signer</option><option value="tenant_signatory">Business signer</option><option value="witness">Witness</option></select></label><label>Signing position<input ref={order} type="text" inputMode="numeric" value={s.draft.order} readOnly={locked} placeholder="Next available position" aria-describedby="e04-signer-order-note" onChange={event=>onChange({order:event.target.value})}/></label></div><p id="e04-signer-order-note" className="e04-preparation-note">Signers complete their steps in the recorded order. Each position belongs to one signer.</p></>}
          {(validation || s.message) && <p className="e04-preparation-notice" role="alert">{validation || s.message}</p>}
          <div className="e04-signer-actions">{!locked && <button className="e04-preparation-primary" type="submit">Save signer<ArrowRight size={16}/></button>}
            {busy && <p role="status"><Loader2 size={16} className="e04-preparation-spinner" aria-hidden="true"/>{s.state==='checking'?'Checking the original request…':'Confirming signer preparation…'}</p>}
            {s.state==='unconfirmed' && <><button type="button" className="e04-preparation-primary" onClick={onRecover}><RefreshCw size={16}/>Check original signer request</button>{s.command && <button type="submit">Retry same signer request</button>}</>}
          </div>
        </form>
      </div>
      <aside className="e04-preparation-context"><section className="e04-preparation-context-card"><h3>Preparing this agreement</h3><dl><dt>Client</dt><dd>{clientName}</dd><dt>Agreement</dt><dd>{s.original.agreement.title}</dd><dt>Reviewed content version</dt><dd>{s.original.agreement.version}</dd></dl><p>Saving records a signer and updates the agreement’s preparation version. Review the document and all recipients before requesting signatures.</p></section><section className="e04-preparation-context-card"><h3>Before sending</h3><p>Signer preparation does not send an email, record consent or collect a signature. Signature requests require the prepared document and authorized sending workflow.</p></section></aside>
    </div>
  </section>;
}
