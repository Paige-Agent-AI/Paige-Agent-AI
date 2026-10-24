import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {readAcceptedCommercialAgreement,type AcceptedCommercialRead} from '../../../supabase/functions/_shared/agreements/accepted-commercial-read';
import {hasCommercialEffectuationReceipt,parseCommercialEffectuationCommand,type CommercialEffectuationCommand} from '../../../supabase/functions/_shared/sales-commercial/effectuation-command';
import {CollectionCommandReview} from './collections/CollectionCommandReview';
import './accepted-commercial-inspection.css';

type Props={tenantId:string;invoiceId:string;agreementId:string;version:number;
 currentTermsId?:string;currentTermsVersion?:number;currentPrincipal?:number;currentCurrency?:string;currentDraftVersion?:number;onRefreshCurrent?():void};
const day=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));

/** Owner inspection of retained history and explicit native commercial review.
 * No inferred acceptance, file-availability, payment or service claim. */
export function AcceptedCommercialInspection(props:Props){
 const {tenantId,invoiceId,agreementId,version}=props,scope=`${tenantId}:${invoiceId}:${agreementId}:${version}`;
 const sequence=React.useRef(0),trigger=React.useRef<HTMLButtonElement>(null),heading=React.useRef<HTMLHeadingElement>(null),restoreFocus=React.useRef(false);
 const [request,setRequest]=React.useState<{scope:string;sequence:number}|null>(null);
 const [result,setResult]=React.useState<{scope:string;sequence:number;value:AcceptedCommercialRead}|null>(null);
 const [review,setReview]=React.useState<{key:string;command:CommercialEffectuationCommand}|null>(null);
 const [decision,setDecision]=React.useState<{key:string;receiptId?:string;operationId?:string}|null>(null);
 const effectTrigger=React.useRef<HTMLButtonElement>(null),decisionHeading=React.useRef<HTMLDivElement>(null),restoreEffectFocus=React.useRef(false),mounted=React.useRef(true);
 React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const active=request?.scope===scope?request:null;
 const read=active&&result?.scope===scope&&result.sequence===active.sequence?result.value:null;
 const readKey=`${scope}:${active?.sequence??0}`,latest=React.useRef(readKey);latest.current=readKey;
 const activeReview=review?.key===readKey&&read?.state==='recorded'?review:null,activeDecision=decision?.key===readKey?decision:null;
 React.useLayoutEffect(()=>{if(!activeReview&&restoreEffectFocus.current){restoreEffectFocus.current=false;effectTrigger.current?.focus()}},[activeReview]);
 React.useEffect(()=>{if(activeDecision)decisionHeading.current?.focus()},[activeDecision]);
 React.useEffect(()=>{
  if(!active)return;let current=true;
  void readAcceptedCommercialAgreement(tenantId,{invoice_id:invoiceId,agreement_id:agreementId},supabase)
   .then(value=>{if(current)setResult({...active,value});})
   .catch(()=>{if(current)setResult({...active,value:{state:'refused'}});});
  return()=>{current=false;};
 },[active,tenantId,invoiceId,agreementId]);
 React.useEffect(()=>{if(read)heading.current?.focus();},[read]);
 const inspect=()=>setRequest({scope,sequence:++sequence.current});
 const close=()=>{restoreFocus.current=true;setRequest(null);setResult(null);};
 React.useLayoutEffect(()=>{if(!active&&restoreFocus.current){restoreFocus.current=false;trigger.current?.focus();}},[active]);
 const payload=read?.state==='recorded'?read.presentation.payload:null,source=payload?.source;
 const effectiveCommand=React.useMemo(()=>{
  if(read?.state!=='recorded'||read.presentation.payload.schema_version!==2)return null;
  const accepted=read.presentation.payload.source;
  try{return parseCommercialEffectuationCommand({action:'collection.effectuate_terms',agreement_id:accepted.terms_id,expected_version:accepted.terms_version,
   expected_updated_at:accepted.terms_updated_at,signing_id:accepted.agreement_id,signing_version:accepted.agreement_version,
   invoice_id:accepted.invoice_id,invoice_draft_version:accepted.invoice_draft_version,payload_digest:read.presentation.payload_digest,sealed_sha256:read.sealed_sha256});}
  catch{return null;}
 },[read]);
 const termsDiffer=source&&((props.currentTermsId!==undefined&&props.currentTermsId!==source.terms_id)
  ||(props.currentTermsVersion!==undefined&&props.currentTermsVersion!==source.terms_version)
  ||(props.currentPrincipal!==undefined&&props.currentPrincipal!==payload?.principal_minor)
  ||(props.currentCurrency!==undefined&&props.currentCurrency.toLowerCase()!==payload?.currency));
 const invoiceDiffers=source&&props.currentDraftVersion!==undefined&&props.currentDraftVersion!==source.invoice_draft_version;
 const money=(minor:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:payload?.currency.toUpperCase()??'USD'}).format(minor/100);
 return <section className="accepted-commercial" aria-label="Accepted agreement inspection">
  <header><h4 ref={heading} tabIndex={-1}>Accepted agreement</h4>{active&&<button type="button" className="btn" onClick={close}>{read?'Close record':'Cancel reading'}</button>}</header>
  <button ref={trigger} type="button" className="btn" disabled={Boolean(active&&!read)} onClick={inspect}>
   {active&&!read?'Reading accepted terms…':active?'Read again':'Inspect accepted terms'}
  </button>
  {active&&!read&&<p role="status">Reading the original accepted agreement…</p>}
  {read?.state==='refused'&&<p role="alert">This agreement could not be read in this workspace. Check access and try again.</p>}
  {read?.state==='unverified'&&<p role="status">The original accepted terms could not be verified. Current payment terms cannot establish what was signed. Review the original agreement and signing history.</p>}
  {read?.state==='recorded'&&payload&&source&&<>
   <h5 dir="auto">{payload.title}</h5>
   <p>Completion recorded {new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(read.completed_at))}. Current file availability has not been checked.</p>
   <dl><dt>Accepted principal</dt><dd>{money(payload.principal_minor)}</dd>
    <dt>Original agreement version</dt><dd>{source.agreement_version}</dd>
    <dt>Accepted payment terms version</dt><dd>{source.terms_version}</dd>
    <dt>Source invoice draft version</dt><dd>{source.invoice_draft_version}</dd>
    {payload.schema_version===2&&<><dt>Agreed service start</dt><dd>{day(payload.engagement.starts_on)}</dd>
     {payload.engagement.ends_on&&<><dt>Agreed service end</dt><dd>{day(payload.engagement.ends_on)}</dd></>}</>}
   </dl>
   {termsDiffer&&<p role="status">Current payment terms differ from this accepted record. Review both before taking an action.</p>}
   {invoiceDiffers&&<p role="status">The current invoice draft changed after this agreement was prepared. Review its accepted terms before taking an action.</p>}
   <details><summary>Read dated obligations ({payload.obligations.length})</summary><ol>{payload.obligations.map((row,index)=><li key={index}><time dateTime={row.due_date}>{day(row.due_date)}</time><span>{money(row.amount_cents)}</span></li>)}</ol></details>
   <details><summary>Read retained wording</summary><pre dir="auto">{read.presented_body_markdown}</pre></details>
   <p>These records do not activate terms, confirm payment or establish completed services.</p>
   {effectiveCommand?<div className="accepted-effectuation">
    <div><h5>Make accepted terms effective</h5><p>Review the exact signed commercial version. PAIGE checks the original records before requesting approval.</p></div>
    <button ref={effectTrigger} type="button" className="btn" onClick={()=>{setDecision(null);setReview({key:readKey,command:effectiveCommand})}}>Review effective terms</button>
    {activeDecision&&<div ref={decisionHeading} tabIndex={-1} role="status" className="accepted-effect-receipt">
     <strong>{activeDecision.receiptId?'Accepted-version operation recorded':'Original pending operation recovered'}</strong>
     <p>{activeDecision.receiptId?'The historical receipt records the accepted version as effective at execution. Current status must be read separately.':'This agreement action has not started. Review it separately when the recovered operation is resolved.'} No payment or completed service is confirmed.</p>
     {activeDecision.receiptId&&<dl><dt>Original operation</dt><dd>{activeDecision.operationId}</dd><dt>Audit receipt</dt><dd>{activeDecision.receiptId}</dd></dl>}
     {props.onRefreshCurrent&&<button type="button" className="btn" onClick={props.onRefreshCurrent}>Refresh current commercial record</button>}
    </div>}
   </div>:<p role="status">Exact service dates and pricing must be retained in the accepted version before effective terms can be reviewed.</p>}
  </>}
  {activeReview&&<CollectionCommandReview key={activeReview.key} tenantId={tenantId} command={activeReview.command}
   onClose={()=>{restoreEffectFocus.current=true;setReview(null)}} onComplete={(value,executed)=>{
    if(!mounted.current||latest.current!==activeReview.key)return;
    const verified=executed.action==='collection.effectuate_terms'&&JSON.stringify(executed)===JSON.stringify(activeReview.command)&&hasCommercialEffectuationReceipt(value,tenantId,activeReview.command);
    if(JSON.stringify(executed)===JSON.stringify(activeReview.command)&&!verified)return;
    if(verified){const operation=value.operation as Record<string,unknown>;setDecision({key:readKey,receiptId:value.receipt_id as string,operationId:operation.id as string});}
    else setDecision({key:readKey});
    setReview(null);
   }}/>}</section>;
}
