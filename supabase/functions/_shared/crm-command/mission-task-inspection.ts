import {parseExecutorError} from './executor-error.ts';
type RpcPort={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const failure=(status:number,code:string)=>({status,body:{inspection:true,ok:false,code}});

/** Read-only branch of SAME authenticated CRM door. Native reader retains actor admission.
 * No execution, approval, source read, result-store mutation or public RPC is added.
 */
export async function inspectMissionTask(input:{raw:unknown;actorId:string;caller:RpcPort;admin:RpcPort}):Promise<{status:number;body:Record<string,unknown>}> {
 const raw=input.raw;
 if(!object(raw)||Object.keys(raw).length!==2||!uuid(raw.expected_tenant_id)||!object(raw.inspect_mission_task))return failure(400,'CRM_COMMAND_INVALID');
 const ref=raw.inspect_mission_task;
 if(Object.keys(ref).length!==2||!uuid(ref.mission_id)||!uuid(ref.step_id))return failure(400,'CRM_COMMAND_INVALID');
 const tenant=raw.expected_tenant_id;
 try{
  const before=await input.caller.rpc('current_user_tenant_id');
  if(before.error||!uuid(before.data))return failure(403,'CRM_TENANT_REQUIRED');
  if(before.data!==tenant)return failure(409,'CRM_ACTIVE_ACCOUNT_CHANGED');
  const result=await input.admin.rpc('read_crm_command_result',{_tenant_id:tenant,_actor_id:input.actorId,
   _command:{action:'task.inspect_mission_result',mission_id:ref.mission_id,step_id:ref.step_id},
   _idempotency_key:`mission-inspect:${ref.mission_id}:${ref.step_id}`});
  const after=await input.caller.rpc('current_user_tenant_id');
  if(after.error||after.data!==tenant)return failure(409,'CRM_ACTIVE_ACCOUNT_CHANGED');
  if(result.error){
   const {code}=parseExecutorError(result.error.message??'','CRM_READBACK_UNAVAILABLE');
   return failure(code==='CRM_FORBIDDEN'||code==='CRM_TENANT_SUSPENDED'?403:code==='CRM_ACTIVE_ACCOUNT_CHANGED'?409:503,code);
  }
  const data=result.data;
  if(!object(data)||data.inspection!==true)return failure(503,'CRM_READBACK_UNAVAILABLE');
  if(['not_created','historical_unavailable','ambiguous'].includes(String(data.status)))return {status:200,body:{inspection:true,status:data.status}};
  const task=data.task,origin=data.origin,receipt=data.receipt;
  if(data.status!=='available'||!object(task)||task.tenant_id!==tenant||!uuid(task.id)||!uuid(task.assignee_user_id)
   ||typeof task.title!=='string'||!(task.description===null||typeof task.description==='string')
   ||!['pending','in_progress','completed','cancelled'].includes(String(task.status))||typeof task.updated_at!=='string'
   ||!Number.isFinite(Date.parse(task.updated_at))||!(task.due_date===null||typeof task.due_date==='string'&&Number.isFinite(Date.parse(task.due_date)))
   ||!object(receipt)||receipt.receipt_recorded!==true||!uuid(receipt.correlation_id)
   ||!object(origin)||origin.contractVersion!==1||origin.missionId!==ref.mission_id||origin.stepId!==ref.step_id
   ||!Number.isSafeInteger(origin.missionRevision)||Number(origin.missionRevision)<1||!Number.isSafeInteger(origin.briefVersion)||Number(origin.briefVersion)<1
   ||typeof origin.intentSha256!=='string'||!/^[0-9a-f]{64}$/.test(origin.intentSha256)||!Array.isArray(origin.sources)
   ||origin.sources.length<1||origin.sources.length>20||origin.sources.some(s=>!object(s)||s.contractVersion!==1||s.tenantId!==tenant||!uuid(s.documentId)
     ||!Number.isSafeInteger(s.revision)||Number(s.revision)<1||typeof s.contentSha256!=='string'||!/^[0-9a-f]{64}$/.test(s.contentSha256)))return failure(503,'CRM_READBACK_UNAVAILABLE');
  return {status:200,body:{inspection:true,status:'available',task:{id:task.id,tenant_id:tenant,title:task.title,description:task.description,status:task.status,
   assignee_user_id:task.assignee_user_id,due_date:task.due_date,updated_at:task.updated_at},
   origin:{contractVersion:1,missionId:origin.missionId,missionRevision:origin.missionRevision,briefVersion:origin.briefVersion,intentSha256:origin.intentSha256,stepId:origin.stepId,
    sources:origin.sources.map(s=>{const r=s as Record<string,unknown>;return {contractVersion:1,tenantId:tenant,documentId:r.documentId,revision:r.revision,contentSha256:r.contentSha256};})},
   receipt:{receipt_recorded:true,correlation_id:receipt.correlation_id,created_at:receipt.created_at}}};
 }catch{return failure(503,'CRM_READBACK_UNAVAILABLE');}
}
