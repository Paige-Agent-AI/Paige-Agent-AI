import {decodeAcceptedCommercialAgreement,type AcceptedCommercialRead} from '../agreements/accepted-commercial-read.ts';
import {parsePaymentObligationEvidence,type PaymentObligationEvidence} from './accepted-obligation.ts';
import {integer,MAX_SCHEDULE,object,only,UUID} from '../sales-collections/primitives.ts';

const heldReasons=['invoice_not_issued','accepted_source_unavailable','commercial_terms_inactive','accepted_source_changed','test_payment_evidence','allocation_conflict','allocation_required'] as const;
type HeldReason=typeof heldReasons[number];

export type AcceptedPaymentPlanRead=
 | {state:'refused'|'unverified'|'stale'}
 | {state:'held';reason:HeldReason}
 | {state:'available';accepted:Extract<AcceptedCommercialRead,{state:'recorded'}>;currency:string;obligations:PaymentObligationEvidence[]};
type Caller={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};

const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
/** Transport only: one caller-JWT read, original retained-record decoder and exact
 * native remaining amounts. No permission predicate, repricing, date calculation,
 * allocation inference, provider call or authority to execute a request. */
export async function readAcceptedInvoicePaymentPlan(tenant:unknown,args:unknown,caller:Caller):Promise<AcceptedPaymentPlanRead>{
 const refused:AcceptedPaymentPlanRead={state:'refused'};
 try{
  if(!id(tenant)||!object(args))return refused;
  only(args,['invoice_id','agreement_id','client_id','invoice_version','invoice_draft_version','issued_snapshot_version','currency']);
  if(!id(args.invoice_id)||!id(args.agreement_id)||!id(args.client_id)||typeof args.currency!=='string'||!/^[a-z]{3}$/.test(args.currency))return refused;
  const expectedVersion=integer(args.invoice_version,1,Number.MAX_SAFE_INTEGER),draftVersion=integer(args.invoice_draft_version,1,Number.MAX_SAFE_INTEGER),issuedVersion=integer(args.issued_snapshot_version,1,Number.MAX_SAFE_INTEGER);
  const response=await caller.rpc('read_sales_accepted_invoice_obligations',{_expected_tenant_id:tenant,_invoice_id:args.invoice_id,_agreement_id:args.agreement_id});
  if(response.error||!object(response.data)||!object(response.data.payment_obligations))return refused;
  const {payment_obligations:observation,...retained}=response.data;
  const accepted=await decodeAcceptedCommercialAgreement(tenant,{invoice_id:args.invoice_id,agreement_id:args.agreement_id},retained);
  if(accepted.state==='refused')return refused;
  only(observation,['schema_version','tenant_id','client_id','invoice_id','invoice_version','invoice_draft_version','issued_snapshot_version','obligations','state',...(observation.state==='held'?['reason']:[])]);
  if(observation.schema_version!==1||observation.tenant_id!==tenant||observation.client_id!==args.client_id||observation.invoice_id!==args.invoice_id||!Array.isArray(observation.obligations)||observation.obligations.length>MAX_SCHEDULE)return refused;
  if(integer(observation.invoice_version,1,Number.MAX_SAFE_INTEGER)!==expectedVersion||integer(observation.invoice_draft_version,1,Number.MAX_SAFE_INTEGER)!==draftVersion||integer(observation.issued_snapshot_version,1,Number.MAX_SAFE_INTEGER)!==issuedVersion)return {state:'stale'};
  if(observation.state==='held'){
   if(observation.obligations.length||!heldReasons.includes(observation.reason as HeldReason))return refused;
   return accepted.state==='unverified'?{state:'unverified'}:{state:'held',reason:observation.reason as HeldReason};
  }
  if(observation.state!=='available'||accepted.state!=='recorded'||accepted.presentation.payload.schema_version!==2)return refused;
  const payload=accepted.presentation.payload,source=payload.source;
  if(source.client_id!==args.client_id||payload.currency!==args.currency||source.invoice_draft_version!==draftVersion||issuedVersion!==draftVersion)return refused;
  const originals=payload.obligations.filter(row=>row.amount_cents>0);
  if(observation.obligations.length!==originals.length)return refused;
  const obligations=observation.obligations.map(parsePaymentObligationEvidence);
  for(const [index,row] of obligations.entries()){
   const original=originals[index],ref=row.reference;
   if(ref.signing_id!==args.agreement_id||ref.signing_version!==source.agreement_version||ref.commercial_terms_id!==source.terms_id||ref.terms_version!==source.terms_version||ref.sequence!==original.sequence||row.source_digest!==accepted.presentation.payload_digest||row.due_date!==original.due_date||row.scheduled_minor!==original.amount_cents)return refused;
  }
  return {state:'available',accepted,currency:payload.currency,obligations};
 }catch{return refused;}
}
