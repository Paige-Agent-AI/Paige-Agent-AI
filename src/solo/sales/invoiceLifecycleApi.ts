import {readAllocatedBalance} from '../../../supabase/functions/_shared/sales-payments/balance-projection';
import {readInvoiceDraft,type InvoiceDraft} from './invoiceDraftApi';
import {billingDraftFailure,type BillingRpc,type DraftResult} from './billingDrafts';
export type InvoiceReceipt={id:string;kind:'receipt'|'reversal';amount_cents:number;method:string;received_at:string;reference:string|null;notes:string|null;actor_user_id:string;actor_label?:string|null;reverses_payment_id:string|null;reason:string|null;evidence_kind?:'manual_recorded'|'provider_verified';provider?:'stripe'|'paypal'|null;provider_verified_at?:string|null};
export type InvoiceRecord=InvoiceDraft&{status:'draft'|'issued'|'void';issuedSnapshotVersion:number|null;manualRecordedMinor:number;providerVerifiedMinor:number;allocatedMinor:number;remainingMinor:number;payments:InvoiceReceipt[];paymentsCount:number;paymentsHasMore:boolean;document:Record<string,unknown>|null;documentInputDigest:string|null};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function readInvoiceRecord(value:unknown,tenantId:string):InvoiceRecord|null{
  if(!object(value)||!['draft','issued','void'].includes(String(value.status)))return null;
  const draft=readInvoiceDraft({...value,status:'draft'},tenantId);if(!draft)return null;
  const status=value.status as InvoiceRecord['status'];
  const balance=readAllocatedBalance(value,draft.totalMinor);if(!balance)return null;
  if(!Array.isArray(value.payments)||!Number.isSafeInteger(value.payments_count)||Number(value.payments_count)<0||Number(value.payments_count)<value.payments.length||value.payments_has_more!==(Number(value.payments_count)>value.payments.length))return null;
  if(!Number.isSafeInteger(value.version)||Number(value.version)<draft.version||!Array.isArray(value.payments)||value.payments.length>50||!Number.isSafeInteger(value.payments_count)||typeof value.payments_has_more!=='boolean')return null;
  if(status!=='draft'&&(!object(value.document)||typeof value.document_input_digest!=='string'||!/^[0-9a-f]{64}$/.test(value.document_input_digest)||value.issued_snapshot_version!==draft.version))return null;
  const payments:InvoiceReceipt[]=[];
  for(const row of value.payments){if(!object(row)||typeof row.id!=='string'||!['receipt','reversal'].includes(String(row.kind))||!Number.isSafeInteger(row.amount_cents)||Number(row.amount_cents)<1||typeof row.method!=='string'||typeof row.received_at!=='string'||typeof row.actor_user_id!=='string')return null;if(row.evidence_kind!==undefined&&!['manual_recorded','provider_verified'].includes(String(row.evidence_kind)))return null;if(row.evidence_kind==='provider_verified'&&(row.kind!=='receipt'||!['stripe','paypal'].includes(String(row.provider))||typeof row.provider_verified_at!=='string'||!Number.isFinite(Date.parse(row.provider_verified_at))))return null;payments.push(row as unknown as InvoiceReceipt);}
  return {...draft,version:Number(value.version),status,issuedSnapshotVersion:status==='draft'?null:Number(value.issued_snapshot_version),manualRecordedMinor:balance.manual,providerVerifiedMinor:balance.verified,allocatedMinor:balance.allocated,remainingMinor:balance.remaining,payments,paymentsCount:Number(value.payments_count),paymentsHasMore:value.payments_has_more,document:object(value.document)?value.document:null,documentInputDigest:typeof value.document_input_digest==='string'?value.document_input_digest:null};
}
export async function listInvoiceRecords(rpc:BillingRpc,tenantId:string,beforeId:string|null=null):Promise<DraftResult<{rows:InvoiceRecord[];hasMore:boolean;nextCursor:string|null}>>{
  try{const {data,error}=await rpc('list_sales_invoices',{_expected_tenant_id:tenantId,_limit:50,_before_id:beforeId});if(error)return billingDraftFailure(error);
    if(!object(data)||!Array.isArray(data.rows)||data.rows.length>50||typeof data.has_more!=='boolean'||!(data.next_cursor===null||typeof data.next_cursor==='string'))return billingDraftFailure(null);
    const rows=data.rows.map(row=>readInvoiceRecord(row,tenantId));if(rows.some(row=>!row))return billingDraftFailure(null);
    return {ok:true,value:{rows:rows as InvoiceRecord[],hasMore:data.has_more,nextCursor:data.next_cursor as string|null}};
  }catch{return billingDraftFailure(null);}
}
