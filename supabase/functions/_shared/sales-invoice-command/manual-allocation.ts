import {integer,MAX_MINOR,MAX_SCHEDULE,object,only} from '../sales-collections/primitives.ts';
import {parsePaymentObligationEvidence,PAYMENT_OBLIGATION_EVIDENCE_SCHEMA,type PaymentObligationEvidence} from '../sales-payments/accepted-obligation.ts';

/** Transport for the original immutable manual-receipt command, never an allocation
 * ledger or evidence of payment. The canonical writer must independently validate
 * accepted source and current remaining amounts under its existing invoice lock. */
export type ManualPaymentAllocation=Readonly<{obligation:PaymentObligationEvidence;amount_cents:number}>;
export const MANUAL_PAYMENT_ALLOCATIONS_SCHEMA={type:'array',minItems:1,maxItems:MAX_SCHEDULE,
 items:{type:'object',additionalProperties:false,properties:{obligation:PAYMENT_OBLIGATION_EVIDENCE_SCHEMA,
  amount_cents:{type:'integer',minimum:1,maximum:MAX_MINOR}},required:['obligation','amount_cents']},
} as const;

export function parseManualPaymentAllocations(value:unknown,receiptMinor:number):ManualPaymentAllocation[]{
 const invalid=():never=>{throw new TypeError('MANUAL_PAYMENT_ALLOCATION_INVALID');};
 try{
  integer(receiptMinor,1,MAX_MINOR);
  if(!Array.isArray(value)||value.length<1||value.length>MAX_SCHEDULE)return invalid();
  const seen=new Set<number>();let source:string|undefined,total=0;
  const allocations=Array.from(value,item=>{
   if(!object(item))return invalid();
   only(item,['obligation','amount_cents']);
   const obligation=parsePaymentObligationEvidence(item.obligation),amount=integer(item.amount_cents,1,MAX_MINOR);
   const r=obligation.reference,key=JSON.stringify([r.commercial_terms_id,r.signing_id,r.signing_version,r.terms_version,obligation.source_digest]);
   if((source!==undefined&&source!==key)||seen.has(r.sequence)||amount>obligation.remaining_minor)return invalid();
   source=key;seen.add(r.sequence);total+=amount;
   return {obligation,amount_cents:amount};
  });
  if(total!==receiptMinor)return invalid();
  return allocations;
 }catch{return invalid();}
}

/** Compare canonical transport, independent of JSON object-key ordering. The
 * original native preview must supply this echo before a new review can proceed;
 * matching it is not execution authority or a replacement for native revalidation. */
export function manualAllocationReviewMatches(allocations:unknown,receiptMinor:number,review:unknown):boolean{
 try{return JSON.stringify(parseManualPaymentAllocations(allocations,receiptMinor))===JSON.stringify(parseManualPaymentAllocations(review,receiptMinor));}
 catch{return false;}
}
