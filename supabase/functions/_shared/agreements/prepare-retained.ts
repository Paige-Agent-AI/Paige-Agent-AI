import {UUID,object} from '../sales-collections/primitives.ts';
import {commercialPreparationCommand,parseCommercialPreparationCommand,type CommercialPreparationCommand} from '../sales-commercial/preparation-command.ts';
import {readCommercialPresentationSource} from './commercial-presentation-read.ts';
import {canonicalPresentationJson,commercialPresentationText,prepareCommercialPresentation,renderCommercialPresentation,type CommercialPresentationPayload} from './commercial-presentation.ts';
import {inspectUploadedPdf,isOwnedByTenant} from './document.ts';
import {sha256Hex} from './token.ts';
import {verifyRetainedAgreementPdf} from './retained-document.ts';

type Caller=Parameters<typeof readCommercialPresentationSource>[2];
type Store={from(bucket:string):{
 info(path:string):PromiseLike<{data:unknown;error:unknown}>;
 upload(path:string,bytes:Uint8Array,options:{contentType:string;upsert:false;cacheControl:string;metadata:Record<string,unknown>}):PromiseLike<{error:unknown}>;
 download(path:string):PromiseLike<{data:{size:number;arrayBuffer():Promise<ArrayBuffer>}|null;error:unknown}>;
}};
export type PreparedAgreementArtifact={
 payload:CommercialPresentationPayload;payload_digest:string;presented_body_markdown:string;
 presented_body_sha256:string;content_storage_key:string;document_sha256:string;
};
export class AgreementPreparationUnavailable extends Error{
 constructor(public readonly code:'SOURCE_UNAVAILABLE'|'SOURCE_CHANGED'|'RENDER_UNAVAILABLE'|'WORKSPACE_CHANGED'|'STORAGE_UNVERIFIED'){
  super('AGREEMENT_PREPARATION_'+code);
 }
}
const maxBytes=26214400;
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unavailable=():never=>{throw new AgreementPreparationUnavailable('STORAGE_UNVERIFIED');};
/** Internal artifact adapter AFTER the existing high/confirm gate. This module
 * is not an approval or public endpoint. Native SQL must still atomically check
 * the original sources and record the immutable operation/Rail receipt.
 *
 * Reuse the original private object, including across interrupted upload. The
 * canonical renderer stamps time: retry MUST NOT render another expected hash.
 * Source/digest metadata is attached to the SAME immutable Storage object, not
 * another job, receipt, agreement or financial store. No overwrite or deletion.
 */
export async function prepareRetainedAgreementArtifact(
 tenant:string,operation:string,command:CommercialPreparationCommand,caller:Caller,storage:Store,
 stillCurrent:()=>Promise<boolean>,renderer?:Parameters<typeof renderCommercialPresentation>[2],
):Promise<PreparedAgreementArtifact>{
 if(!UUID.test(tenant)||!UUID.test(operation))throw new AgreementPreparationUnavailable('SOURCE_UNAVAILABLE');
 const captured=parseCommercialPreparationCommand(command);
 let actor:string;
 try{
  const result=await caller.auth.getUser();
  if(result.error||!result.data.user||result.data.user.is_anonymous===true||!UUID.test(result.data.user.id))throw Error('Unavailable actor');
  actor=result.data.user.id;
 }catch{throw new AgreementPreparationUnavailable('SOURCE_UNAVAILABLE');}
 const checkCurrent=async()=>{
  try{
   if(!await stillCurrent())throw Error('Workspace changed');
   const active=await caller.rpc('current_user_tenant_id');
   const role=await caller.rpc('is_tenant_admin',{_tenant:tenant});
   const current=await caller.auth.getUser();
   if(active.error||active.data!==tenant||role.error||role.data!==true||current.error||current.data.user?.is_anonymous===true||current.data.user?.id!==actor)throw Error('Authority changed');
  }catch{throw new AgreementPreparationUnavailable('WORKSPACE_CHANGED');}
 };
 await checkCurrent();
 const source=await readCommercialPresentationSource(tenant,{invoice_id:captured.invoice_id,agreement_id:captured.agreement_id},caller);
 if(source.state!=='source')throw new AgreementPreparationUnavailable('SOURCE_UNAVAILABLE');
 const proposed=await prepareCommercialPresentation(source.input);
 if(proposed.payload.source.tenant_id!==tenant||canonicalPresentationJson(commercialPreparationCommand(proposed))!==canonicalPresentationJson(captured))throw new AgreementPreparationUnavailable('SOURCE_CHANGED');
 const presented=commercialPresentationText(source.input.body_markdown as string,proposed);
 const presentedHash=await sha256Hex(presented);
 const expected={schemaVersion:1,tenantId:tenant,agreementId:captured.agreement_id,operationId:operation,actorUserId:actor,
  payloadDigest:captured.payload_digest,presentedBodySha256:presentedHash};
 const path=`${tenant}/${captured.agreement_id}/presented-commercial-${operation}-${captured.payload_digest}.pdf`;
 if(!isOwnedByTenant(path,tenant))throw new AgreementPreparationUnavailable('SOURCE_UNAVAILABLE');
 const bucket=storage.from('paige-agreements');
 type Info={id:string;version:string;byteLength:number;documentSha256:string};
 const info=async(allowMissing:boolean):Promise<Info|null>=>{
  let result:Awaited<ReturnType<typeof bucket.info>>;
  try{result=await bucket.info(path);}catch{return unavailable();}
  if(result.error){
   // A timeout, permission error or missing bucket is not evidence of absence.
   if(allowMissing&&object(result.error)&&(result.error.statusCode===404||result.error.statusCode==='404')&&result.error.code==='NoSuchKey')return null;
   return unavailable();
  }
  const value=result.data;
  if(!object(value)||typeof value.id!=='string'||!UUID.test(value.id)||typeof value.version!=='string'||!value.version||value.version.length>128
   ||value.name!==path||value.bucketId!=='paige-agreements'||value.contentType!=='application/pdf'
   ||!Number.isSafeInteger(value.size)||Number(value.size)<5||Number(value.size)>maxBytes||!object(value.metadata))return unavailable();
  const meta=value.metadata,keys=[...Object.keys(expected),'documentSha256','byteLength'];
  if(Object.keys(meta).length!==keys.length||Object.keys(meta).some(key=>!keys.includes(key))
   ||Object.entries(expected).some(([key,value])=>meta[key]!==value)||!hash(meta.documentSha256)||meta.byteLength!==value.size)return unavailable();
  return {id:value.id,version:value.version,byteLength:Number(value.size),documentSha256:meta.documentSha256};
 };
 await checkCurrent();
 let retainedInfo=await info(true);
 if(!retainedInfo){
  await checkCurrent();
  let rendered:Awaited<ReturnType<typeof renderCommercialPresentation>>;
  try{rendered=await renderCommercialPresentation(source.input,proposed,renderer);}
  catch{throw new AgreementPreparationUnavailable('RENDER_UNAVAILABLE');}
  if(rendered.document_bytes.length>maxBytes||!await verifyRetainedAgreementPdf(rendered.document_bytes,rendered.document_sha256)
   ||!(await inspectUploadedPdf(rendered.document_bytes)).ok)throw new AgreementPreparationUnavailable('RENDER_UNAVAILABLE');
  await checkCurrent();
  try{await bucket.upload(path,rendered.document_bytes,{contentType:'application/pdf',upsert:false,cacheControl:'0',
   metadata:{...expected,documentSha256:rendered.document_sha256,byteLength:rendered.document_bytes.length}});}
  catch{/* Only exact original metadata and actual readback can establish storage. */}
  // A concurrent exact request may win with another timestamped render. Adopt
  // only that same operation/source/actor's verified retained object and hash.
  retainedInfo=await info(false);
 }
 if(!retainedInfo)return unavailable();
 await checkCurrent();
 let retained:Awaited<ReturnType<typeof bucket.download>>;
 try{retained=await bucket.download(path);}catch{return unavailable();}
 if(retained.error||!retained.data||retained.data.size!==retainedInfo.byteLength)return unavailable();
 let bytes:Uint8Array;
 try{bytes=new Uint8Array(await retained.data.arrayBuffer());}catch{return unavailable();}
 if(bytes.length!==retainedInfo.byteLength||!await verifyRetainedAgreementPdf(bytes,retainedInfo.documentSha256)
  ||!(await inspectUploadedPdf(bytes)).ok)return unavailable();
 const after=await info(false);
 if(!after||after.id!==retainedInfo.id||after.version!==retainedInfo.version||after.byteLength!==retainedInfo.byteLength||after.documentSha256!==retainedInfo.documentSha256)return unavailable();
 await checkCurrent();
 return {payload:proposed.payload,payload_digest:proposed.payload_digest,presented_body_markdown:presented,
  presented_body_sha256:presentedHash,content_storage_key:path,document_sha256:retainedInfo.documentSha256};
}
