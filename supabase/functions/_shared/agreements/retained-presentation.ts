import {object} from '../sales-collections/primitives.ts';
import {canonicalPresentationJson,commercialPresentationText,prepareCommercialPresentation,type PreparedCommercialPresentation} from './commercial-presentation.ts';
/** Shared C1 reconstruction for retained and accepted owner reads. This verifies
 * the immutable capsule/text, not authority, actual PDF availability or signing. */
export async function decodeRetainedCommercialPresentation(payload:unknown,digest:unknown,body:unknown,presented:unknown):Promise<PreparedCommercialPresentation|null>{
 try{
  if(!object(payload)||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||typeof body!=='string'||typeof presented!=='string'||presented.length>300000)return null;
  const keys=['schema_version','source','title','body_sha256','principal_minor','currency','amount_basis','collection_terms','obligations','conditions','lines',...(payload.schema_version===2?['engagement']:[])];
  if(Object.keys(payload).some(key=>!keys.includes(key)))return null;
  const prepared=await prepareCommercialPresentation({schema_version:payload.schema_version,source:payload.source,title:payload.title,body_markdown:body,
   principal_minor:payload.principal_minor,currency:payload.currency,collection_terms:payload.collection_terms,conditions:payload.conditions,lines:payload.lines,
   ...(payload.schema_version===2?{engagement:payload.engagement}:{})});
  return prepared.payload_digest===digest&&canonicalPresentationJson(prepared.payload)===canonicalPresentationJson(payload)
   &&commercialPresentationText(body,prepared)===presented?prepared:null;
 }catch{return null;}
}
