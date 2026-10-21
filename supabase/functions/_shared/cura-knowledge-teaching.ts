import { stableRunId } from './capability-record.ts';
import { ExtractionError, ExtractionSubmissionUnknown, submitKnowledgeExtraction } from './knowledge-extraction.ts';
import { bindKnowledgeIngestScope, KnowledgeIngestScopeError, type KnowledgeScopeCaller } from './knowledge-ingest-scope.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CURA_TEACH_PURPOSE='cura_customer_knowledge';
/** Constructed by the verified owner handler, never from model arguments. The
 * original approval-resume association survives a fresh transport request. */
export type CuraTeachingScope={actorId:string;tenantId:string;threadId:string;requestIntentId:string;approvedAct?:string};
type Ports={caller:KnowledgeScopeCaller};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const refused=()=>({success:false,ok:false,not_applied:true,refused_before_run:true,
 error:'This preparation request was not accepted. Check the current business and Knowledge publishing permission. Earlier saved work is unchanged.'});
const uncertain=()=>({success:false,ok:false,outcome_unknown:true,
 note:'The private Knowledge preparation could not be confirmed. Check the existing Knowledge records before another attempt. Nothing has been published or shared with customers by this action.'});

function invalidEnvelope(scope:CuraTeachingScope,input:unknown):boolean {
 return ![scope.actorId,scope.tenantId,scope.threadId,scope.requestIntentId].every(v=>typeof v==='string'&&UUID.test(v))
  || (scope.approvedAct!==undefined&&(typeof scope.approvedAct!=='string'||!scope.approvedAct||scope.approvedAct.length>200||scope.approvedAct.includes('\0')))
  || !object(input)||input.purpose!==CURA_TEACH_PURPOSE
  || Object.keys(input).some(k=>!['purpose','title','content','summary','category','tags','confirm'].includes(k));
}
async function teachingIntent(scope:CuraTeachingScope){
 return stableRunId(['cura.knowledge.prepare.v1',scope.actorId.toLowerCase(),scope.tenantId.toLowerCase(),scope.threadId.toLowerCase(),scope.approvedAct??scope.requestIntentId.toLowerCase(),CURA_TEACH_PURPOSE]);
}

/** One native private extraction intent. This neither publishes/embeds Knowledge
 * nor grants CURA customer visibility; those remain the original reviewed flows.
 * No retry loop, provider call, table writer or alternate approval channel. */
export async function stageCuraKnowledge(scope:CuraTeachingScope,input:unknown,ports:Ports):Promise<Record<string,unknown>>{
 if(invalidEnvelope(scope,input)||!object(input))return refused();
 let dispatched=false,acknowledged=false;
 try{
  const identity=await ports.caller.auth.getUser();
  if(identity.error||identity.data.user?.id!==scope.actorId)return refused();
  // This existing caller-JWT reader admits only the original business publisher.
  // Its inventory is not copied to the model or treated as customer publication.
  const gate=await ports.caller.rpc('read_client_portal_business_knowledge',{
   p_tenant_id:scope.tenantId,p_query:null,p_offset:0,p_limit:1,p_document_id:null,
  });
  if(gate.error||!object(gate.data)||gate.data.tenant_id!==scope.tenantId||gate.data.audience!=='business')return refused();
  const intent=await teachingIntent(scope);
  // Original extraction helper independently revalidates actual JWT/current business
  // and the native submission freezes its payload under this stable intent.
  const result=await submitKnowledgeExtraction({intent_id:intent,expected_tenant:scope.tenantId,
   title:input.title,kind:'paste',content:input.content},ports.caller,{
   async rpc(name,args){
    if(name!=='submit_knowledge_extraction')throw new ExtractionError('unsupported_source');
    dispatched=true;
    // Actual JWT derives the actor again; publisher authority and original
    // extraction submission share the SAME locked native transaction.
    const acknowledgment=await ports.caller.rpc('submit_cura_knowledge_preparation',{
     p_tenant_id:args._tenant,p_intent_id:args._intent,p_title:args._title,p_input:args._input,
    });
    const error=acknowledgment.error;
    return {data:acknowledgment.data,error:!error?null:object(error)?{
     ...(typeof error.message==='string'?{message:error.message}:{}),
     ...(typeof error.code==='string'?{code:error.code}:{}),
    }:{message:'preparation_unavailable'}};
   },
  },async()=>{throw new ExtractionError('unsupported_source');});
  acknowledged=true;
  // Never publish a result into a different actor/business after a delayed call.
  const current=await ports.caller.auth.getUser(),profile=await ports.caller.readActiveTenant(scope.actorId);
  if(current.error||current.data.user?.id!==scope.actorId||profile.error||profile.data?.active_tenant_id!==scope.tenantId)return uncertain();
  const publisher=await ports.caller.rpc('read_client_portal_business_knowledge',{
   p_tenant_id:scope.tenantId,p_query:null,p_offset:0,p_limit:1,p_document_id:null,
  });
  if(publisher.error||!object(publisher.data)||publisher.data.tenant_id!==scope.tenantId||publisher.data.audience!=='business')return uncertain();
  const finalScope=await bindKnowledgeIngestScope(ports.caller,scope.tenantId);
  if(finalScope.userId!==scope.actorId)return uncertain();
  const r=result as {work_id:string;document_id:string;status:string;replayed:boolean;revision?:number};
  return {success:true,ok:true,accepted:true,prepared_for_cura:true,work_id:r.work_id,knowledge_doc_id:r.document_id,
   work_status:r.status,replayed:r.replayed,...(r.revision===undefined?{}:{document_revision:r.revision}),
   publication_changed:false,customer_visibility_changed:false,
   note:'The private Knowledge preparation request is recorded. Open this exact source for its current work, publication and sharing state; earlier work may have been reviewed since submission. This action does not publish, index or share it. Use the original review and CURA sharing controls for audience and availability dates.'};
 }catch(error){
  if(acknowledged)return uncertain();
  if(error instanceof ExtractionSubmissionUnknown)return uncertain();
  if(!dispatched||error instanceof ExtractionError||error instanceof KnowledgeIngestScopeError
   ||(error instanceof Error&&error.message==='extraction_not_accepted'))return refused();
  return uncertain();
 }
}

const preparationUnavailable=()=>({success:false,ok:false,availability:'unavailable',preparation_recorded:null,retry_authorized:false});
/** Read only. This cannot resubmit an extraction or settle a broader Chat hold.
 * The native reader independently enforces publisher authority under row locks. */
export async function observeCuraKnowledgePreparation(scope:CuraTeachingScope,input:unknown,caller:KnowledgeScopeCaller):Promise<Record<string,unknown>>{
 if(invalidEnvelope(scope,input)||!object(input)||typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>300
  ||typeof input.content!=='string'||!input.content||input.content.length>480000||input.content.includes('\0')
  ||new TextEncoder().encode(input.content).length>2097152)return preparationUnavailable();
 try{
  const boundary=await bindKnowledgeIngestScope(caller,scope.tenantId);
  if(boundary.userId!==scope.actorId)return preparationUnavailable();
  const result=await caller.rpc('read_cura_knowledge_preparation',{p_tenant_id:scope.tenantId,p_intent_id:await teachingIntent(scope),p_title:input.title.trim(),p_input:input.content});
  await boundary.assert();
  const r=result.data;
  if(result.error||!object(r)||r.contract_version!==1||r.tenant_id!==scope.tenantId||r.retry_authorized!==false)return preparationUnavailable();
  if(r.availability==='unavailable'){
   if(Object.keys(r).some(k=>!['contract_version','tenant_id','availability','preparation_recorded','retry_authorized'].includes(k))||r.preparation_recorded!==null)return preparationUnavailable();
   return preparationUnavailable();
  }
  if(r.availability!=='available'||r.preparation_recorded!==true||typeof r.work_id!=='string'||!UUID.test(r.work_id)
   ||typeof r.work_status!=='string'||!['claimed','blocked','expired','succeeded','failed','cancelled','outcome_unknown'].includes(r.work_status)
   ||typeof r.work_updated_at!=='string'||!Number.isFinite(Date.parse(r.work_updated_at))
   ||Object.keys(r).some(k=>!['contract_version','tenant_id','availability','preparation_recorded','retry_authorized','work_id','work_status','source_document_id','current_document_revision','work_updated_at'].includes(k)))return preparationUnavailable();
  if(r.source_document_id===null?r.current_document_revision!==null:
   typeof r.source_document_id!=='string'||!UUID.test(r.source_document_id)||!Number.isSafeInteger(r.current_document_revision)||Number(r.current_document_revision)<1)return preparationUnavailable();
  return {success:true,ok:true,availability:'available',preparation_recorded:true,work_id:r.work_id,work_status:r.work_status,
   knowledge_doc_id:r.source_document_id,current_document_revision:r.current_document_revision,work_updated_at:r.work_updated_at,retry_authorized:false,
   note:'The original private preparation record was found. This observation does not publish, share, retry work or clear any other interrupted action. Open its current source when available.'};
 }catch{return preparationUnavailable();}
}
