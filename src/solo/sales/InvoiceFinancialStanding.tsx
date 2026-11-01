import {invoiceDisplayNumber,invoiceRecordAmountLabels} from './invoicePaymentCopy';
import React from 'react';
import type {InvoiceRecord} from './invoiceLifecycleApi';
const money=(n:number|null,currency:string)=>n===null?'Verification pending':new Intl.NumberFormat(undefined,{style:'currency',currency:currency.toUpperCase()}).format(n/100);
export function InvoiceFinancialStanding({record,includeDocumentFacts=true}:{record:InvoiceRecord;includeDocumentFacts?:boolean}){
 const f=record.financial;
 const [expanded,setExpanded]=React.useState(false);
 const evidenceId=React.useId();
 if(!f)return <p role="alert">Current financial evidence is unavailable. Reload this invoice.</p>;
 const known=f.standing==='recorded';
 const status=record.status==='draft'?'Draft · not issued':record.status==='void'?'Void':!known?'Balance needs verification':f.refund_payable_minor!>0?'Refund owed · inspect outstanding amount':f.outstanding_minor===0?'No outstanding amount':'Outstanding amount';
 return <section className="sb-financial-standing" aria-label="Current invoice financial standing">
 
 <h3>{status}</h3>
 {includeDocumentFacts&&<dl><dt>Invoice number</dt><dd>{invoiceDisplayNumber(record.number,record.status!=='draft')}</dd><dt>{record.status==='issued'?'Invoice total':invoiceRecordAmountLabels(record.status).total}</dt><dd>{money(record.totalMinor,record.snapshot.currency)}</dd></dl>}
 {record.status==='issued'?<><dl><dt>Current outstanding</dt><dd>{money(f.outstanding_minor,f.currency)}</dd><dt>Refund owed</dt><dd>{money(f.refund_payable_minor,f.currency)}</dd><dt>Credits recorded</dt><dd>{money(f.credit_minor,f.currency)}</dd></dl>
 {!known?<p role="status">{f.standing==='allocation_required'?'The original payment assignments need verification.':'Current payment evidence needs verification.'} No zero balance or completed payment is assumed. A genuine business-record correction remains available.</p>:f.refund_payable_minor!>0?<p>The refund owed is separate from the outstanding amount. This record does not confirm that a refund was sent.</p>:null}</>:<p>{record.status==='draft'?'This draft has no issued payment obligation.':'This invoice is void. Original payment records remain available; voiding does not refund money.'}</p>}
 <button className="btn" aria-expanded={expanded} aria-controls={evidenceId} onClick={()=>setExpanded(v=>!v)}>{expanded?'Hide payment evidence':'Inspect payment evidence'}</button>
 {expanded&&<div id={evidenceId} className="sb-financial-evidence"><dl><dt>Business-recorded receipts</dt><dd>{money(f.manual_recorded_minor,f.currency)}</dd><dt>Original provider confirmations</dt><dd>{money(f.provider_confirmed_minor,f.currency)}</dd><dt>Provider net after verified adjustments</dt><dd>{money(f.provider_net_minor,f.currency)}</dd><dt>TEST confirmations</dt><dd>{money(f.test_provider_minor,f.currency)}</dd></dl><p>Business-recorded receipts are human reports. TEST confirmations do not establish customer funds. Current debt and refunds come from the original payment records and reviewed decisions.</p></div>}
 </section>;
}
