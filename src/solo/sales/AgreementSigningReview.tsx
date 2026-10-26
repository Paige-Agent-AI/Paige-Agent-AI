import React from 'react';
import {ArrowLeft,FileCheck2,FileText,RefreshCw} from 'lucide-react';
import {AgreementSignatureRequest,type SigningMessageDraft} from './AgreementSignatureRequest';
import type {AgreementDocumentContext} from './agreementDocumentApi';
import type {DocumentFailure,PreparedSignatureReview} from './agreementDocumentApi';
import type {AgreementSignatureReference} from './agreementDocumentApi';
import type {SignatureProgress} from './AgreementSignatureExecution';

export type AgreementSigningReviewState=
  |{phase:'loading'}
  |{phase:'error';reason:DocumentFailure;message:string}
  |{phase:'ready';review:PreparedSignatureReview};

/** A source-backed READ inside the original document workspace. This component
 * owns no authorization, approval, signing link, sender, receipt or leave guard. */
export function AgreementSigningReview({state,revisionNo,onReturn,onRetry,onReloadSource,context,draft,onDraft,onAccessRefused,onRetainSignatureRequest,onSignatureProgress}:{
  state:AgreementSigningReviewState;revisionNo:number;onReturn:()=>void;onRetry:()=>void;onReloadSource:()=>void;context:()=>AgreementDocumentContext;draft:SigningMessageDraft|null;onDraft:(value:SigningMessageDraft)=>void;onAccessRefused:()=>void;
  onRetainSignatureRequest?:(value:AgreementSignatureReference)=>boolean;onSignatureProgress?:(value:SignatureProgress)=>void;
}){
  const heading=React.useRef<HTMLHeadingElement>(null);
  React.useLayoutEffect(()=>{heading.current?.focus();},[]);
  const review=state.phase==='ready'?state.review:null;
  const retry=()=>{heading.current?.focus();onRetry();};
  const issueText=(issue:PreparedSignatureReview['issues'][number])=>{
    if(issue.code==='missing_signer')return 'Add the intended recipients before requesting signatures.';
    if(issue.code==='missing_signature')return `${review?.signers.find(s=>s.id===issue.signer_id)?.full_name??'A recipient'} needs a required signature field.`;
    return 'Two assigned fields overlap. Separate them in the document, then save.';
  };
  return <section className="e04-prepared-review" aria-label="Saved signing request review" aria-busy={state.phase==='loading'}>
    <header className="e04-prepared-review-heading"><div><h4 ref={heading} tabIndex={-1}>Review signing request</h4><p>Saved preparation {revisionNo}{review?` · Agreement version ${review.request.expected_source.version}`:''}</p></div><button onClick={onReturn}><ArrowLeft size={16} aria-hidden="true"/>Back to document</button></header>
    {state.phase==='loading'&&<p className="e04-prepared-review-progress" role="status">Checking the saved document, recipients and field assignments…</p>}
    {state.phase==='error'&&<div className="e04-prepared-review-problem" role="alert"><h5>{state.reason==='source_changed'?'The saved source changed':'Review unavailable'}</h5><p>{state.message}</p>{state.reason==='source_changed'?<button onClick={onReloadSource}>Read current document source</button>:<button onClick={retry}><RefreshCw size={16} aria-hidden="true"/>Retry saved review</button>}</div>}
    {review&&<>
      <div className="e04-prepared-review-status" role="status"><FileCheck2 size={24} aria-hidden="true"/><div><strong>{review.ready_for_review?'Saved document checked':'Field corrections needed'}</strong>{review.ready_for_review?<p>The recipients and assigned fields match the selected saved preparation.</p>:<ul>{review.issues.map((issue,index)=><li key={index}>{issueText(issue)}</li>)}</ul>}</div></div>
      <section className="e04-prepared-review-recipients" aria-label="Recipients and signing order"><h5>Recipients and signing order</h5><p>Recipients at the same step may sign in parallel.</p>{review.signers.length?<ol>{review.signers.map(s=><li key={s.id}><span className="e04-prepared-review-step">Step {s.signing_order}</span><div><strong>{s.full_name}</strong><span>{s.email}</span><span>{s.signer_role==='counterparty'?'Client':s.signer_role==='tenant_signatory'?'Business signer':'Witness'}</span></div><span>{s.field_count} assigned {s.field_count===1?'field':'fields'}</span></li>)}</ol>:<p>No recipients are assigned in this saved preparation.</p>}</section>
      {review.ready_for_review&&<AgreementSignatureRequest key={review.review_sha256} review={review} context={context} draft={draft} onDraft={onDraft} onAccessRefused={onAccessRefused} onReloadSource={onReloadSource} onRetainSignatureRequest={onRetainSignatureRequest} onSignatureProgress={onSignatureProgress}/>}
      <details className="e04-prepared-review-source"><summary>Exact saved source</summary><dl><dt>Document SHA-256</dt><dd>{review.document.sha256}</dd><dt>Pages</dt><dd>{review.document.page_count}</dd><dt>Preparation reference</dt><dd>{review.request.preparation_id}</dd><dt>Review fingerprint</dt><dd>{review.review_sha256}</dd></dl><p>The fingerprint identifies this read. It is not an approval or execution receipt.</p></details>
    </>}
    <footer><FileText size={18} aria-hidden="true"/><p>{review?.ready_for_review?'Reviewing sends nothing. Signing requests require your explicit approval of the exact document and invitations.':'Approval and sending are not connected until the required fields are saved and the exact request is reviewed.'}</p></footer>
  </section>;
}
