import React from 'react';
import {CheckCircle2,Clock3,RefreshCw,ShieldCheck} from 'lucide-react';
import {submitAgreementSignatureRequest,readAgreementSignatureRecovery,type AgreementDocumentContext,type AgreementSignatureRequest,
  type AgreementSignatureProposal,type AgreementSignatureReference,type AgreementSignatureSubmission,type AgreementSignatureRecovery,
  type AgreementSignatureCommand,type AgreementSignatureOutcome} from './agreementDocumentApi';

export type SignatureProgress={busy:boolean;uncertain:boolean;readOnly?:boolean;retained?:boolean};
type Callbacks={context:()=>AgreementDocumentContext;onAccessRefused:()=>void;onProgress:(value:SignatureProgress)=>void};
const isOutcome=(value:AgreementSignatureSubmission|AgreementSignatureRecovery):value is AgreementSignatureOutcome=>
  value!==null&&'kind' in value&&value.kind==='prepared_signature_request_result';
const uncertain=(value:AgreementSignatureSubmission|AgreementSignatureRecovery)=>!isOutcome(value)||value.state!=='provider_accepted';
function SignatureOutcome({value}:{value:AgreementSignatureOutcome}){
  const accepted=value.state==='provider_accepted',partial=value.state==='provider_partial';
  return <div className="e04-signature-result" role="status"><h6 tabIndex={-1}>{accepted?<CheckCircle2 size={22} aria-hidden="true"/>:<Clock3 size={22} aria-hidden="true"/>}
    {accepted?'Email provider accepted the requests':partial?'Some requests were accepted':'Verification pending'}</h6>
    <p>{accepted?'The original sending records confirm provider acceptance. This does not confirm delivery, viewing, signing or payment.':partial?
      'The original records confirm only part of this request. Do not send the entire request again. Check the original status before any follow-up.':
      'The original work is retained, but sending has not been fully verified. Check this request before taking another action.'}</p>
    <details><summary>Original request and receipt</summary><dl><dt>Request</dt><dd>{value.operation_id}</dd><dt>Work</dt><dd>{value.work_id}</dd>
      {value.receipt_id&&<><dt>Receipt</dt><dd>{value.receipt_id}</dd></>}</dl></details></div>;
}

/** Inline presentation of the ORIGINAL HIGH confirmation and writer. There is
 * no automatic action, second approval store, retry timer or provider client. */
export function AgreementSignatureExecution({request,context,onRetain,onProgress,onAccessRefused}:{request:AgreementSignatureRequest;
  onRetain:(value:AgreementSignatureReference)=>boolean}&Callbacks){
  const [phase,setPhase]=React.useState<'idle'|'preparing'|'approval'|'submitting'|'result'|'checking'>('idle');
  const [proposal,setProposal]=React.useState<AgreementSignatureProposal|null>(null),[result,setResult]=React.useState<AgreementSignatureOutcome|null>(null);
  const [message,setMessage]=React.useState(''),[expired,setExpired]=React.useState(false);
  const [verifiedExpiry,setVerifiedExpiry]=React.useState(false),[refused,setRefused]=React.useState(false);
  const alive=React.useRef(false),inflight=React.useRef(false),generation=React.useRef(0),heading=React.useRef<HTMLHeadingElement>(null);
  const refs=React.useRef({request,context,onRetain,onProgress,onAccessRefused});refs.current={request,context,onRetain,onProgress,onAccessRefused};
  React.useEffect(()=>{alive.current=true;const epoch=generation;return()=>{alive.current=false;epoch.current++;};},[]);
  React.useEffect(()=>{if(!proposal)return;const left=Date.parse(proposal.expires_at)-Date.now();setExpired(left<=0);
    if(left<=0)return;const timer=setTimeout(()=>setExpired(true),Math.min(left,2147483647));return()=>clearTimeout(timer);},[proposal]);
  React.useLayoutEffect(()=>{if(phase==='approval'||phase==='result')heading.current?.focus();},[phase]);
  const ref={operation_id:request.args.operationId,request_sha256:request.request_sha256};
  const perform=async(approve=false,read=false)=>{
    if(inflight.current)return;
    const p=refs.current,ctx=p.context();if(!ctx.isCurrent())return;
    if(!read&&!approve&&!p.onRetain(ref)){setMessage('The return reference could not be retained. Reopen the original agreement before preparing approval.');return;}
    if(approve&&(!proposal||expired||Date.parse(proposal.expires_at)<=Date.now())){setExpired(true);return;}
    inflight.current=true;const opened=++generation.current,active=()=>alive.current&&opened===generation.current&&ctx.isCurrent();
    setMessage('');setVerifiedExpiry(false);setRefused(false);setPhase(read?'checking':approve?'submitting':'preparing');p.onProgress({busy:true,uncertain:read||approve});
    const reply=read?await readAgreementSignatureRecovery({...ctx,isCurrent:active},ref):await submitAgreementSignatureRequest({...ctx,isCurrent:active},p.request,approve?proposal!.fingerprint:undefined);
    if(!active())return;inflight.current=false;
    if(reply.ok===false){if(reply.reason==='access_unverified'||reply.reason==='retired'){p.onAccessRefused();return;}
      setPhase('result');setMessage(reply.message);p.onProgress({busy:false,uncertain:true,readOnly:true});return;}
    const value=reply.value;
    if(value&&'state' in value&&value.state==='approval_required'){
      setProposal(value);setPhase('approval');p.onProgress({busy:false,uncertain:false,retained:true});return;
    }
    setProposal(null);setPhase('result');setResult(isOutcome(value)?value:null);
    if(value&&'kind' in value&&value.kind==='prepared_signature_request_review_recovery'&&value.state==='review_unavailable'&&value.reason==='expired'){
      setVerifiedExpiry(true);setMessage('The original approval review expired. Edit the invitations and prepare a fresh review against the current document.');
      p.onProgress({busy:false,uncertain:false,readOnly:false,retained:true});return;
    }
    setRefused(value?.state==='refused');
    setMessage(isOutcome(value)?'':value&&value.state==='refused'?'This request could not be authorized. Check the original request before preparing another.':
      'The sending result is not confirmed. Check the original request; do not repeat the send.');
    p.onProgress({busy:false,uncertain:uncertain(value),readOnly:true,retained:isOutcome(value)});
  };
  return <section className="e04-signature-execution" aria-label="Signing request authorization" aria-busy={inflight.current}>
    {phase==='idle'&&<><p>Prepare an approval for this exact document, sending identity and every invitation.</p><button className="e04-preparation-primary" onClick={()=>{void perform();}}>Prepare approval</button></>}
    {phase==='approval'&&proposal&&<div className="e04-signature-approval"><h6 ref={heading} tabIndex={-1}><ShieldCheck size={22} aria-hidden="true"/>Review before sending</h6>
      <p>Send the exact invitations above for <strong>{request.args.title}</strong> to {request.args.recipients.length} {request.args.recipients.length===1?'recipient':'recipients'}.</p>
      <p>Each recipient receives their own secure signing link. Sending does not authorize a charge or establish that anyone signed.</p>
      {expired?<p role="status">This approval review expired. Check the original request before preparing a new review.</p>:<p>Approval expires {new Date(proposal.expires_at).toLocaleString()}.</p>}
      <button className="e04-preparation-primary" disabled={expired} onClick={()=>{void perform(true);}}>Approve and send signing requests</button>
      {expired&&<button onClick={()=>{void perform(false,true);}}>Check original request</button>}</div>}
    {(phase==='preparing'||phase==='submitting'||phase==='checking')&&<p role="status">{phase==='preparing'?'Preparing the original approval review…':phase==='submitting'?'Submitting the authorized signing request. Keep this original request for verification…':'Reading the original request and sending receipts…'}</p>}
    {phase==='result'&&<><div ref={heading} tabIndex={-1}>{result?<SignatureOutcome value={result}/>:<h6>{verifiedExpiry?'Approval review expired':refused?'Request refused':'Verification pending'}</h6>}</div>
      {message&&<p role="status">{message}</p>}<button onClick={()=>{void perform(false,true);}}><RefreshCw size={16} aria-hidden="true"/>Check original request</button></>}
    {phase==='idle'&&message&&<p role="alert">{message}</p>}
  </section>;
}

/** Read-only return to the same native records, even after the document stops
 * being editable. Restoring a draft requires a separate deliberate review. */
export function AgreementSignatureHistory({reference,context,onProgress,onAccessRefused,onResume,headingRef,onFreshReview}:{reference:AgreementSignatureReference;
  onResume:(command:AgreementSignatureCommand)=>void;headingRef?:React.Ref<HTMLHeadingElement>;onFreshReview?:()=>void}&Callbacks){
  const [value,setValue]=React.useState<AgreementSignatureRecovery>(null),[phase,setPhase]=React.useState<'loading'|'ready'|'error'>('loading'),[message,setMessage]=React.useState('');
  const alive=React.useRef(false),generation=React.useRef(0),inflight=React.useRef(false),refs=React.useRef({reference,context,onProgress,onAccessRefused,onResume});refs.current={reference,context,onProgress,onAccessRefused,onResume};
  const read=async()=>{if(inflight.current)return;const p=refs.current,ctx=p.context(),opened=++generation.current;inflight.current=true;setPhase('loading');p.onProgress({busy:true,uncertain:true});
    const active=()=>alive.current&&opened===generation.current&&ctx.isCurrent();const reply=await readAgreementSignatureRecovery({...ctx,isCurrent:active},p.reference);
    if(!active())return;inflight.current=false;
    if(reply.ok===false){if(reply.reason==='access_unverified'||reply.reason==='retired'){p.onAccessRefused();return;}setMessage(reply.message);setPhase('error');p.onProgress({busy:false,uncertain:true});return;}
    const unusedExpired=reply.value&&'reason' in reply.value&&reply.value.reason==='expired';
    setValue(reply.value);setPhase('ready');p.onProgress({busy:false,uncertain:reply.value?.state==='review_available'||unusedExpired?false:uncertain(reply.value),readOnly:isOutcome(reply.value)});
  };
  const reader=React.useRef(read);reader.current=read;
  React.useEffect(()=>{alive.current=true;void reader.current();const epoch=generation;return()=>{alive.current=false;epoch.current++;};},[]);
  return <section className="e04-signature-history" aria-label="Original signing request" aria-busy={phase==='loading'}><h4 ref={headingRef} tabIndex={-1}>Original signing request</h4>
    {phase==='loading'?<p role="status">Reading the retained request and its original receipts…</p>:<>
      {phase==='error'?<p role="alert">{message}</p>:isOutcome(value)?<SignatureOutcome value={value}/>:value?.state==='review_available'?
        <><p>The original draft review is available. Inspect the current document and invitations before any approval. Nothing is sent by restoring it.</p><button onClick={()=>refs.current.onResume(value.command)}>Restore saved review</button></>:
        value?.state==='review_unavailable'?value.reason==='expired'?<><p role="status">The original approval review expired and cannot be approved. Inspect the current document before preparing a fresh review.</p>{onFreshReview&&<button onClick={onFreshReview}>Review current document</button>}</>:
          <p role="status">The original approval review cannot be reused. Its sending result has not been established. Check the original records before another request.</p>:
        <p role="status">No verified request result was returned. This does not establish that nothing happened. Keep this reference and check again.</p>}
      <button onClick={()=>{void read();}}><RefreshCw size={16} aria-hidden="true"/>Check original request</button>
    </>}</section>;
}
