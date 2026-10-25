import {object,UUID} from '../sales-collections/primitives.ts';
import type {sealAgreementPdf} from './document.ts';
import {canonicalPresentationJson} from './preparation-json.ts';
import {sha256Hex} from './token.ts';

type PreparedFields=NonNullable<Parameters<typeof sealAgreementPdf>[0]['preparedFields']>;
export type SealSourceDb={rpc?:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
type AgreementSource={id:string;tenant_id:string;contact_id:string;version:number;content_sha256:string;content_storage_key:string|null};
type Result={kind:'legacy'}|{kind:'unavailable'}|{kind:'prepared';fields:PreparedFields;signers:Record<string,unknown>[];sourceSha256:string};
const closed=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
/** Private original-engine read. Never accept a caller's manifest/answers or
 * infer a legacy document when the native selection/evidence read is unknown.
 * The original PDF sealer independently reconstructs all field inputs, hashes,
 * signer identities, consent, geometry and actual retained bytes before upload.
 * A selected preparation is still NOT authority to send or record a signature. */
export async function readPreparedSealSource(db:SealSourceDb,agreement:AgreementSource):Promise<Result>{
 try{
  if(typeof db.rpc!=='function')return {kind:'unavailable'};
  const response=await db.rpc('_read_prepared_agreement_seal',{_agreement:agreement.id});
  if(response.error)return {kind:'unavailable'};
  const r=structuredClone(response.data);
  if(!object(r)||r.agreement_id!==agreement.id||r.tenant_id!==agreement.tenant_id)return {kind:'unavailable'};
  if(r.state==='legacy'&&closed(r,['state','agreement_id','tenant_id']))return {kind:'legacy'};
  if(!closed(r,['state','agreement_id','tenant_id','client_id','source_version','document_sha256','content_storage_key','prepared_fields','signers'])
   ||r.state!=='prepared'||r.client_id!==agreement.contact_id||r.source_version!==agreement.version
   ||r.document_sha256!==agreement.content_sha256||r.content_storage_key!==agreement.content_storage_key
   ||!object(r.prepared_fields)||!closed(r.prepared_fields,['preparation_id','preparation','inputs'])
   ||typeof r.prepared_fields.preparation_id!=='string'||!UUID.test(r.prepared_fields.preparation_id)
   ||!object(r.prepared_fields.preparation)||!Array.isArray(r.prepared_fields.inputs)
   ||!Array.isArray(r.signers)||r.signers.length<1||r.signers.length>100
   ||r.signers.some(s=>!object(s)||typeof s.id!=='string'||!UUID.test(s.id)||s.status!=='signed'))return {kind:'unavailable'};
  return {kind:'prepared',fields:r.prepared_fields as PreparedFields,signers:r.signers,
   sourceSha256:await sha256Hex(canonicalPresentationJson(r))};
 }catch{return {kind:'unavailable'};}
}
