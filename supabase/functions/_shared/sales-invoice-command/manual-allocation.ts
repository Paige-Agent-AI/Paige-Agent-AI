import {integer,MAX_MINOR,MAX_SCHEDULE,object,only} from '../sales-collections/primitives.ts';
import {parsePaymentObligationEvidence,type PaymentObligationEvidence} from '../sales-payments/accepted-obligation.ts';

/** Transport for the original immutable manual-receipt command, never an allocation
 * ledger or evidence of payment. The canonical writer must independently validate
 * accepted source and current remaining amounts under its existing invoice lock. */
export type ManualPaymentAllocation=Readonly<{obligation:PaymentObligationEvidence;amount_cents:number}>;

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
