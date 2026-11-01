import {UUID,type SalesInvoiceCommand} from './contract.ts';
export type ProviderDispositionReview=Readonly<{
 review_version:2;financial_evidence_version:3;effect:'internal_financial_disposition_only';
 invoice_id:string;invoice_version:number;client_id:string;client_name:string;currency:'usd';
 provider_operation_id:string;observation_id:string;observation_version:number;disposition_version:number;
 decision:'balance_due'|'credit_returned_principal';captured_minor:number;retained_minor:number;returned_minor:number;
 credit_before_minor:number;credit_after_minor:number;standing_before:'needs_review'|'recorded';
 outstanding_before_minor:number|null;outstanding_after_minor:number|null;
 refund_payable_before_minor:number|null;refund_payable_after_minor:number|null;standing_after:'needs_review'|'recorded';
 source_hash:string;
}>;
/** Closed native review projection. No authority, provider call or balance calculator. */
const keys=['review_version','financial_evidence_version','effect','invoice_id','invoice_version','client_id','client_name','currency',
 'provider_operation_id','observation_id','observation_version','disposition_version','decision','captured_minor','retained_minor','returned_minor',
 'credit_before_minor','credit_after_minor','standing_before','outstanding_before_minor','outstanding_after_minor',
 'refund_payable_before_minor','refund_payable_after_minor','standing_after','source_hash'] as const;
const amount=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=2147483647;
export function readProviderDispositionReview(value:unknown,command:SalesInvoiceCommand):ProviderDispositionReview|null{
 if(command.action!=='invoice.record_provider_disposition'||!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as Record<string,unknown>;
 if(Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!(keys as readonly string[]).includes(k))
  ||r.review_version!==2||r.financial_evidence_version!==3||r.effect!=='internal_financial_disposition_only'
  ||r.invoice_id!==command.invoice_id||r.invoice_version!==command.expected_version
  ||r.provider_operation_id!==command.provider_operation_id||r.observation_id!==command.observation_id
  ||r.observation_version!==command.observation_version||r.disposition_version!==command.expected_disposition_version
  ||r.decision!==command.decision||r.currency!=='usd'
  ||!['invoice_id','client_id','provider_operation_id','observation_id'].every(k=>typeof r[k]==='string'&&UUID.test(String(r[k])))
  ||typeof r.client_name!=='string'||!r.client_name.trim()||r.client_name.length>500
  ||typeof r.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(r.source_hash)
  ||!Number.isSafeInteger(r.invoice_version)||Number(r.invoice_version)<1
  ||!Number.isSafeInteger(r.observation_version)||Number(r.observation_version)<1||Number(r.observation_version)>=Number.MAX_SAFE_INTEGER
  ||!Number.isSafeInteger(r.disposition_version)||Number(r.disposition_version)<0||Number(r.disposition_version)>=Number.MAX_SAFE_INTEGER
  ||!['captured_minor','retained_minor','returned_minor','credit_before_minor','credit_after_minor'].every(k=>amount(r[k])))return null;
 const captured=Number(r.captured_minor),retained=Number(r.retained_minor);
 if(captured<1||retained>captured||r.returned_minor!==captured-retained||Number(r.credit_before_minor)>captured||Number(r.credit_after_minor)>captured
  ||(command.decision==='balance_due'?r.credit_after_minor!==0:command.decision!=='credit_returned_principal'||!amount(command.credit_minor)||Number(command.credit_minor)<1||r.credit_after_minor!==command.credit_minor))return null;
 if(r.standing_before==='needs_review'){
  if(r.outstanding_before_minor!==null||r.refund_payable_before_minor!==null)return null;
 }else if(r.standing_before!=='recorded'||!amount(r.outstanding_before_minor)||!amount(r.refund_payable_before_minor))return null;
 if(r.standing_after==='needs_review'){
  if(r.outstanding_after_minor!==null||r.refund_payable_after_minor!==null)return null;
 }else if(r.standing_after!=='recorded'||!amount(r.outstanding_after_minor)||!amount(r.refund_payable_after_minor))return null;
 // An engagement can retain unpaid future installments while owing a refund
 // on another original obligation. Native allocation owns both; never net here.
 return Object.freeze({...r}) as ProviderDispositionReview;
}
export function providerDispositionReviewsEqual(a:ProviderDispositionReview,b:ProviderDispositionReview):boolean{
 return keys.every(key=>a[key]===b[key]);
}
/** A stored invoice operation is not a provider-money or customer-message receipt. */
export function providerDispositionResultMatches(value:unknown,command:SalesInvoiceCommand,operationId:string,tenantId:string,approvedReview?:ProviderDispositionReview):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value)||command.action!=='invoice.record_provider_disposition'||!UUID.test(operationId)||!UUID.test(tenantId))return false;
 const r=value as Record<string,unknown>,operation=r.operation,row=r.row;
 const allowed=['ok','outcome','effect','payment_moved','customer_notified','rail_recorded','receipt_id','operation','provider_disposition_review','disposition_version','invoice_version','row','replayed'];
 if(Object.keys(r).some(k=>!allowed.includes(k))||r.ok!==true||r.effect!=='internal_financial_disposition_only'
  ||r.payment_moved!==false||r.customer_notified!==false||r.rail_recorded!==true
  ||typeof r.receipt_id!=='string'||!UUID.test(r.receipt_id)||(r.replayed!==undefined&&typeof r.replayed!=='boolean')
  ||!operation||typeof operation!=='object'||Array.isArray(operation)||!row||typeof row!=='object'||Array.isArray(row))return false;
 const op=operation as Record<string,unknown>,invoice=row as Record<string,unknown>;
 if(Object.keys(op).length!==2||op.id!==operationId||op.action!==command.action||Object.keys(invoice).length!==3)return false;
 const unchanged=r.outcome==='financial_decision_unchanged';
 if(!unchanged&&r.outcome!=='financial_decision_recorded'||unchanged&&Number(command.expected_disposition_version)<1)return false;
 const nextVersion=command.expected_version+(unchanged?0:1),nextDisposition=Number(command.expected_disposition_version)+(unchanged?0:1);
 if(!Number.isSafeInteger(nextVersion)||!Number.isSafeInteger(nextDisposition)||r.invoice_version!==nextVersion||r.disposition_version!==nextDisposition
  ||invoice.id!==command.invoice_id||invoice.tenant_id!==tenantId||invoice.version!==nextVersion)return false;
 const review=readProviderDispositionReview(r.provider_disposition_review,command);
 if(!review||approvedReview&&!providerDispositionReviewsEqual(review,approvedReview))return false;
 // An unchanged label cannot hide a newly applied credit or a changed amount.
 // Provider/obligation arithmetic remains native; compare its retained facts only.
 return !unchanged||review.standing_before===review.standing_after
  &&review.credit_before_minor===review.credit_after_minor
  &&review.outstanding_before_minor===review.outstanding_after_minor
  &&review.refund_payable_before_minor===review.refund_payable_after_minor;
}

export type ProviderPaymentFinancialReview=Readonly<{
 provider_operation_id:string;observation_id:string|null;observation_version:number;disposition_version:number;
 captured_minor:number;retained_minor:number|null;returned_minor:number|null;verification_pending:boolean;
 commercial_review_required:boolean;credit_minor:number;decision_operation_id:string|null;decision_current:boolean;
}>;
/** Closed caller-visible context from the original invoice read, never service observation access. */
export function readProviderPaymentFinancialReview(value:unknown,paymentId:unknown,captured:unknown):ProviderPaymentFinancialReview|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as Record<string,unknown>,fields=['provider_operation_id','observation_id','observation_version','disposition_version',
  'captured_minor','retained_minor','returned_minor','verification_pending','commercial_review_required','credit_minor','decision_operation_id','decision_current'];
 if(Object.keys(r).length!==fields.length||Object.keys(r).some(k=>!fields.includes(k))
  ||r.provider_operation_id!==paymentId||typeof paymentId!=='string'||!UUID.test(paymentId)
  ||r.captured_minor!==captured||!amount(captured)||Number(captured)<1
  ||!Number.isSafeInteger(r.observation_version)||Number(r.observation_version)<0||Number(r.observation_version)>=Number.MAX_SAFE_INTEGER
  ||!Number.isSafeInteger(r.disposition_version)||Number(r.disposition_version)<0||Number(r.disposition_version)>=Number.MAX_SAFE_INTEGER
  ||typeof r.verification_pending!=='boolean'||typeof r.commercial_review_required!=='boolean'||typeof r.decision_current!=='boolean'
  ||!amount(r.credit_minor)||Number(r.credit_minor)>Number(captured))return null;
 if(r.observation_version===0?r.observation_id!==null:typeof r.observation_id!=='string'||!UUID.test(r.observation_id))return null;
 if(r.disposition_version===0?r.decision_operation_id!==null||r.credit_minor!==0||r.decision_current!==false:
  typeof r.decision_operation_id!=='string'||!UUID.test(r.decision_operation_id))return null;
 if(r.decision_current&&r.observation_version===0)return null;
 if(r.verification_pending?r.retained_minor!==null||r.returned_minor!==null:
  !amount(r.retained_minor)||!amount(r.returned_minor)||Number(r.retained_minor)+Number(r.returned_minor)!==captured)return null;
 return Object.freeze({...r}) as ProviderPaymentFinancialReview;
}
