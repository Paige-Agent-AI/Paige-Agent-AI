import {readProviderPaymentFinancialReview,type ProviderPaymentFinancialReview} from '../../../supabase/functions/_shared/sales-invoice-command/provider-disposition';
import {readAllocatedBalance,readInvoiceFinancialSummary,type InvoiceFinancialSummary} from '../../../supabase/functions/_shared/sales-payments/balance-projection';
import {readInvoiceDraft,type InvoiceDraft} from './invoiceDraftApi';
import {billingDraftFailure,type BillingRpc,type DraftResult} from './billingDrafts';
export type InvoiceReceipt={id:string;kind:'receipt'|'reversal';amount_cents:number;method:string;received_at:string;reference:string|null;notes:string|null;actor_user_id:string;actor_label?:string|null;reverses_payment_id:string|null;reason:string|null;evidence_kind?:'manual_recorded'|'provider_verified';provider?:'stripe'|'paypal'|null;provider_verified_at?:string|null;provider_environment?:'test'|'live'|null;financialReview?:ProviderPaymentFinancialReview|null};
export type InvoiceRecord=InvoiceDraft&{status:'draft'|'issued'|'void';issuedSnapshotVersion:number|null;manualRecordedMinor:number;providerVerifiedMinor:number;allocatedMinor:number;remainingMinor:number|null;payments:InvoiceReceipt[];paymentsCount:number;paymentsHasMore:boolean;document:Record<string,unknown>|null;documentInputDigest:string|null;paymentEvidenceVersion?:2;testProviderVerifiedMinor?:number;financial?:InvoiceFinancialSummary};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function readInvoiceRecord(value:unknown,tenantId:string,requireFinancial=false):InvoiceRecord|null{
  if(!object(value)||!['draft','issued','void'].includes(String(value.status)))return null;
  const draft=readInvoiceDraft({...value,status:'draft'},tenantId);if(!draft)return null;
  const status=value.status as InvoiceRecord['status'];
  if(requireFinancial&&value.financial_evidence_version!==3)return null;
  const financialRequested=value.financial_evidence_version!==undefined||value.financial_summary!==undefined;
  const financial=financialRequested?readInvoiceFinancialSummary(value.financial_summary,{id:draft.id,version:Number(value.version),currency:draft.snapshot.currency,status}):null;
  if(financialRequested&&(value.financial_evidence_version!==3||!financial||value.payment_evidence_version!==2))return null;
  // Gross historical receipts may exceed principal after legitimate refunds and
  // re-collection. The native actual position, never gross subtraction, owns debt.
  const balance=financial?{manual:financial.manual_recorded_minor,verified:financial.provider_confirmed_minor,
    allocated:value.allocated_cents as number,remaining:financial.outstanding_minor}:readAllocatedBalance(value,draft.totalMinor);
  if(!balance||!Number.isSafeInteger(balance.allocated)||balance.allocated<0)return null;
  if(financial&&(value.manual_recorded_cents!==financial.manual_recorded_minor||value.provider_verified_cents!==financial.provider_confirmed_minor
    ||value.test_provider_verified_cents!==financial.test_provider_minor))return null;
  // The native v2 position owns business balances. TEST facts are a separate
  // projection, never another subtraction or allocation in this reader.
  const evidenceVersion=value.payment_evidence_version,versionedEvidence=evidenceVersion!==undefined;
  const testVerified=value.test_provider_verified_cents;
  if(versionedEvidence?(evidenceVersion!==2||!Number.isSafeInteger(testVerified)||Number(testVerified)<0):testVerified!==undefined)return null;
  if(!Array.isArray(value.payments)||!Number.isSafeInteger(value.payments_count)||Number(value.payments_count)<0||Number(value.payments_count)<value.payments.length||value.payments_has_more!==(Number(value.payments_count)>value.payments.length))return null;
  if(!Number.isSafeInteger(value.version)||Number(value.version)<draft.version||!Array.isArray(value.payments)||value.payments.length>50||!Number.isSafeInteger(value.payments_count)||typeof value.payments_has_more!=='boolean')return null;
  if(status!=='draft'&&(!object(value.document)||typeof value.document_input_digest!=='string'||!/^[0-9a-f]{64}$/.test(value.document_input_digest)||value.issued_snapshot_version!==draft.version))return null;
  const payments:InvoiceReceipt[]=[];
  for(const row of value.payments){if(!object(row)||typeof row.id!=='string'||!['receipt','reversal'].includes(String(row.kind))||!Number.isSafeInteger(row.amount_cents)||Number(row.amount_cents)<1||typeof row.method!=='string'||typeof row.received_at!=='string'||typeof row.actor_user_id!=='string')return null;if(row.evidence_kind!==undefined&&!['manual_recorded','provider_verified'].includes(String(row.evidence_kind)))return null;if(row.evidence_kind==='provider_verified'&&(row.kind!=='receipt'||!['stripe','paypal'].includes(String(row.provider))||typeof row.provider_verified_at!=='string'||!Number.isFinite(Date.parse(row.provider_verified_at))))return null;
    if(row.provider_environment!==undefined&&row.provider_environment!==null&&row.provider_environment!=='test'&&row.provider_environment!=='live')return null;
    if(versionedEvidence&&((row.evidence_kind!=='manual_recorded'&&row.evidence_kind!=='provider_verified')||(row.evidence_kind==='provider_verified'?(row.provider_environment!=='test'&&row.provider_environment!=='live'):row.provider_environment!==null)))return null;
    let financialReview:ProviderPaymentFinancialReview|null=null;
    if(financial){
     if(!Object.prototype.hasOwnProperty.call(row,'financial_review'))return null;
     if(row.financial_review!==null){
      if(row.evidence_kind!=='provider_verified'||row.provider_environment!=='live')return null;
      financialReview=readProviderPaymentFinancialReview(row.financial_review,row.provider_operation_id,row.amount_cents);
      if(!financialReview)return null;
     }
    }
    payments.push({...row,...(financial?{financialReview}:{})} as unknown as InvoiceReceipt);}
  return {...draft,version:Number(value.version),status,issuedSnapshotVersion:status==='draft'?null:Number(value.issued_snapshot_version),manualRecordedMinor:balance.manual,providerVerifiedMinor:balance.verified,allocatedMinor:balance.allocated,remainingMinor:balance.remaining,payments,paymentsCount:Number(value.payments_count),paymentsHasMore:value.payments_has_more,document:object(value.document)?value.document:null,documentInputDigest:typeof value.document_input_digest==='string'?value.document_input_digest:null,...(versionedEvidence?{paymentEvidenceVersion:2 as const,testProviderVerifiedMinor:Number(testVerified)}:{}),...(financial?{financial}:{})};
}
/** Negotiate the original native projection using the caller's existing JWT. */
export function requestInvoiceFinancialEvidence(query:ReturnType<BillingRpc>):ReturnType<BillingRpc>{
 const builder=query as ReturnType<BillingRpc>&{setHeader?:(name:string,value:string)=>ReturnType<BillingRpc>};
 return typeof builder.setHeader==='function'?builder.setHeader('x-paige-invoice-evidence-version','3'):query;
}
export async function listInvoiceRecords(rpc:BillingRpc,tenantId:string,beforeId:string|null=null):Promise<DraftResult<{rows:InvoiceRecord[];hasMore:boolean;nextCursor:string|null}>>{
  try{const {data,error}=await requestInvoiceFinancialEvidence(rpc('list_sales_invoices',{_expected_tenant_id:tenantId,_limit:50,_before_id:beforeId}));if(error)return billingDraftFailure(error);
    if(!object(data)||data.financial_evidence_version!==3||!Array.isArray(data.rows)||data.rows.length>50||typeof data.has_more!=='boolean'||!(data.next_cursor===null||typeof data.next_cursor==='string'))return billingDraftFailure(null);
    const rows=data.rows.map(row=>readInvoiceRecord(row,tenantId,true));if(rows.some(row=>!row))return billingDraftFailure(null);
    return {ok:true,value:{rows:rows as InvoiceRecord[],hasMore:data.has_more,nextCursor:data.next_cursor as string|null}};
  }catch{return billingDraftFailure(null);}
}
