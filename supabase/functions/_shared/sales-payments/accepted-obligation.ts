import {date,integer,MAX_MINOR,MAX_SCHEDULE,object,only,UUID} from '../sales-collections/primitives.ts';

/** Original accepted source identity; no caller-authored amount, dates or authority. */
export type PaymentObligationReference=Readonly<{
 commercial_terms_id:string;signing_id:string;signing_version:number;terms_version:number;sequence:number;
}>;
/** Declaration of the SAME selector accepted below. No amounts, dates or grants
 * are caller fields; the canonical writer resolves and rechecks those facts. */
export const PAYMENT_OBLIGATION_REFERENCE_SCHEMA={
 type:'object',additionalProperties:false,
 properties:{commercial_terms_id:{type:'string',format:'uuid'},signing_id:{type:'string',format:'uuid'},
  signing_version:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},
  terms_version:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},
  sequence:{type:'integer',minimum:1,maximum:MAX_SCHEDULE}},
 required:['commercial_terms_id','signing_id','signing_version','terms_version','sequence'],
} as const;
/** Transport shape only. The canonical writer must revalidate original signing/effective
 * source, invoice, allocation and permissions under its existing locks. Parsing is not proof. */
export type PaymentObligationEvidence=Readonly<{
 reference:PaymentObligationReference;source_digest:string;due_date:string;
 scheduled_minor:number;remaining_minor:number;
}>;
export type PaymentObligationContext=Readonly<{
 tenant_id:string;client_id:string;invoice_id:string;invoice_version:number;
 issued_snapshot_version:number;obligation:PaymentObligationEvidence;
}>;
const invalid=():never=>{throw new TypeError('PAYMENT_OBLIGATION_INVALID');};
const id=(value:unknown):string=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():invalid();

export function parsePaymentObligationReference(value:unknown):PaymentObligationReference{
 try{
  if(!object(value))return invalid();
  only(value,['commercial_terms_id','signing_id','signing_version','terms_version','sequence']);
  return {commercial_terms_id:id(value.commercial_terms_id),signing_id:id(value.signing_id),
   signing_version:integer(value.signing_version,1,Number.MAX_SAFE_INTEGER),
   terms_version:integer(value.terms_version,0,Number.MAX_SAFE_INTEGER),sequence:integer(value.sequence,1,MAX_SCHEDULE)};
 }catch{return invalid();}
}

export function parsePaymentObligationEvidence(value:unknown):PaymentObligationEvidence{
 try{
  if(!object(value))return invalid();
  only(value,['reference','source_digest','due_date','scheduled_minor','remaining_minor']);
  if(typeof value.source_digest!=='string'||!/^[a-f0-9]{64}$/.test(value.source_digest))return invalid();
  const scheduled=integer(value.scheduled_minor,1,MAX_MINOR);
  return {reference:parsePaymentObligationReference(value.reference),source_digest:value.source_digest,
   due_date:date(value.due_date),scheduled_minor:scheduled,remaining_minor:integer(value.remaining_minor,0,scheduled)};
 }catch{return invalid();}
}

/** Scope must come from the original authenticated read, never caller intent. */
export function parsePaymentObligationContext(value:unknown):PaymentObligationContext{
 try{
  if(!object(value))return invalid();
  only(value,['tenant_id','client_id','invoice_id','invoice_version','issued_snapshot_version','obligation']);
  return {tenant_id:id(value.tenant_id),client_id:id(value.client_id),invoice_id:id(value.invoice_id),
   invoice_version:integer(value.invoice_version,1,Number.MAX_SAFE_INTEGER),
   issued_snapshot_version:integer(value.issued_snapshot_version,1,Number.MAX_SAFE_INTEGER),
   obligation:parsePaymentObligationEvidence(value.obligation)};
 }catch{return invalid();}
}
