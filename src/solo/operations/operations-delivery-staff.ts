import { supabase } from "@/integrations/supabase/client";
export type StaffDeliveryScope={actorId:string;tenantId:string;workItemId:string;planId:string;clientId:string;workUpdatedAt:string};
export type StaffSubmission={id:string;tenant_id:string;work_item_id:string;plan_id:string;client_id:string;artifact_version_id:string;artifact_digest:string;revision_no:number;submitted_by:string;submitted_at:string;reviewer_user_id:string;state:"in_review"|"revision_requested"|"approved";review_note:string|null;reviewed_by:string|null;reviewed_at:string|null;updated_at:string};
export type StaffClientRelease={release_id:string;submission_id:string;state:"awaiting_client"|"client_revision_requested"|"accepted";released_by:string;released_at:string;decision_by:string|null;decision_at:string|null;client_note:string|null;updated_at:string};
type RpcName="operations_delivery_list_scoped"|"operations_delivery_client_status_scoped"|"operations_delivery_submit_scoped"|"operations_delivery_review_scoped"|"operations_delivery_release_scoped";
export type StaffDeliveryCaller={getActor:()=>Promise<string|null>;rpc:(name:RpcName,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
export const staffDeliveryCaller:StaffDeliveryCaller={getActor:async()=>{const result=await supabase.auth.getSession();return result.error?null:result.data.session?.user.id??null;},rpc:(name,args)=>(supabase as unknown as StaffDeliveryCaller).rpc(name,args)};
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const instant=(value:unknown):value is string=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const nullableNote=(value:unknown)=>value===null||(typeof value==="string"&&value.length<=4000);
const validScope=(s:StaffDeliveryScope)=>[s.actorId,s.tenantId,s.workItemId,s.planId,s.clientId].every(uuid)&&instant(s.workUpdatedAt);
/** Strict projections of the existing scoped readers; no task/artifact/client authority is created. */
export function parseStaffSubmissions(value:unknown,scope:StaffDeliveryScope):StaffSubmission[]|null{
 const envelope=object(value);if(!validScope(scope)||envelope?.work_item_id!==scope.workItemId||!Array.isArray(envelope.submissions))return null;
 const rows:StaffSubmission[]=[];const ids=new Set<string>(),revisions=new Set<number>();
 for(const candidate of envelope.submissions){const r=object(candidate);
  if(!r||![r.id,r.artifact_version_id,r.submitted_by,r.reviewer_user_id].every(uuid)||r.tenant_id!==scope.tenantId||r.work_item_id!==scope.workItemId||r.plan_id!==scope.planId||r.client_id!==scope.clientId
   ||typeof r.artifact_digest!=="string"||!/^[a-f0-9]{64}$/.test(r.artifact_digest)||!Number.isSafeInteger(r.revision_no)||Number(r.revision_no)<1
   ||typeof r.state!=="string"||!["in_review","revision_requested","approved"].includes(r.state)||r.submitted_by===r.reviewer_user_id
   ||!instant(r.submitted_at)||!instant(r.updated_at)||!nullableNote(r.review_note))return null;
  if(r.state==="in_review"?(r.reviewed_by!==null||r.reviewed_at!==null||r.review_note!==null):(r.reviewed_by!==r.reviewer_user_id||!instant(r.reviewed_at)))return null;
  if(r.state==="revision_requested"&&(typeof r.review_note!=="string"||!r.review_note.trim()))return null;
  if(ids.has(r.id as string)||revisions.has(Number(r.revision_no)))return null;ids.add(r.id as string);revisions.add(Number(r.revision_no));
  rows.push({id:r.id as string,tenant_id:scope.tenantId,work_item_id:scope.workItemId,plan_id:scope.planId,client_id:scope.clientId,artifact_version_id:r.artifact_version_id as string,artifact_digest:r.artifact_digest,revision_no:Number(r.revision_no),submitted_by:r.submitted_by as string,submitted_at:r.submitted_at,reviewer_user_id:r.reviewer_user_id as string,state:r.state as StaffSubmission["state"],review_note:r.review_note as string|null,reviewed_by:r.reviewed_by as string|null,reviewed_at:r.reviewed_at as string|null,updated_at:r.updated_at});
 }return rows.sort((a,b)=>b.revision_no-a.revision_no);
}
export function parseStaffClientReleases(value:unknown,scope:StaffDeliveryScope,submissions:StaffSubmission[]):StaffClientRelease[]|null{
 const envelope=object(value);if(envelope?.work_item_id!==scope.workItemId||!Array.isArray(envelope.client_releases))return null;
 const rows:StaffClientRelease[]=[];const ids=new Set<string>(),submitted=new Set<string>();
 for(const candidate of envelope.client_releases){const r=object(candidate);
  if(!r||![r.release_id,r.submission_id,r.released_by].every(uuid)||!submissions.some(s=>s.id===r.submission_id&&s.state==="approved")
   ||typeof r.state!=="string"||!["awaiting_client","client_revision_requested","accepted"].includes(r.state)||!instant(r.released_at)||!instant(r.updated_at)||!nullableNote(r.client_note))return null;
  if(r.state==="awaiting_client"?(r.decision_by!==null||r.decision_at!==null||r.client_note!==null):(!uuid(r.decision_by)||!instant(r.decision_at)))return null;
  if(r.state==="client_revision_requested"&&(typeof r.client_note!=="string"||!r.client_note.trim()))return null;
  if(ids.has(r.release_id as string)||submitted.has(r.submission_id as string))return null;ids.add(r.release_id as string);submitted.add(r.submission_id as string);
  rows.push({release_id:r.release_id as string,submission_id:r.submission_id as string,state:r.state as StaffClientRelease["state"],released_by:r.released_by as string,released_at:r.released_at,decision_by:r.decision_by as string|null,decision_at:r.decision_at as string|null,client_note:r.client_note as string|null,updated_at:r.updated_at});
 }return rows;
}
export type StaffDeliveryRead={kind:"ready";submissions:StaffSubmission[];releases:StaffClientRelease[]}|{kind:"unavailable"|"refused"|"scope_changed"};
export async function readStaffDelivery(caller:StaffDeliveryCaller,scope:StaffDeliveryScope,isCurrent:()=>boolean):Promise<StaffDeliveryRead>{
 if(!isCurrent())return{kind:"scope_changed"};if(!validScope(scope))return{kind:"unavailable"};
 try{if(await caller.getActor()!==scope.actorId)return{kind:"refused"};
  const args={p_work_item_id:scope.workItemId,p_expected_actor_id:scope.actorId,p_expected_tenant_id:scope.tenantId};
  const internal=await caller.rpc("operations_delivery_list_scoped",args);if(!isCurrent())return{kind:"scope_changed"};if(internal.error)return{kind:"unavailable"};
  const submissions=parseStaffSubmissions(internal.data,scope);if(!submissions)return{kind:"unavailable"};
  const client=await caller.rpc("operations_delivery_client_status_scoped",args);if(!isCurrent())return{kind:"scope_changed"};
  if(client.error||await caller.getActor()!==scope.actorId)return{kind:"unavailable"};const releases=parseStaffClientReleases(client.data,scope,submissions);
  return isCurrent()&&releases?{kind:"ready",submissions,releases}:isCurrent()?{kind:"unavailable"}:{kind:"scope_changed"};
 }catch{return{kind:isCurrent()?"unavailable":"scope_changed"};}
}
export type StaffDeliveryAction={kind:"submit";artifactVersionId:string;reviewerId:string;expectedRevisionNo:number}|{kind:"review";submission:StaffSubmission;decision:"approved"|"revision_requested";note:string|null}|{kind:"release";submission:StaffSubmission};
export type StaffDeliveryWrite={kind:"verified";readback:Extract<StaffDeliveryRead,{kind:"ready"}>}|{kind:"invalid"|"refused"|"unverified"|"scope_changed"};
/** Existing domain writers, then independent canonical readback. Never retries or calls a provider. */
export async function writeStaffDelivery(caller:StaffDeliveryCaller,scope:StaffDeliveryScope,action:StaffDeliveryAction,isCurrent:()=>boolean):Promise<StaffDeliveryWrite>{
 if(!isCurrent())return{kind:"scope_changed"};if(!validScope(scope))return{kind:"invalid"};
 const bound={p_expected_actor_id:scope.actorId,p_expected_tenant_id:scope.tenantId};let name:RpcName,args:Record<string,unknown>;
 if(action.kind==="submit"){
  if(!uuid(action.artifactVersionId)||!uuid(action.reviewerId)||action.reviewerId===scope.actorId||!Number.isSafeInteger(action.expectedRevisionNo)||action.expectedRevisionNo<0)return{kind:"invalid"};
  name="operations_delivery_submit_scoped";args={...bound,p_work_item_id:scope.workItemId,p_artifact_version_id:action.artifactVersionId,p_reviewer_user_id:action.reviewerId,p_expected_work_updated_at:scope.workUpdatedAt,p_expected_revision_no:action.expectedRevisionNo};
 }else{
  const row=action.submission;if(!parseStaffSubmissions({work_item_id:scope.workItemId,submissions:[row]},scope))return{kind:"invalid"};
  if(action.kind==="review"){
   if(row.state!=="in_review"||row.reviewer_user_id!==scope.actorId||row.submitted_by===scope.actorId||!["approved","revision_requested"].includes(action.decision)||!nullableNote(action.note)||(action.decision==="revision_requested"&&!action.note?.trim()))return{kind:"invalid"};
   name="operations_delivery_review_scoped";args={...bound,p_submission_id:row.id,p_expected_updated_at:row.updated_at,p_decision:action.decision,p_note:action.note?.trim()||null};
  }else{if(row.state!=="approved")return{kind:"invalid"};name="operations_delivery_release_scoped";args={...bound,p_submission_id:row.id,p_expected_updated_at:row.updated_at};}
 }
 try{if(await caller.getActor()!==scope.actorId)return{kind:"refused"};if(!isCurrent())return{kind:"scope_changed"};
  const response=await caller.rpc(name,args);if(!isCurrent())return{kind:"scope_changed"};
  if(response.error){const error=object(response.error);return{kind:typeof error?.code==="string"&&["42501","40001","22023"].includes(error.code)?"refused":"unverified"};}
  const ack=object(response.data);if(ack?.ok!==true)return{kind:"unverified"};
  if(action.kind==="submit"?(!uuid(ack.submission_id)||ack.state!=="in_review"||ack.revision_no!==action.expectedRevisionNo+1):action.kind==="review"?(ack.submission_id!==action.submission.id||ack.state!==action.decision):(!uuid(ack.release_id)||ack.state!=="awaiting_client"))return{kind:"unverified"};
  const readback=await readStaffDelivery(caller,scope,isCurrent);if(readback.kind!=="ready")return{kind:readback.kind==="scope_changed"?"scope_changed":"unverified"};
  if(action.kind==="submit"){
   if(!readback.submissions.some(s=>s.id===ack.submission_id&&s.revision_no===action.expectedRevisionNo+1&&s.state==="in_review"&&s.artifact_version_id===action.artifactVersionId&&s.submitted_by===scope.actorId&&s.reviewer_user_id===action.reviewerId))return{kind:"unverified"};
  }else{
   const original=action.submission;const saved=readback.submissions.find(s=>s.id===original.id&&s.artifact_version_id===original.artifact_version_id&&s.artifact_digest===original.artifact_digest&&s.revision_no===original.revision_no);
   if(!saved)return{kind:"unverified"};
   if(action.kind==="review"?(saved.state!==action.decision||saved.reviewed_by!==scope.actorId||saved.review_note!==(action.note?.trim()||null)):(saved.state!=="approved"||!readback.releases.some(r=>r.release_id===ack.release_id&&r.submission_id===saved.id&&r.released_by===scope.actorId)))return{kind:"unverified"};
  }return{kind:"verified",readback};
 }catch{return{kind:isCurrent()?"unverified":"scope_changed"};}
}
