import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {readAcceptedInvoicePaymentPlan,type AcceptedPaymentPlanRead} from '../../../supabase/functions/_shared/sales-payments/accepted-obligation-read';
import type {PaymentRequestIntent} from '../../../supabase/functions/_shared/sales-payments/request-command';
import type {InvoiceRecord} from './invoiceLifecycleApi';
import {formatPaymentMinor} from './customerPaymentRequest';
import {parseMinorAmount} from './billingAmounts';
import {parseManualPaymentAllocations,type ManualPaymentAllocation} from '../../../supabase/functions/_shared/sales-invoice-command/manual-allocation';
import './invoice-accepted-payment-plan.css';

type Props={tenantId:string;invoice:InvoiceRecord;canManage:boolean;paymentStatusRead:boolean;paymentRequestActive:boolean;accountEpoch?:string|null;onReview(command:PaymentRequestIntent):void;
 manual?:{amountMinor:number;values:Readonly<Record<number,string>>;onChange(sequence:number,value:string):void;onAssignmentsChange(value:ManualPaymentAllocation[]|null):void}};
type Scope={key:string};
type ReadRequest={scope:Scope};
const heldCopy:Record<Extract<AcceptedPaymentPlanRead,{state:'held'}>['reason'],string>={
 invoice_not_issued:'This invoice is not currently issued. Review its original invoice status before requesting a scheduled payment.',
 accepted_source_unavailable:'The original accepted commercial evidence is unavailable. Inspect the agreement and its effective terms.',
 commercial_terms_inactive:'The commercial terms are inactive. Review the original agreement and current terms before proceeding.',
 accepted_source_changed:'The invoice and accepted agreement no longer match. Review both versions without rewriting signed history.',
 test_payment_evidence:'TEST payment evidence cannot fulfill this customer’s actual commercial obligations. Inspect the original payment records.',
 allocation_conflict:'The original payment allocations conflict with this accepted schedule. Review the original receipts before proceeding.',
 allocation_required:'A recorded payment has not been assigned to an accepted obligation. Review its original receipt; PAIGE will not guess the allocation.',
};
const day=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));

/** Read-only accepted source and local selection; the existing invoice review owns
 * approval, operations and recovery. Original native records remain authority. */
export function InvoiceAcceptedPaymentPlan({tenantId,invoice,canManage,paymentStatusRead,paymentRequestActive,accountEpoch=null,onReview,manual}:Props){
 const [actor,setActor]=React.useState<{id:string|null;resolved:boolean;epoch:number}>({id:null,resolved:false,epoch:0});
 React.useEffect(()=>{
  let current=true,epoch=0;const opened=epoch;
  void supabase.auth.getSession().then(({data})=>{if(current&&epoch===opened)setActor({id:data.session?.user.id??null,resolved:true,epoch})}).catch(()=>{if(current&&epoch===opened)setActor({id:null,resolved:true,epoch})});
  const {data}=supabase.auth.onAuthStateChange((_event,session)=>{epoch++;if(current)setActor({id:session?.user.id??null,resolved:true,epoch})});
  return()=>{current=false;data.subscription.unsubscribe()};
 },[]);
 const agreementId=invoice.snapshot.agreement_id,issuedVersion=invoice.issuedSnapshotVersion;
 const key=[tenantId,invoice.id,invoice.version,issuedVersion,invoice.snapshot.client_id,agreementId,invoice.snapshot.currency,canManage,actor.id,actor.resolved,actor.epoch,accountEpoch].join(':');
 const identity=React.useRef<Scope>({key});if(identity.current.key!==key)identity.current={key};
 const scope=identity.current;
 const [request,setRequest]=React.useState<ReadRequest|null>(null),[view,setView]=React.useState<{request:ReadRequest;value:AcceptedPaymentPlanRead}|null>(null);
 const [selection,setSelection]=React.useState<{request:ReadRequest;sequence:number}|null>(null);
 const latestRequest=React.useRef<ReadRequest|null>(null),trigger=React.useRef<HTMLButtonElement>(null),heading=React.useRef<HTMLHeadingElement>(null),returnFocus=React.useRef(false);
 const active=request?.scope===scope?request:null,read=active&&view?.request===active?view.value:null,loading=Boolean(active&&!read);
 const eligible=canManage&&actor.resolved&&Boolean(actor.id)&&invoice.status==='issued'&&Boolean(agreementId)&&issuedVersion!==null;
 React.useEffect(()=>{
  if(!active||!eligible||!agreementId||issuedVersion===null)return;let current=true;const opened=scope;
  void readAcceptedInvoicePaymentPlan(tenantId,{invoice_id:invoice.id,agreement_id:agreementId,client_id:invoice.snapshot.client_id,invoice_version:invoice.version,
   // readInvoiceRecord validates that issued snapshot and original draft match.
   invoice_draft_version:issuedVersion,issued_snapshot_version:issuedVersion,currency:invoice.snapshot.currency},supabase)
   .then(value=>{if(current&&identity.current===opened&&latestRequest.current===active)setView({request:active,value})})
   .catch(()=>{if(current&&identity.current===opened&&latestRequest.current===active)setView({request:active,value:{state:'refused'}})});
  return()=>{current=false};
 },[active,scope,eligible,agreementId,issuedVersion,tenantId,invoice.id,invoice.snapshot.client_id,invoice.version,invoice.snapshot.currency]);
 React.useLayoutEffect(()=>{if(read)heading.current?.focus()},[read]);
 React.useLayoutEffect(()=>{if(!active&&returnFocus.current){returnFocus.current=false;trigger.current?.focus()}},[active]);
 const inspect=()=>{if(!eligible)return;const next={scope:identity.current};latestRequest.current=next;setSelection(null);setRequest(next)};
 const close=()=>{latestRequest.current=null;setRequest(null);setView(null);setSelection(null);returnFocus.current=true};
 const available=eligible&&read?.state==='available'?read:null;
 const selected=available&&selection?.request===active?available.obligations.find(row=>row.reference.sequence===selection.sequence):null;
 const canRequest=Boolean(eligible&&paymentStatusRead&&!paymentRequestActive);
 const manualValues=manual?.values,receiptMinor=manual?.amountMinor;
 const assignments=React.useMemo(()=>{
  if(!manualValues||!available||!canRequest||receiptMinor===undefined)return null;
  try{
   // Form transport only. The SAME native writer independently rechecks these
   // original accepted facts under its invoice lock before recording a receipt.
   const rows=available.obligations.filter(row=>Boolean(manualValues[row.reference.sequence]?.trim())).map(obligation=>({obligation,amount_cents:parseMinorAmount(manualValues[obligation.reference.sequence],2)}));
   if(Object.entries(manualValues).some(([sequence,value])=>value.trim()&&!available.obligations.some(row=>row.reference.sequence===Number(sequence))))return null;
   return parseManualPaymentAllocations(rows,receiptMinor);
  }catch{return null;}
 },[manualValues,available,canRequest,receiptMinor]);
 const notifyAssignments=manual?.onAssignmentsChange;
 React.useLayoutEffect(()=>{notifyAssignments?.(assignments);},[assignments,notifyAssignments]);
 const review=()=>{
  if(!canRequest||!selected||selected.remaining_minor<=0||!active||identity.current!==active.scope)return;
  onReview({action:'invoice.payment_request',invoice_id:invoice.id,expected_version:invoice.version,provider:'stripe',
   purpose:selected.reference.sequence===1&&invoice.snapshot.kind==='deposit'?'deposit':'installment',obligation_reference:{...selected.reference}});
 };
 return <section className="sb-accepted-plan" aria-label={manual?"Received-payment assignments":"Accepted payment plan"} aria-busy={loading}>
  <header><div><h4 ref={heading} tabIndex={-1}>{manual?"Assign received payment":"Accepted payment plan"}</h4></div>
   {eligible&&<div className="sb-accepted-plan-actions"><button type="button" ref={trigger} className="btn" disabled={loading} onClick={inspect}>{manual?(active?'Refresh plan for receipt':'Read accepted plan for receipt'):(active?'Refresh payment plan':'Read accepted payment plan')}</button>{active&&<button type="button" className="btn" onClick={close}>{loading?'Cancel reading':'Close plan'}</button>}</div>}
  </header>
  {!actor.resolved?<p role="status">Checking your account before reading accepted terms…</p>:!actor.id?<p role="alert">Sign in to inspect this invoice’s accepted payment plan.</p>:!canManage?<p>An authorized owner or financial administrator can inspect the accepted payment plan.</p>:invoice.status!=='issued'?<p>Inspect accepted payment obligations after this invoice is issued.</p>:!agreementId||issuedVersion===null?<p>This invoice has no retained agreement reference. Inspect its commercial record before preparing a scheduled payment.</p>:!active?<p>{manual?'Read the accepted schedule and original allocations before assigning this received payment.':'Inspect the exact accepted schedule and original allocations before preparing a payment request.'}</p>:null}
  {loading&&<p role="status">Reading the accepted agreement and original payment allocations…</p>}
  {eligible&&read?.state==='refused'&&<p role="alert">The accepted payment plan could not be read here. Check agreement completion and workspace access, then refresh the plan. No invoice or payment has changed.</p>}
  {eligible&&read?.state==='unverified'&&<p role="status">The original accepted terms could not be verified. Current payment terms cannot establish the signed schedule. Inspect the original agreement and signing history.</p>}
  {eligible&&read?.state==='stale'&&<p role="status">The invoice changed while this plan was read. Reload the invoice before reviewing a scheduled payment.</p>}
  {eligible&&read?.state==='held'&&<div className="sb-accepted-plan-hold" role="status"><strong>Payment plan needs review</strong><p>{heldCopy[read.reason]}</p><p>Scheduled payment requests are unavailable until the original source is reconciled.</p></div>}
  {available&&<>
   <div className="sb-accepted-plan-source"><strong>{formatPaymentMinor(available.accepted.presentation.payload.principal_minor,available.currency)} accepted principal</strong><p dir="auto">{available.accepted.presentation.payload.title}</p><small>Accepted terms version {available.accepted.presentation.payload.source.terms_version} · Agreement version {available.accepted.presentation.payload.source.agreement_version}. These dated obligations belong to one original invoice.</small></div>
   {!canRequest&&<p className="sb-accepted-plan-hold" role="status">{manual?'Resolve the current payment-request status before recording a receipt.':'Resolve the current payment-request status above before starting another request.'} This accepted plan can still be inspected.</p>}
   {manual&&<p id="invoice-manual-assignment-help">Enter only the amounts this receipt covers. Leave other payments blank. Assignments must total the received amount; PAIGE will not choose payments for you.</p>}
   <ol className="sb-accepted-plan-rows">{available.obligations.map(row=>{const chosen=!manual&&selected===row;return <li key={row.reference.sequence} data-selected={chosen}>
    <div><strong>Payment {row.reference.sequence}</strong><time dateTime={row.due_date}>{day(row.due_date)}</time></div>
    <div className="sb-accepted-plan-money"><small>Scheduled</small>{formatPaymentMinor(row.scheduled_minor,available.currency)}</div>
    <div className="sb-accepted-plan-money"><small>Remaining</small>{formatPaymentMinor(row.remaining_minor,available.currency)}</div>
    {row.remaining_minor===0?<span>Allocated</span>:manual?<label className="sb-manual-assignment-input">Assign to payment {row.reference.sequence} (USD)<input inputMode="decimal" maxLength={16} aria-describedby="invoice-manual-assignment-help" disabled={!canRequest} value={manual.values[row.reference.sequence]??''} onChange={event=>manual.onChange(row.reference.sequence,event.target.value)}/></label>:<button type="button" className="btn" disabled={!canRequest} aria-pressed={chosen} onClick={()=>{if(canRequest&&active)setSelection({request:active,sequence:row.reference.sequence})}}>{chosen?`Payment ${row.reference.sequence} selected`:`Select payment ${row.reference.sequence}`}</button>}
    {chosen&&<div className="sb-accepted-plan-selection" aria-label="Selected accepted payment"><strong>{formatPaymentMinor(row.remaining_minor,available.currency)} · due {day(row.due_date)}</strong><p>Review payment {row.reference.sequence} from accepted terms version {row.reference.terms_version}. The server rechecks the original agreement, invoice and remaining amount before approval.</p><div className="sb-accepted-plan-actions"><button className="btn btn-p" disabled={!canRequest} onClick={review}>Review selected payment request</button><button className="btn" onClick={event=>{const source=event.currentTarget.closest('li')?.querySelector<HTMLButtonElement>('button[aria-pressed]');setSelection(null);if(source&&!source.disabled)source.focus();else trigger.current?.focus()}}>Clear selection</button></div></div>}
   </li>})}</ol>
   {manual&&<><p role="status">{assignments?'All received money is assigned. Review the exact payments before recording.':'Enter positive amounts within each remaining payment that total the received amount.'}</p><button type="button" className="btn" disabled={!canRequest} onClick={()=>{for(const sequence of Object.keys(manual.values))manual.onChange(Number(sequence),'')}}>Clear receipt assignments</button></>}
   <details><summary>Inspect the accepted source</summary><dl><dt>Agreement version</dt><dd>{available.accepted.presentation.payload.source.agreement_version}</dd><dt>Accepted terms version</dt><dd>{available.accepted.presentation.payload.source.terms_version}</dd><dt>Original invoice draft version</dt><dd>{available.accepted.presentation.payload.source.invoice_draft_version}</dd><dt>Completion recorded</dt><dd>{new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(available.accepted.completed_at))}</dd></dl><p>Current signed-file availability has not been checked.</p></details>
   <details><summary>Read the accepted agreement wording</summary><pre dir="auto">{available.accepted.presented_body_markdown}</pre></details>
   <p>{manual?'These are business-recorded receipt assignments, not provider settlement or completed services. The original accepted source and exact amounts are rechecked before approval and recording.':'Allocated amounts do not establish completed services. Creating a payment request does not record money received. Your business’s Stripe connection and the exact amount are checked before approval.'}</p>
  </>}
 </section>;
}
