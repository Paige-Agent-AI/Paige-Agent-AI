// Decode the ORIGINAL scoped reader's private native projection. This checks
// shape/identity/consistency only: the server owns signing and audit verification.
// It creates no agreement, financial calculation, receipt or execution authority.
import {UUID,MAX_MINOR,object,integer,date,only,parseCollectionTerms,type CollectionTerms} from '../sales-collections/contract.ts';

export type EffectiveTermsScope={tenant_id:string;client_id:string;commercial_terms_id:string;offer_id:string|null;working_terms_version:number};
type Base=EffectiveTermsScope&{schema_version:1;state:'not_recorded'|'unverified'};
export type EffectiveTermsSnapshot=Omit<Base,'state'>&{
 state:'verified';terms_version:number;signing_id:string;signing_version:number;completed_at:string;
 document_sha256:string;sealed_sha256:string;effectuated_at:string;operation_id:string;receipt_id:string;
 source_digest:string;invoice_id:string;principal_minor:number;currency:string;collection_terms:CollectionTerms;
 engagement:{starts_on:string;ends_on:string|null;price_basis:string};working_differs:boolean;
};
export type EffectiveTermsRead={state:'reader_unavailable'}|Base|EffectiveTermsSnapshot;
const BASE=['schema_version','state','tenant_id','client_id','commercial_terms_id','offer_id','working_terms_version'];
const SNAPSHOT=['terms_version','signing_id','signing_version','completed_at','document_sha256','sealed_sha256','effectuated_at',
 'operation_id','receipt_id','source_digest','invoice_id','principal_minor','currency','collection_terms','engagement','working_differs'];
const fail=():never=>{throw new TypeError('CLIENT_EFFECTIVE_TERMS_SOURCE_INVALID');};
const uuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function timestamp(value:unknown):number{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value))return fail();
 date(value.slice(0,10));
 const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:fail();
}

export function readClientEffectiveTerms(value:unknown,scope:EffectiveTermsScope):EffectiveTermsRead{
 // Older native readers/cached answers are compatible, without inventing proof.
 if(value===undefined)return {state:'reader_unavailable'};
 try{
  if(!object(value)||value.schema_version!==1||typeof value.state!=='string'||!['not_recorded','unverified','verified'].includes(value.state))return fail();
  const verified=value.state==='verified';only(value,verified?[...BASE,...SNAPSHOT]:BASE);
  for(const key of ['tenant_id','client_id','commercial_terms_id'] as const)
   if(!uuid(value[key])||value[key]!==scope[key])return fail();
  if(value.offer_id!==scope.offer_id||(value.offer_id!==null&&!uuid(value.offer_id)))return fail();
  integer(value.working_terms_version,0,Number.MAX_SAFE_INTEGER);
  if(value.working_terms_version!==scope.working_terms_version)return fail();
  if(!verified)return value as Base;
  for(const key of ['signing_id','operation_id','receipt_id','invoice_id'])if(!uuid(value[key]))return fail();
  if(!uuid(value.offer_id))return fail();
  for(const key of ['document_sha256','sealed_sha256','source_digest'])if(!hash(value[key]))return fail();
  integer(value.terms_version,0,Number.MAX_SAFE_INTEGER);integer(value.signing_version,1,Number.MAX_SAFE_INTEGER);
  if((value.terms_version as number)>(value.working_terms_version as number))return fail();
  if(timestamp(value.completed_at)>timestamp(value.effectuated_at))return fail();
  if(typeof value.working_differs!=='boolean'||(value.terms_version!==value.working_terms_version&&!value.working_differs))return fail();
  const principal=integer(value.principal_minor,1,MAX_MINOR),terms=parseCollectionTerms(value.collection_terms);
  if(value.currency!==terms.currency||principal!==terms.total_cents)return fail();
  const engagement=value.engagement;if(!object(engagement))return fail();
  only(engagement,['starts_on','ends_on','price_basis']);
  const starts=date(engagement.starts_on),ends=engagement.ends_on===null?null:date(engagement.ends_on);
  if((ends!==null&&ends<starts)||typeof engagement.price_basis!=='string'||!engagement.price_basis.trim()||engagement.price_basis.length>64)return fail();
  return {...value,collection_terms:terms} as EffectiveTermsSnapshot;
 }catch{return fail();}
}
