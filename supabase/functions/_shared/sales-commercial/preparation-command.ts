import {UUID,integer,object,only} from '../sales-collections/primitives.ts';
import {parseCommercialEngagement,type CommercialEngagement} from '../agreements/commercial-engagement.ts';
import type {PreparedCommercialPresentation} from '../agreements/commercial-presentation.ts';

const ids=['agreement_id','invoice_id','terms_id','client_id','offer_id'] as const;
const versions=['agreement_version','invoice_version','invoice_draft_version','terms_version'] as const;
const keys=['action',...ids,...versions,'payload_digest'] as const;
const id=(value:unknown):string=>{
 if(typeof value!=='string'||!UUID.test(value))throw new TypeError('COMMERCIAL_PREPARATION_INVALID');return value;
};
const hash=(value:unknown):string=>{
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new TypeError('COMMERCIAL_PREPARATION_INVALID');return value;
};
export type CommercialPreparationCommand={
 action:'collection.prepare_agreement';agreement_id:string;agreement_version:number;
 invoice_id:string;invoice_version:number;invoice_draft_version:number;
 terms_id:string;terms_version:number;client_id:string;offer_id:string;payload_digest:string;
};
/** IDs, versions and digest only. No caller-supplied actor, legal text, upload
 * path, document digest, tenant grant or approval can enter the stored intent. */
export function parseCommercialPreparationCommand(value:unknown):CommercialPreparationCommand{
 if(!object(value))throw new TypeError('COMMERCIAL_PREPARATION_INVALID');only(value,[...keys]);
 if(value.action!=='collection.prepare_agreement')throw new TypeError('COMMERCIAL_PREPARATION_INVALID');
 return {action:'collection.prepare_agreement',agreement_id:id(value.agreement_id),agreement_version:integer(value.agreement_version,1,Number.MAX_SAFE_INTEGER),
  invoice_id:id(value.invoice_id),invoice_version:integer(value.invoice_version,1,Number.MAX_SAFE_INTEGER),invoice_draft_version:integer(value.invoice_draft_version,1,Number.MAX_SAFE_INTEGER),
  terms_id:id(value.terms_id),terms_version:integer(value.terms_version,0,Number.MAX_SAFE_INTEGER),client_id:id(value.client_id),offer_id:id(value.offer_id),payload_digest:hash(value.payload_digest)};
}
export function commercialPreparationCommand(value:PreparedCommercialPresentation):CommercialPreparationCommand{
 if(value.payload.schema_version!==2)throw new TypeError('COMMERCIAL_PREPARATION_REQUIRES_EXPLICIT_SERVICE_FACTS');
 const s=value.payload.source;
 return parseCommercialPreparationCommand({action:'collection.prepare_agreement',agreement_id:s.agreement_id,agreement_version:s.agreement_version,
  invoice_id:s.invoice_id,invoice_version:s.invoice_version,invoice_draft_version:s.invoice_draft_version,terms_id:s.terms_id,terms_version:s.terms_version,
  client_id:s.client_id,offer_id:s.offer_id,payload_digest:value.payload_digest});
}
const uuidSchema={type:'string',format:'uuid'} as const;
const versionSchema={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER} as const;
// The canonical objectInputSchema builder owns root type/closure; supply its
// exact properties/required contract, not a second JSON-schema root dialect.
export const preparationCommandSchema={properties:{
 action:{type:'string',enum:['collection.prepare_agreement']},
 agreement_id:uuidSchema,invoice_id:uuidSchema,terms_id:uuidSchema,client_id:uuidSchema,offer_id:uuidSchema,
 agreement_version:versionSchema,invoice_version:versionSchema,invoice_draft_version:versionSchema,
 terms_version:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},
 payload_digest:{type:'string',pattern:'^[a-f0-9]{64}$'},
},required:keys} as const;
export type CommercialPreparationConsequence=CommercialPreparationCommand&{
 kind:'retain_signing_document';principal_minor:number;currency:'usd';engagement:CommercialEngagement;
};
export function readCommercialPreparationConsequence(value:unknown,command:CommercialPreparationCommand):CommercialPreparationConsequence|null{
 try{
  if(!object(value))return null;only(value,[...keys,'kind','principal_minor','currency','engagement']);
  const parsed=parseCommercialPreparationCommand(Object.fromEntries(keys.map(key=>[key,value[key]])));
  if(keys.some(key=>parsed[key as keyof CommercialPreparationCommand]!==command[key as keyof CommercialPreparationCommand])
   ||value.kind!=='retain_signing_document'||value.currency!=='usd')return null;
  return {...parsed,kind:'retain_signing_document',principal_minor:integer(value.principal_minor,1),currency:'usd',engagement:parseCommercialEngagement(value.engagement)};
 }catch{return null;}
}
/** A source-bound historical receipt can be reloaded without claiming a current
 * signature, notification, invoice issuance, payment or accepted delivery. */
export function hasCommercialPreparationReceipt(value:unknown,tenant:string,command:CommercialPreparationCommand):boolean{
 try{
  if(!object(value)||value.ok!==true||value.outcome!=='agreement_prepared'||value.historical_receipt!==true)return false;
  only(value,['ok','outcome','historical_receipt','receipt_id','row','operation','capability','replayed']);id(value.receipt_id);
  if(value.capability!==undefined&&value.capability!=='sales_prepare_agreement'||value.replayed!==undefined&&typeof value.replayed!=='boolean')return false;
  const r=value.row,o=value.operation;if(!object(r)||!object(o))return false;
  only(r,['id','tenant_id','version_at_preparation','invoice_id','invoice_version','invoice_draft_version','terms_id','terms_version','client_id','offer_id','payload_digest','document_sha256','prepared_at','actor_user_id']);
  only(o,['id','action']);id(o.id);id(r.actor_user_id);hash(r.document_sha256);
  if(typeof r.prepared_at!=='string'||r.prepared_at.length>50||!Number.isFinite(Date.parse(r.prepared_at)))return false;
  return o.action===command.action&&r.id===command.agreement_id&&r.tenant_id===tenant&&r.version_at_preparation===command.agreement_version
   &&r.invoice_id===command.invoice_id&&r.invoice_version===command.invoice_version&&r.invoice_draft_version===command.invoice_draft_version&&r.terms_id===command.terms_id&&r.terms_version===command.terms_version
   &&r.client_id===command.client_id&&r.offer_id===command.offer_id&&r.payload_digest===command.payload_digest;
 }catch{return false;}
}
