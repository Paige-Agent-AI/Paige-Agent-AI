import React from 'react';
import {CheckCircle2,Link2,RefreshCw} from 'lucide-react';
import {readAgreementSigningSenders,readAgreementSignatureRequest,
  type AgreementDocumentContext,type AgreementSignatureSenders,type AgreementSignatureRequest,
  type AgreementSignatureDraft,type PreparedSignatureReview} from '@/solo/sales/agreementDocumentApi';
import {COMMS_EMAIL_SUBJECT_MAX,COMMS_EMAIL_BODY_MAX} from '../../../supabase/functions/_shared/comms-email/contract';
import {PREPARED_SIGNING_LINK_MARKER} from '../../../supabase/functions/_shared/agreements/prepared-signature-review-contract';

export type SigningMessageDraft=AgreementSignatureDraft&{review_sha256:string};
function initialSigningMessages(review:PreparedSignatureReview):SigningMessageDraft{
  return {review_sha256:review.review_sha256,operation_id:crypto.randomUUID(),connector_id:'',
    messages:review.signers.map(s=>({signer_id:s.id,subject:'Your agreement is ready to review',
      body_text:'Please review the agreement before signing.\n\n'+PREPARED_SIGNING_LINK_MARKER}))};
}
const markerSuffix='\n\n'+PREPARED_SIGNING_LINK_MARKER;
const messageText=(body:string)=>body.endsWith(markerSuffix)?body.slice(0,-markerSuffix.length):body;
type Choices={phase:'loading'}|{phase:'error';message:string}|{phase:'ready';value:AgreementSignatureSenders};
type Check={phase:'idle'}|{phase:'checking'}|{phase:'error';reason:string;message:string}|{phase:'ready';value:AgreementSignatureRequest};
const setupText:Record<string,string>={SENDER_VERIFICATION_MISSING:'Email domain verification is needed.',
  EMAIL_PROVIDER_NOT_CONFIGURED:'Email sending is not ready for this business.',
  EMAIL_RECONNECT_REQUIRED:'Reconnect this email identity.',TENANT_EMAIL_SENDER_MISSING:'This email identity is unavailable.'};

/** Original document workspace subform. No approval, send, token, storage or
 * leave guard. Private draft lifetime and navigation belong to its parent. */
export function AgreementSignatureRequest({review,context,draft,onDraft,onAccessRefused,onReloadSource}:{
  review:PreparedSignatureReview;context:()=>AgreementDocumentContext;draft:SigningMessageDraft|null;
  onDraft:(value:SigningMessageDraft)=>void;onAccessRefused:()=>void;onReloadSource:()=>void;
}){
  const initial=React.useRef<SigningMessageDraft|null>(null);
  if(!initial.current)initial.current=initialSigningMessages(review);
  const value=draft?.review_sha256===review.review_sha256?draft:initial.current;
  const [recipient,setRecipient]=React.useState(review.signers[0]?.id??'');
  const [choices,setChoices]=React.useState<Choices>({phase:'loading'}),[check,setCheck]=React.useState<Check>({phase:'idle'});
  const [notice,setNotice]=React.useState('');
  const alive=React.useRef(false),listEpoch=React.useRef(0),checkEpoch=React.useRef(0);
  const callbacks=React.useRef({review,context,onDraft,onAccessRefused,onReloadSource,value});
  callbacks.current={review,context,onDraft,onAccessRefused,onReloadSource,value};
  const resultHeading=React.useRef<HTMLHeadingElement>(null);
  const limitsId=React.useId();
  const loadChoices=async()=>{
    const p=callbacks.current,ctx=p.context(),opened=++listEpoch.current;
    checkEpoch.current++;setChoices({phase:'loading'});setCheck({phase:'idle'});setNotice('');
    const active=()=>alive.current&&listEpoch.current===opened&&ctx.isCurrent();
    const result=await readAgreementSigningSenders({...ctx,isCurrent:active},p.value.operation_id,p.review);
    if(!active())return;
    if(result.ok===false){if(result.reason==='access_unverified'||result.reason==='retired'){p.onAccessRefused();return;}
      setChoices({phase:'error',message:result.message});return;}
    setChoices({phase:'ready',value:result.value});
  };
  const loader=React.useRef(loadChoices);loader.current=loadChoices;
  React.useEffect(()=>{alive.current=true;void loader.current();const list=listEpoch,checked=checkEpoch;
    return()=>{alive.current=false;list.current++;checked.current++;};},[]);
  React.useLayoutEffect(()=>{if(check.phase==='ready')resultHeading.current?.focus();},[check.phase]);
  const edit=(next:SigningMessageDraft)=>{checkEpoch.current++;setCheck({phase:'idle'});setNotice('');callbacks.current.onDraft(next);};
  const currentMessage=value.messages.find(m=>m.signer_id===recipient);
  const currentSigner=review.signers.find(s=>s.id===recipient);
  const selected=choices.phase==='ready'?choices.value.senders.find(s=>s.connector_id===value.connector_id):undefined;
  const invalid=value.messages.some(m=>!m.subject.trim()||m.subject.length>COMMS_EMAIL_SUBJECT_MAX||
    !messageText(m.body_text).trim()||m.body_text.length>COMMS_EMAIL_BODY_MAX);
  const checkRequest=async()=>{
    if(!selected||selected.state!=='ready'||invalid||check.phase==='checking')return;
    const p=callbacks.current,ctx=p.context(),opened=++checkEpoch.current;
    const active=()=>alive.current&&checkEpoch.current===opened&&ctx.isCurrent();
    setCheck({phase:'checking'});setNotice('');
    const result=await readAgreementSignatureRequest({...ctx,isCurrent:active},p.review,selected,p.value);
    if(!active())return;
    if(result.ok===false){if(result.reason==='access_unverified'||result.reason==='retired'){p.onAccessRefused();return;}
      setCheck({phase:'error',reason:result.reason,message:result.message});return;}
    setCheck({phase:'ready',value:result.value});
  };
  const changeMessage=(patch:Partial<AgreementSignatureDraft['messages'][number]>)=>{
    edit({...value,messages:value.messages.map(m=>m.signer_id===recipient?{...m,...patch}:m)});
  };
  return <section className="e04-signature-invitations" aria-label="Signature invitation preparation" aria-busy={choices.phase==='loading'||check.phase==='checking'}>
    <header><h5>Prepare signature invitations</h5><p>Choose your business email and review the message for every recipient. This check sends nothing.</p></header>
    <div className="e04-invitation-sender">
      {choices.phase==='loading'&&<div role="status"><p>Checking your business email identities…</p><button onClick={()=>{listEpoch.current++;setChoices({phase:'error',message:'Email checking stopped. Your message draft is still here.'});}}>Stop checking email identities</button></div>}
      {choices.phase==='error'&&<div role="alert"><p>{choices.message}</p><button onClick={()=>{void loadChoices();}}><RefreshCw size={16} aria-hidden="true"/>Retry email identities</button></div>}
      {choices.phase==='ready'&&(choices.value.senders.length?<><label>Send from<select aria-label="Send from" value={value.connector_id} onChange={e=>edit({...value,connector_id:e.target.value})}>
        <option value="">Choose a business email</option>{choices.value.senders.map(s=><option key={s.connector_id} value={s.connector_id}>{s.from_address}{s.state!=='ready'?' · Setup needed':''}</option>)}
      </select></label>{selected?.reason&&<p role="status">{setupText[selected.reason]}</p>}<button onClick={()=>{void loadChoices();}}>Refresh email identities</button></>:
        <div role="status"><h6>No usable business email was returned</h6><p>Connect and verify PAIGE Email in Settings → Connections, then check again.</p><button onClick={()=>{void loadChoices();}}>Check email identities again</button></div>)}
    </div>
    {check.phase!=='ready'&&<>
      <div className="e04-invitation-message">
        <label>Recipient<select aria-label="Invitation recipient" value={recipient} onChange={e=>setRecipient(e.target.value)}>
          {review.signers.map(s=><option key={s.id} value={s.id}>{s.full_name} · Step {s.signing_order}</option>)}
        </select></label>
        {currentSigner&&<p className="e04-invitation-recipient-detail">{currentSigner.email} · {currentSigner.signer_role==='counterparty'?'Client':currentSigner.signer_role==='tenant_signatory'?'Business signer':'Witness'}</p>}
        {currentMessage&&<><label>Subject<input aria-label="Invitation subject" value={currentMessage.subject} maxLength={COMMS_EMAIL_SUBJECT_MAX} onChange={e=>changeMessage({subject:e.target.value})}/></label>
          <label>Message<textarea aria-label="Invitation message" aria-describedby={limitsId} rows={5} maxLength={COMMS_EMAIL_BODY_MAX-markerSuffix.length} value={messageText(currentMessage.body_text)} onChange={e=>changeMessage({body_text:e.target.value+markerSuffix})}/></label>
          <p id={limitsId}>Subject: up to {COMMS_EMAIL_SUBJECT_MAX} characters. Message: up to {COMMS_EMAIL_BODY_MAX-markerSuffix.length} characters.</p><p className="e04-invitation-link"><Link2 size={16} aria-hidden="true"/>A secure signing link will be included after an authorized send.</p></>}
      </div>
      {invalid&&<p className="e04-invitation-problem" role="status">Every recipient needs a subject and message within the displayed limits.</p>}
      {check.phase==='error'&&<div className="e04-invitation-problem" role="alert"><p>{check.message}</p>{check.reason==='source_changed'?<button onClick={onReloadSource}>Read current document source</button>:check.reason==='sender_changed'?<button onClick={()=>{void loadChoices();}}>Refresh sending identity</button>:null}</div>}
      <div className="e04-invitation-actions"><button className="e04-preparation-primary" disabled={!selected||selected.state!=='ready'||invalid||check.phase==='checking'||(check.phase==='error'&&['source_changed','sender_changed'].includes(check.reason))} onClick={()=>{void checkRequest();}}>{check.phase==='checking'?'Checking complete request…':'Check complete request'}</button>
        {check.phase==='checking'&&<button onClick={()=>{checkEpoch.current++;setCheck({phase:'idle'});setNotice('Request checking stopped. Nothing was sent; your messages are still here.');}}>Stop waiting</button>}</div>
      {check.phase==='checking'&&<p role="status">Rechecking the saved document, email identity, recipients and exact messages…</p>}
    </>}
    {check.phase==='ready'&&<div className="e04-invitation-checked">
      <h6 ref={resultHeading} tabIndex={-1}><CheckCircle2 size={20} aria-hidden="true"/>Request checked · not sent</h6>
      <p>From {check.value.args.sender.from_name?check.value.args.sender.from_name+' <'+check.value.args.sender.from_address+'>':check.value.args.sender.from_address}</p>
      {check.value.args.sender.reply_to&&<p>Replies to {check.value.args.sender.reply_to}</p>}
      {check.value.args.messages.map(m=><article key={m.signer_id}><h6>{review.signers.find(s=>s.id===m.signer_id)?.full_name}</h6><p>{m.to}</p><strong>{m.subject}</strong><p className="e04-invitation-body">{messageText(m.body_text)}</p><p className="e04-invitation-link"><Link2 size={16} aria-hidden="true"/>Secure signing link included after authorized sending</p></article>)}
      <p>This is a read of the intended request. Approval, sending, delivery and signatures have not occurred.</p>
      <button onClick={()=>{checkEpoch.current++;setCheck({phase:'idle'});}}>Edit invitations</button>
      <details><summary>Request check reference</summary><p>{check.value.request_sha256}</p><p>This reference identifies the checked content. It is not an approval or delivery receipt.</p></details>
    </div>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
