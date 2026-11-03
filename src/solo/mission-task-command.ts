import {supabase} from '@/integrations/supabase/client';
import type {BusinessMissionDetail,DocumentWorkStep} from '@/types/businessMission';
import {normalizeDocumentWorkIntent} from '../../supabase/functions/_shared/business-mission-document-intent';
export type MissionTaskSchedule={dueAt:string|null;timeZone:string|null;reason:string|null};
export type MissionTaskOperation={actorId:string;tenantId:string;key:string;command:{action:'task.create';patch:{title:string;description:string;assignee_user_id:string;due_date:string|null;metadata:{mission_source_v1:{contractVersion:1;missionId:string;missionRevision:number;briefVersion:number;intentSha256:string;stepId:string;schedule:MissionTaskSchedule}}}}};
export type MissionTaskInspection={kind:'available';task:{id:string;title:string;description:string|null;status:string;assignee_user_id:string;due_date:string|null;updated_at:string};origin:{missionRevision:number;briefVersion:number;intentSha256:string};receipt:{correlation_id:string}}
 | {kind:'not_created'|'historical_unavailable'|'ambiguous'}|{kind:'unavailable';message:string};
export type MissionTaskSubmission={kind:'approval';fingerprint:string;summary:string}|{kind:'acknowledged'}|{kind:'uncertain'|'refused';message:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const unknownResult=():MissionTaskSubmission=>({kind:'uncertain',message:'The result is unknown. Check the original task before doing anything else.'});
export function missionTaskNotice(code:unknown):string {
 if(code==='CRM_MISSION_TASK_EXISTS')return 'This step already has a task. Check the original task.';
 if(code==='CRM_MISSION_PREVIOUS_EFFECT_UNAVAILABLE')return 'This step has an earlier committed result. It cannot create another task.';
 if(code==='CRM_ACTIVE_ACCOUNT_CHANGED')return 'The workspace changed. Reopen this plan in the intended workspace.';
 if(['CRM_MISSION_PLAN_CHANGED','CRM_MISSION_STEP_CHANGED','CRM_MISSION_SOURCE_CHANGED'].includes(String(code)))return 'The saved plan or source changed. Reopen and review the current plan before creating work.';
 if(code==='CRM_MISSION_NOT_ACTIVE')return 'Activate the reviewed plan before creating its tasks.';
 if(code==='CRM_MISSION_SOURCE_BUSY')return 'The source is busy. Check the original task, then review again.';
 return 'The task could not be verified. Reopen the plan and check your current access.';
}
/** Same native command, whole-command approval and idempotency. No Task writer here. */
export function buildMissionTaskOperation(detail:BusinessMissionDetail,stepId:string,actorId:string,tenantId:string,schedule:MissionTaskSchedule):MissionTaskOperation|null {
 const intent=normalizeDocumentWorkIntent(detail.brief.document_work_intent,tenantId);
 if(!uuid(actorId)||!uuid(tenantId)||!uuid(detail.mission.id)||detail.mission.state!=='active'||detail.brief.document_work_intent_status!=='available'
  ||!Number.isSafeInteger(detail.mission.revision)||detail.mission.revision<1||!Number.isSafeInteger(detail.brief.version)||detail.brief.version<1
  ||typeof detail.brief.document_work_intent_hash!=='string'||!/^[0-9a-f]{64}$/.test(detail.brief.document_work_intent_hash)||!intent.ok||!intent.intent)return null;
 const step=intent.intent.steps.find(s=>s.id===stepId);
 if(!step||schedule.dueAt===null&&(schedule.timeZone!==null||schedule.reason!==null))return null;
 if(schedule.dueAt!==null){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(schedule.dueAt)||!Number.isFinite(Date.parse(schedule.dueAt))||new Date(schedule.dueAt).toISOString()!==schedule.dueAt
    ||!schedule.timeZone||!schedule.reason?.trim()||schedule.reason.length>1000)return null;
  try{new Intl.DateTimeFormat('en',{timeZone:schedule.timeZone}).format();}catch{return null;}
 }
 const who=step.proposedTask.assigneeUserId??actorId;
 return {actorId,tenantId,key:`mission-step:${detail.mission.id}:${step.id}:create`,command:{action:'task.create',patch:{title:step.title,description:step.description,
  assignee_user_id:who,due_date:schedule.dueAt,metadata:{mission_source_v1:{contractVersion:1,missionId:detail.mission.id,missionRevision:detail.mission.revision,
   briefVersion:detail.brief.version,intentSha256:detail.brief.document_work_intent_hash,stepId:step.id,schedule:{...schedule}}}}}};
}
export function parseMissionTaskLocalDate(value:string,reason:string):MissionTaskSchedule|null {
 if(!value)return {dueAt:null,timeZone:null,reason:null};
 const p=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value),d=new Date(value);
 if(!p||!Number.isFinite(d.getTime())||d.getFullYear()!==+p[1]||d.getMonth()+1!==+p[2]||d.getDate()!==+p[3]||d.getHours()!==+p[4]||d.getMinutes()!==+p[5]||!reason.trim()||reason.length>1000)return null;
 return {dueAt:d.toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,reason:reason.trim()};
}
async function invoke(body:Record<string,unknown>,actorId:string){
 const before=await supabase.auth.getUser();
 if(before.error||before.data.user?.id!==actorId)throw Error('CRM_ACTIVE_ACCOUNT_CHANGED');
 let {data,error}=await supabase.functions.invoke('crm-command',{body});
 if(error&&'context' in error&&error.context instanceof Response){try{data=await error.context.json();error=null;}catch{throw Error('CRM_READBACK_UNAVAILABLE');}}
 const after=await supabase.auth.getUser();
 if(after.error||after.data.user?.id!==actorId||error||!object(data))throw Error('CRM_READBACK_UNAVAILABLE');
 return data;
}
/** Inspection never submits a command for execution, including after a lost response. */
export async function inspectMissionTaskEffect(actorId:string,tenantId:string,missionId:string,stepId:string):Promise<MissionTaskInspection>{
 if(![actorId,tenantId,missionId,stepId].every(uuid))return {kind:'unavailable',message:'Reopen the current saved plan.'};
 try{
  const r=await invoke({expected_tenant_id:tenantId,inspect_mission_task:{mission_id:missionId,step_id:stepId}},actorId);
  if(r.inspection!==true)return {kind:'unavailable',message:missionTaskNotice(r.code)};
  if(r.status==='not_created'||r.status==='historical_unavailable'||r.status==='ambiguous')return {kind:r.status};
  const t=r.task,o=r.origin,receipt=r.receipt;
  if(r.status!=='available'||!object(t)||t.tenant_id!==tenantId||!uuid(t.id)||typeof t.title!=='string'||!(t.description===null||typeof t.description==='string')
   ||!uuid(t.assignee_user_id)||typeof t.status!=='string'||typeof t.updated_at!=='string'||!Number.isFinite(Date.parse(t.updated_at))
   ||!(t.due_date===null||typeof t.due_date==='string')||!object(o)||o.missionId!==missionId||o.stepId!==stepId||!Number.isSafeInteger(o.missionRevision)||!Number.isSafeInteger(o.briefVersion)
   ||typeof o.intentSha256!=='string'||!object(receipt)||receipt.receipt_recorded!==true||!uuid(receipt.correlation_id))return {kind:'unavailable',message:'The original task readback was incomplete. Check again before creating work.'};
  return {kind:'available',task:{id:t.id,title:t.title,description:t.description as string|null,status:t.status,assignee_user_id:t.assignee_user_id,due_date:t.due_date as string|null,updated_at:t.updated_at},
   origin:{missionRevision:Number(o.missionRevision),briefVersion:Number(o.briefVersion),intentSha256:o.intentSha256},receipt:{correlation_id:receipt.correlation_id}};
 }catch{return {kind:'unavailable',message:'The original task could not be checked. No new task was requested.'};}
}
export async function submitMissionTaskOperation(operation:MissionTaskOperation,approvedFingerprint?:string):Promise<MissionTaskSubmission>{
 try{
  const r=await invoke({expected_tenant_id:operation.tenantId,command:operation.command,idempotency_key:operation.key,...(approvedFingerprint?{approved_fingerprint:approvedFingerprint}:{})},operation.actorId);
  if(r.outcome==='approval_required'&&typeof r.fingerprint==='string'&&r.fingerprint.length>0)return {kind:'approval',fingerprint:r.fingerprint,summary:typeof r.summary==='string'?r.summary:'Review the exact task.'};
  if(r.ok===true){
   const t=r.readback,o=r.mission_source_v1,b=operation.command.patch.metadata.mission_source_v1;
   if(!object(t)||!uuid(t.id)||t.title!==operation.command.patch.title||t.description!==operation.command.patch.description||t.assignee_user_id!==operation.command.patch.assignee_user_id
    ||(operation.command.patch.due_date===null?t.due_date!==null:typeof t.due_date!=='string'||Date.parse(t.due_date)!==Date.parse(operation.command.patch.due_date))
    ||t.external_effect!==false||t.notification_sent!==false||r.receipt_recorded!==true||!uuid(r.correlation_id)||!object(o)||o.missionId!==b.missionId||o.stepId!==b.stepId
    ||o.missionRevision!==b.missionRevision||o.briefVersion!==b.briefVersion||o.intentSha256!==b.intentSha256)return unknownResult();
   return {kind:'acknowledged'};
  }
  if(r.outcome_unknown===true||!['refused','setup_required'].includes(String(r.outcome)))return unknownResult();
  return {kind:'refused',message:missionTaskNotice(r.code)};
 }catch{return unknownResult();}
}
export const missionTaskAssignee=(step:DocumentWorkStep,actorId:string)=>step.proposedTask.assigneeUserId??actorId;
