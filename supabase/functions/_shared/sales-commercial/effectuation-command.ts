import {UUID,object,invalid,integer,date,only} from '../sales-collections/primitives.ts';

export type CommercialEffectuationCommand={
 action:'collection.effectuate_terms';agreement_id:string;expected_version:number;expected_updated_at:string;
 signing_id:string;signing_version:number;invoice_id:string;invoice_draft_version:number;payload_digest:string;sealed_sha256:string;
};
const keys=['action','agreement_id','expected_version','expected_updated_at','signing_id','signing_version','invoice_id','invoice_draft_version','payload_digest','sealed_sha256'] as const;
const id=(value:unknown)=>{if(typeof value!=='string'||!UUID.test(value))return invalid();return value.toLowerCase();};
const hash=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return invalid();return value;};
export function exactCommercialTimestamp(value:unknown):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value))return invalid();
 date(value.slice(0,10));if(!Number.isFinite(Date.parse(value)))return invalid();
 // The six-digit PostgreSQL source is a revision brake. Do not normalize it
 // through Date.toISOString(), which would erase accepted microseconds.
 return value;
}
export function parseCommercialEffectuationCommand(value:unknown):CommercialEffectuationCommand{
 if(!object(value)||value.action!=='collection.effectuate_terms')return invalid();only(value,[...keys]);
 if(keys.some(key=>!(key in value)))return invalid();
 return {action:value.action,agreement_id:id(value.agreement_id),expected_version:integer(value.expected_version,0,Number.MAX_SAFE_INTEGER),
  expected_updated_at:exactCommercialTimestamp(value.expected_updated_at),signing_id:id(value.signing_id),signing_version:integer(value.signing_version,1,Number.MAX_SAFE_INTEGER),
  invoice_id:id(value.invoice_id),invoice_draft_version:integer(value.invoice_draft_version,1,Number.MAX_SAFE_INTEGER),payload_digest:hash(value.payload_digest),sealed_sha256:hash(value.sealed_sha256)};
}
const uuid={type:'string',format:'uuid'} as const,version={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER} as const,digest={type:'string',pattern:'^[a-f0-9]{64}$'} as const;
export const effectuationCommandSchema={properties:{action:{type:'string',enum:['collection.effectuate_terms']},agreement_id:uuid,expected_version:{...version,minimum:0},
 expected_updated_at:{type:'string',minLength:20,maxLength:32},signing_id:uuid,signing_version:version,invoice_id:uuid,invoice_draft_version:version,payload_digest:digest,sealed_sha256:digest},required:[...keys]} as const;

export type CommercialEffectuationConsequence={agreement_id:string;signing_id:string;signing_version:number;terms_version:number;invoice_id:string;
 payload_digest:string;sealed_sha256:string;expected_updated_at:string;invoice_draft_version:number;client_id:string;amount_cents:number;currency:'usd';starts_on:string;
 state_before:'draft'|'active';state_after:'active';effect:'record_provenance_only'|'activate_matching_terms'};
export function readCommercialEffectuationConsequence(value:unknown,command:CommercialEffectuationCommand):CommercialEffectuationConsequence|null{
 try{
  if(!object(value))return null;only(value,['agreement_id','signing_id','signing_version','terms_version','invoice_id','payload_digest','sealed_sha256','expected_updated_at','invoice_draft_version','client_id','amount_cents','currency','starts_on','state_before','state_after','effect']);
  for(const key of ['agreement_id','signing_id','signing_version','invoice_id','payload_digest','sealed_sha256','expected_updated_at','invoice_draft_version'] as const)if(value[key]!==command[key])return null;
  if(value.terms_version!==command.expected_version||value.currency!=='usd'||value.state_after!=='active'||!['draft','active'].includes(String(value.state_before))
   ||value.effect!==(value.state_before==='active'?'record_provenance_only':'activate_matching_terms'))return null;
  return {...value,client_id:id(value.client_id),amount_cents:integer(value.amount_cents,1),starts_on:date(value.starts_on)} as CommercialEffectuationConsequence;
 }catch{return null;}
}

/** A success flag alone cannot retire an unresolved commercial operation. The
 * canonical receipt is historical and may name the original pair's other request
 * ID; it still must match the exact approved business source and tenant. */
export function hasCommercialEffectuationReceipt(value:unknown,tenant:string,command:CommercialEffectuationCommand):boolean{
 try{
  if(!object(value)||value.ok!==true||value.outcome!=='commercial_terms_effectuated'||value.historical_receipt!==true)return false;
  only(value,['ok','outcome','historical_receipt','receipt_id','row','operation','replayed','capability']);id(value.receipt_id);
  if(value.replayed!==undefined&&typeof value.replayed!=='boolean'||value.capability!==undefined&&value.capability!=='sales_effectuate_commercial_terms')return false;
  const r=value.row,o=value.operation;if(!object(r)||!object(o))return false;
  only(r,['id','tenant_id','status_at_execution','signing_id','signing_version','terms_version','effective_at','source_digest','actor_user_id','effect']);only(o,['id','action']);
  id(o.id);id(r.actor_user_id);exactCommercialTimestamp(r.effective_at);
  return o.action===command.action&&r.id===command.agreement_id&&r.tenant_id===tenant&&r.status_at_execution==='active'
   &&r.signing_id===command.signing_id&&r.signing_version===command.signing_version&&r.terms_version===command.expected_version&&r.source_digest===command.payload_digest
   &&['record_provenance_only','activate_matching_terms'].includes(String(r.effect));
 }catch{return false;}
}
