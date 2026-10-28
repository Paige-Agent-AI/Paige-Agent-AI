import React from 'react';
import {assembleFixedRepaymentSchedule} from '../../../../supabase/functions/_shared/sales-collections/model';
import type {CollectionTerms} from '../../../../supabase/functions/_shared/sales-collections/contract';
import {collectionMoney,minorInput} from './presentation';

type Props={active:boolean;amountMinor:number|null;currency:string|null;sourceTitle:string;clientName:string|null;sourceReady:boolean;sourceNotice:string;sourceChanged:boolean;canManage:boolean;onUse(terms:CollectionTerms):void;onBack():void;onDirty():void};
const missingLabels:Record<string,string>={total_cents:'original agreement amount',currency:'original currency',deposit_cents:'deposit amount',installment_cents:'installment amount',cadence:'payment frequency',deposit_date:'agreed deposit date',first_installment_date:'first installment date'};

/** Prepare exact payment amounts with the canonical finite Collections assembler.
 * Applying edits only the current draft; original command review owns persistence. */
export function CollectionRepaymentPreparation({active,amountMinor,currency,sourceTitle,clientName,sourceReady,sourceNotice,sourceChanged,canManage,onUse,onBack,onDirty}:Props){
 const [deposit,setDeposit]=React.useState(''),[installment,setInstallment]=React.useState(''),[depositDate,setDepositDate]=React.useState(''),[firstDate,setFirstDate]=React.useState(''),[cadence,setCadence]=React.useState<''|'monthly'|'quarterly'>('');
 const heading=React.useRef<HTMLHeadingElement>(null);
 React.useEffect(()=>{if(active)heading.current?.focus()},[active,canManage,sourceReady]);
 const depositMinor=currency?minorInput(deposit,currency,true):null,installmentMinor=currency?minorInput(installment,currency):null;
 const precisionInvalid=deposit!==''&&depositMinor===null||installment!==''&&installmentMinor===null;
 const calculation=!sourceReady||precisionInvalid?null:assembleFixedRepaymentSchedule({total_cents:amountMinor??undefined,currency:currency??undefined,
  deposit_cents:depositMinor??undefined,installment_cents:installmentMinor??undefined,cadence:cadence||undefined,
  deposit_date:depositMinor!==null&&depositMinor>0?depositDate||undefined:undefined,first_installment_date:firstDate||undefined});
 const ready=calculation?.state==='ready'?calculation:null;
 const apply=()=>{if(active&&sourceReady&&canManage&&ready)onUse(structuredClone(ready.terms))};
 return <section aria-labelledby="sc-fixed-heading" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onBack()}}}>
  <div className="sc-actions sc-between"><h3 id="sc-fixed-heading" ref={heading} tabIndex={-1}>Prepare deposit and installments</h3><button type="button" onClick={onBack}>Back to collection plan</button></div>
  <p>Choose the agreed dates and exact payment amounts. Review the proposal, then use it in your collection plan.</p>
  <div className="sc-builder-grid">
   <form className="sc-panel sc-form" onChange={onDirty} onSubmit={e=>{e.preventDefault();apply()}}>
    <div className="sc-wide sc-inset" style={{overflowWrap:'anywhere'}}><small>{sourceTitle}</small><span>{clientName?.trim()||'Client name unavailable'}</span><strong>{amountMinor!==null&&currency?collectionMoney(amountMinor,currency):'Original amount unavailable'}</strong><span>{sourceReady?'Original agreement total':'Recorded amount · proposal unavailable'}</span></div>
    {sourceChanged&&sourceReady&&<p className="sc-wide" role="status">The agreement or client changed. Re-enter the proposal for the current record.</p>}
    {!sourceReady&&<p className="sc-wide" role="status">{sourceNotice}</p>}
    {!canManage&&<p className="sc-wide" role="status">Your current access allows inspection. Preparing a revised plan requires permission.</p>}
    <fieldset className="sc-form sc-wide" disabled={!canManage||!sourceReady} style={{border:0,padding:0,margin:0,minWidth:0}}>
     <label>Deposit amount<input aria-label="Deposit amount" aria-describedby="sc-fixed-money-help" inputMode="decimal" value={deposit} onChange={e=>setDeposit(e.target.value)} required/></label>
     <label>Installment amount<input aria-label="Installment amount" aria-describedby="sc-fixed-money-help" inputMode="decimal" value={installment} onChange={e=>setInstallment(e.target.value)} required/></label>
     <small className="sc-wide" id="sc-fixed-money-help">Amounts in {currency?.toUpperCase()??'the original currency'}. Enter zero if no deposit is agreed. Any smaller final installment appears in the proposal.</small>
     <label>Deposit date<input type="date" value={depositDate} onChange={e=>setDepositDate(e.target.value)} required={depositMinor!==null&&depositMinor>0} disabled={depositMinor===0}/></label>
     <label>First installment date<input type="date" value={firstDate} onChange={e=>setFirstDate(e.target.value)} required/></label>
     <label className="sc-wide">Payment frequency<select aria-label="Payment frequency" value={cadence} onChange={e=>setCadence(e.target.value as typeof cadence)} required><option value="">Choose the agreed frequency</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label>
    </fieldset>
    {precisionInvalid?<p className="sc-wide" role="alert">Check the payment amounts and currency precision. Your entries are preserved.</p>:calculation?.state==='needs_input'?<p className="sc-wide" role="status">Complete: {calculation.fields.map(field=>missingLabels[field]??'required agreement details').join(', ')}.</p>:calculation?.state==='refused'?<p className="sc-wide" role="alert">{calculation.code==='SCHEDULE_LIMIT'?'This proposal exceeds the supported number of payments. Review the installment amount.':'Check the amounts and dates. The deposit must be less than the original total, with installments starting after the deposit.'} Your entries are preserved.</p>:null}
    <div className="sc-actions sc-wide"><button type="submit" className="sc-primary" disabled={!canManage||!sourceReady||!ready}>Use proposed schedule</button></div>
    <p className="sc-wide">Next, review the complete collection plan before saving it. Back keeps your entries for this agreement.</p>
   </form>
   <aside className="sc-panel sc-preview" aria-label="Proposed payment schedule"><h3>Payment proposal</h3>
    {ready&&currency?<><dl className="sc-consequence"><dt>Original total</dt><dd>{collectionMoney(ready.terms.total_cents,currency)}</dd><dt>Deposit</dt><dd>{collectionMoney(ready.deposit_cents,currency)}</dd><dt>Remaining after deposit</dt><dd>{collectionMoney(ready.remaining_after_deposit_cents,currency)}</dd><dt>Installments</dt><dd>{ready.installment_count}</dd></dl>
     {ready.rows.slice(0,24).map(row=><div className="sc-trail" key={row.sequence}><small>{row.label} · <time dateTime={row.due_date}>{row.due_date}</time></small><strong>{collectionMoney(row.amount_cents,row.currency)}</strong></div>)}
     {ready.rows.length>24&&<p>First 24 of {ready.rows.length} payments shown. The complete proposal is carried into the collection plan for review.</p>}
     <p>These are proposed dates and amounts. Payment and signing status are separate.</p></>:<p>Enter the required amounts, dates and frequency to inspect the dated proposal.</p>}
   </aside>
  </div>
 </section>;
}
