import {readInvoiceFinancialSummary,type InvoiceFinancialSummary} from '../../../supabase/functions/_shared/sales-payments/balance-projection';
import { formatExactMinor } from '../../../supabase/functions/_shared/client-engagement/money';
export type CustomerPaymentRequest={amountMinor:number;currency:string;state:string;url:string|null;remainingMinor:number;expiresAt:number|null};
const states=['prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown','settled','failed','expired','cancelled'];
/** Read-only presentation of the server's existing invoice/bearer projection. */
export function readCustomerPaymentRequest(value:unknown,now=Date.now()):CustomerPaymentRequest|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const root=value as Record<string,unknown>, request=root.payment_request;
 if(!Number.isSafeInteger(root.remaining_cents)||Number(root.remaining_cents)<0||!request||typeof request!=='object'||Array.isArray(request))return null;
 const row=request as Record<string,unknown>;
 if(!Number.isSafeInteger(row.amount_minor)||Number(row.amount_minor)<=0||typeof row.currency!=='string'||!/^[a-z]{3}$/.test(row.currency)||typeof row.state!=='string'||!states.includes(row.state))return null;
 let url:string|null=null;
 if(row.state==='customer_action_required'&&Number(root.remaining_cents)>=Number(row.amount_minor)&&typeof row.expires_at==='string'&&Date.parse(row.expires_at)>now&&typeof row.provider_url==='string'){
  try{const candidate=new URL(row.provider_url);if(candidate.protocol==='https:'&&candidate.hostname==='checkout.stripe.com'&&!candidate.username&&!candidate.password&&!candidate.port)url=candidate.href;}catch{/* unavailable hosted surface */}
 }
 return {amountMinor:Number(row.amount_minor),currency:row.currency,state:row.state,url,remainingMinor:Number(root.remaining_cents),expiresAt:typeof row.expires_at==='string'&&Number.isFinite(Date.parse(row.expires_at))?Date.parse(row.expires_at):null};
}
export function customerPaymentRequestCopy(state:string):string{
 switch(state){
 case 'customer_action_required':return 'Payment requested';
 case 'prepared':return 'Payment request is being prepared';
 case 'dispatching':return 'Payment request is being created';
 case 'provider_accepted':return 'The provider accepted the request. Payment has not been confirmed yet';
 case 'outcome_unknown':return "We couldn't confirm the payment yet. The business is checking with the payment provider.";
 case 'settled':return 'Payment confirmed';
 case 'failed':return 'Payment could not be completed';
 case 'expired':return 'This payment request has expired';
 case 'cancelled':return 'This payment request was cancelled';
 default:return 'Payment status unavailable';
 }
}

export function formatPaymentMinor(amount:number|string,currency:string,locale?:string|string[]):string{
 return formatExactMinor(amount,currency,{locale})??'Amount unavailable';
}


export type CustomerInvoiceFinancialStatus=Readonly<{summary:InvoiceFinancialSummary;request:CustomerPaymentRequest|null;environment:'test'|'live'|null}>;
/** Current read-only bearer DTO. Authority and balance allocation stay in the original native reader. */
export function readCustomerInvoiceFinancialStatus(value:unknown,now=Date.now()):CustomerInvoiceFinancialStatus|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const root=value as Record<string,unknown>,keys=['invoice_number','invoice_id','invoice_version','currency','remaining_cents','payment_request','payment_evidence_version','financial_evidence_version','financial_summary'];
 if(Object.keys(root).length!==keys.length||Object.keys(root).some(k=>!keys.includes(k))
  ||root.financial_evidence_version!==3||root.payment_evidence_version!==2
  ||typeof root.invoice_number!=='string'||typeof root.invoice_id!=='string'||!root.invoice_id
  ||!Number.isSafeInteger(root.invoice_version)||Number(root.invoice_version)<1||typeof root.currency!=='string'||!/^[a-z]{3}$/.test(root.currency))return null;
 const summary=readInvoiceFinancialSummary(root.financial_summary,{id:root.invoice_id,version:Number(root.invoice_version),currency:root.currency,status:'issued'});
 if(!summary||root.remaining_cents!==summary.outstanding_minor)return null;
 if(root.payment_request===null)return {summary,request:null,environment:null};
 if(summary.standing!=='recorded'||!summary.outstanding_minor||!root.payment_request||typeof root.payment_request!=='object'||Array.isArray(root.payment_request))return null;
 const row=root.payment_request as Record<string,unknown>;
 const requestKeys=['amount_minor','currency','state','provider_url','expires_at','environment'];
 if(Object.keys(row).length!==requestKeys.length||Object.keys(row).some(k=>!requestKeys.includes(k))
  ||(row.environment!=='test'&&row.environment!=='live')||row.currency!==summary.currency)return null;
 const request=readCustomerPaymentRequest(root,now);
 return request?{summary,request,environment:row.environment}:null;
}


export type CustomerDocumentFinancialContext=Readonly<{invoice_id:string;invoice_version:number;source_hash:string|null;standing:InvoiceFinancialSummary['standing']}>;
/** Observation metadata only; never a bearer, role, permission or executable instruction. */
export function readCustomerDocumentFinancialContext(value:string|null):CustomerDocumentFinancialContext|null{
 try{
  const r=JSON.parse(value??'null'),keys=['invoice_id','invoice_version','source_hash','standing'];
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))
   ||typeof r.invoice_id!=='string'||!r.invoice_id||!Number.isSafeInteger(r.invoice_version)||r.invoice_version<1
   ||!['recorded','needs_review','allocation_required','unavailable'].includes(r.standing)
   ||(r.source_hash!==null&&(typeof r.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(r.source_hash)))
   ||r.standing==='recorded'&&r.source_hash===null)return null;
  return r;
 }catch{return null;}
}
export function matchesCustomerDocumentFinancialContext(summary:InvoiceFinancialSummary,context:CustomerDocumentFinancialContext):boolean{
 return summary.invoice_id===context.invoice_id&&summary.invoice_version===context.invoice_version
  &&summary.source_hash===context.source_hash&&summary.standing===context.standing;
}
