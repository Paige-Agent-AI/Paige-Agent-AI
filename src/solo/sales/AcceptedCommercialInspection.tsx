import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {readAcceptedCommercialAgreement,type AcceptedCommercialRead} from '../../../supabase/functions/_shared/agreements/accepted-commercial-read';
import './accepted-commercial-inspection.css';

type Props={tenantId:string;invoiceId:string;agreementId:string;version:number;
 currentTermsId?:string;currentTermsVersion?:number;currentPrincipal?:number;currentCurrency?:string;currentDraftVersion?:number};
const day=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));

/** Explicit owner inspection of original retained history. No financial action,
 * inferred acceptance, file-availability claim or model-visible document copy. */
export function AcceptedCommercialInspection(props:Props){
 const {tenantId,invoiceId,agreementId,version}=props,scope=`${tenantId}:${invoiceId}:${agreementId}:${version}`;
 const sequence=React.useRef(0),trigger=React.useRef<HTMLButtonElement>(null),heading=React.useRef<HTMLHeadingElement>(null),restoreFocus=React.useRef(false);
 const [request,setRequest]=React.useState<{scope:string;sequence:number}|null>(null);
 const [result,setResult]=React.useState<{scope:string;sequence:number;value:AcceptedCommercialRead}|null>(null);
 const active=request?.scope===scope?request:null;
 const read=active&&result?.scope===scope&&result.sequence===active.sequence?result.value:null;
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
  </>}
 </section>;
}
