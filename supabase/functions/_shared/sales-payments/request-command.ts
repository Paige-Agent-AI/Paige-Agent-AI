import {merchantReadiness,type MerchantBinding,type MerchantObservation,type SalesPaymentProvider} from './merchant.ts';
import {validatePaymentRequest,type InvoicePaymentContext,type PaymentRequest} from './payment-contract.ts';
import {parsePaymentObligationReference,parsePaymentObligationEvidence,parsePaymentObligationContext,
 type PaymentObligationReference,type PaymentObligationEvidence} from './accepted-obligation.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export interface PaymentRequestIntent {
 action:'invoice.payment_request';invoice_id:string;expected_version:number;provider:SalesPaymentProvider;
 purpose:PaymentRequest['purpose'];amount_minor?:number;obligation_reference?:PaymentObligationReference;
}
export interface PaymentRequestCommand extends Omit<PaymentRequestIntent,'amount_minor'|'obligation_reference'> {
 issued_snapshot_version:number;client_id:string;amount_minor:number;currency:string;
 merchant_account_id:string;merchant_binding_version:number;environment:MerchantBinding['environment'];
 obligation?:PaymentObligationEvidence;
}
const invalid=():never=>{throw new TypeError('PAYMENT_REQUEST_INVALID');};
/** Internal parsing of a server-issued exact approval/operation command. This shape is never
 * accepted as caller intent: merchant/customer/currency must first be resolved by the server. */
export function parseCanonicalPaymentRequestCommand(v:unknown):PaymentRequestCommand {
 if(!object(v))return invalid();
 const keys=['action','invoice_id','expected_version','provider','purpose','issued_snapshot_version','client_id','amount_minor','currency','merchant_account_id','merchant_binding_version','environment'];
 const obligation=Object.prototype.hasOwnProperty.call(v,'obligation')?parsePaymentObligationEvidence(v.obligation):undefined;
 if(obligation)keys.push('obligation');
 if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))return invalid();
 const intent=parsePaymentRequestIntent({action:v.action,invoice_id:v.invoice_id,expected_version:v.expected_version,provider:v.provider,purpose:v.purpose,
  ...(obligation?{obligation_reference:obligation.reference}:v.purpose==='full'?{}:{amount_minor:v.amount_minor})});
 if(typeof v.client_id!=='string'||!UUID.test(v.client_id)||!Number.isSafeInteger(v.amount_minor)||Number(v.amount_minor)<1||Number(v.amount_minor)>2147483647||
  typeof v.currency!=='string'||!/^[a-z]{3}$/.test(v.currency)||typeof v.merchant_account_id!=='string'||!v.merchant_account_id||v.merchant_account_id.length>200||
  !Number.isSafeInteger(v.merchant_binding_version)||Number(v.merchant_binding_version)<1||!Number.isSafeInteger(v.issued_snapshot_version)||Number(v.issued_snapshot_version)<1||
  !['test','live'].includes(String(v.environment)))return invalid();
 if(obligation&&v.amount_minor!==obligation.remaining_minor)return invalid();
 return {action:intent.action,invoice_id:intent.invoice_id,expected_version:intent.expected_version,provider:intent.provider,purpose:intent.purpose,
  issued_snapshot_version:Number(v.issued_snapshot_version),client_id:v.client_id.toLowerCase(),amount_minor:Number(v.amount_minor),currency:v.currency,
  merchant_account_id:v.merchant_account_id,merchant_binding_version:Number(v.merchant_binding_version),environment:v.environment as MerchantBinding['environment'],
  ...(obligation?{obligation}:{})};
}
export function parsePaymentRequestIntent(v:unknown):PaymentRequestIntent {
 if(!object(v)||v.action!=='invoice.payment_request'||typeof v.invoice_id!=='string'||!UUID.test(v.invoice_id)||
  !Number.isSafeInteger(v.expected_version)||(v.expected_version as number)<1||!['stripe','paypal'].includes(String(v.provider))||
  !['full','partial','deposit','installment'].includes(String(v.purpose)))return invalid();
 const keys=['action','invoice_id','expected_version','provider','purpose'];
 const bound=Object.prototype.hasOwnProperty.call(v,'obligation_reference');
 let reference:PaymentObligationReference|undefined;
 if(bound){
  if(v.purpose!=='installment')return invalid();
  keys.push('obligation_reference');reference=parsePaymentObligationReference(v.obligation_reference);
 }else if(v.purpose!=='full'){
  keys.push('amount_minor');
  if(!Number.isSafeInteger(v.amount_minor)||(v.amount_minor as number)<=0||(v.amount_minor as number)>2147483647)return invalid();
 }
 if(Object.keys(v).some(key=>!keys.includes(key)))return invalid();
 return {action:'invoice.payment_request',invoice_id:v.invoice_id.toLowerCase(),expected_version:v.expected_version as number,
  provider:v.provider as SalesPaymentProvider,purpose:v.purpose as PaymentRequest['purpose'],
  ...(reference?{obligation_reference:reference}:v.purpose!=='full'?{amount_minor:v.amount_minor as number}:{})};
}
/** Pure canonical assembly only. Inputs are server-resolved invoice/readiness facts, NOT authority.
 * The command is subsequently fingerprinted by the shared gate and revalidated under SQL locks.
 * A partial/deposit amount is owner intent validated against the canonical outstanding balance;
 * this cannot establish installment eligibility or a recurring mandate by itself. */
export function buildPaymentRequestCommand(value:unknown,invoice:InvoicePaymentContext,merchant:MerchantBinding,facts:MerchantObservation|null,now:number,obligationSource?:unknown):PaymentRequestCommand {
 const intent=parsePaymentRequestIntent(value);
 let obligation:PaymentObligationEvidence|undefined;
 if(intent.obligation_reference){
  if(obligationSource===undefined||obligationSource===null)throw new TypeError('PAYMENT_OBLIGATION_REQUIRED');
  const source=parsePaymentObligationContext(obligationSource);
  if(source.tenant_id!==invoice.tenant_id||source.client_id!==invoice.client_id||source.invoice_id!==invoice.id||source.invoice_id!==intent.invoice_id
   ||source.invoice_version!==invoice.lifecycle_version||source.invoice_version!==intent.expected_version
   ||source.issued_snapshot_version!==invoice.issued_snapshot_version
   ||JSON.stringify(source.obligation.reference)!==JSON.stringify(intent.obligation_reference))throw new TypeError('PAYMENT_OBLIGATION_CHANGED');
  if(source.obligation.remaining_minor===0)throw new TypeError('PAYMENT_OBLIGATION_ALREADY_ALLOCATED');
  obligation=source.obligation;
 }else if(obligationSource!==undefined)throw new TypeError('PAYMENT_OBLIGATION_UNEXPECTED');
 if(merchant.tenant_id!==invoice.tenant_id)throw new TypeError('MERCHANT_TENANT_MISMATCH');
 if(merchant.provider!==intent.provider)throw new TypeError('MERCHANT_PROVIDER_MISMATCH');
 const readiness=merchantReadiness(merchant,facts,now);if(!readiness.eligible)throw new TypeError(readiness.reason);
 if(!UUID.test(invoice.client_id)||!UUID.test(invoice.tenant_id))throw new TypeError('INVOICE_SCOPE_MISMATCH');
 const request:PaymentRequest={id:'canonical-preview',tenant_id:invoice.tenant_id,invoice_id:intent.invoice_id,
  invoice_version:intent.expected_version,issued_snapshot_version:invoice.issued_snapshot_version,client_id:invoice.client_id,
  commercial_package_id:null,amount_minor:obligation?.remaining_minor??(intent.purpose==='full'?invoice.outstanding_minor:intent.amount_minor!),
  currency:invoice.currency,purpose:intent.purpose,idempotency_key:'canonical-preview'};
 const refusal=validatePaymentRequest(request,invoice);if(refusal)throw new TypeError(refusal);
 return {action:intent.action,invoice_id:intent.invoice_id,expected_version:intent.expected_version,provider:intent.provider,purpose:intent.purpose,
  issued_snapshot_version:request.issued_snapshot_version,client_id:request.client_id,amount_minor:request.amount_minor,currency:request.currency,
  merchant_account_id:merchant.merchant_id,merchant_binding_version:merchant.version,environment:merchant.environment,
  ...(obligation?{obligation}:{})};
}
