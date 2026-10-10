import { supabase } from "@/integrations/supabase/client";
import type { PlanItemStatus } from "@/hooks/usePlanList";
import { crmActionForStage, type CrmWorkRecord } from "./operations-native-work";

export type CrmWorkStageOperation = Readonly<{
  actorId:string; tenantId:string; key:string; taskId:string; targetStatus:CrmWorkRecord["status"];
  command:Readonly<{action:"task.update"|"task.complete"|"task.reopen";task_id:string;expected_updated_at:string;patch?:Readonly<{status:"in_progress"}>}>;
}>;
export type CrmWorkCommandResult =
  | {kind:"approval";fingerprint:string;summary:string}
  | {kind:"acknowledged"}
  | {kind:"refused"|"uncertain";message:string};
const object=(value:unknown):value is Record<string,unknown> => Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const uncertain=():CrmWorkCommandResult=>({kind:"uncertain",message:"The result is unknown. Recover the original action before starting another."});

/** An exact command for the existing CRM executor, not another task writer. */
export function buildCrmWorkStageOperation(record:CrmWorkRecord,stage:PlanItemStatus,actorId:string,tenantId:string,key:string):CrmWorkStageOperation|null {
  if(!actorId||!tenantId||record.tenant_id!==tenantId||!key||key.length>192)return null;
  const action=crmActionForStage(record,stage);
  const version=record.updated_at??record.created_at;
  if(!action||!version)return null;
  const command=Object.freeze({action,task_id:record.id,expected_updated_at:version,
    ...(action==="task.update"?{patch:Object.freeze({status:"in_progress" as const})}:{})});
  return Object.freeze({actorId,tenantId,key,taskId:record.id,
    targetStatus:stage==="done"?"completed":stage==="open"?"pending":"in_progress",command});
}

/** Browser recovery metadata is never authority and cannot broaden this caller's actions. */
export function restoreCrmWorkStageOperation(value:unknown,actorId:string,tenantId:string):CrmWorkStageOperation|null {
  if(!object(value)||value.actorId!==actorId||value.tenantId!==tenantId||typeof value.key!=="string"||
    !value.key||value.key.length>192||typeof value.taskId!=="string"||!value.taskId||!object(value.command))return null;
  const command=value.command;
  if(command.task_id!==value.taskId||typeof command.expected_updated_at!=="string"||!Number.isFinite(Date.parse(command.expected_updated_at)))return null;
  const actions={"task.complete":"completed","task.reopen":"pending","task.update":"in_progress"} as const;
  if(typeof command.action!=="string"||!Object.prototype.hasOwnProperty.call(actions,command.action))return null;
  const action=command.action as keyof typeof actions;
  if(value.targetStatus!==actions[action]||Object.keys(command).some(key=>!["action","task_id","expected_updated_at","patch"].includes(key)))return null;
  if(action==="task.update"){
    if(!object(command.patch)||command.patch.status!=="in_progress"||Object.keys(command.patch).length!==1)return null;
  }else if(command.patch!==undefined)return null;
  return Object.freeze({actorId,tenantId,key:value.key,taskId:value.taskId,targetStatus:actions[action],
    command:Object.freeze({action,task_id:value.taskId,expected_updated_at:command.expected_updated_at,
      ...(action==="task.update"?{patch:Object.freeze({status:"in_progress" as const})}:{})})});
}

/** The UI must confirm first. Trust, CAS, idempotency and Rail remain in crm-command.
 * A bounded executor readback acknowledges the request; the caller must still refresh
 * the independently scoped native read before showing a saved stage.
 */
export async function submitCrmWorkStageOperation(operation:CrmWorkStageOperation,approvedFingerprint?:string):Promise<CrmWorkCommandResult> {
  let dispatched=false;
  try {
    const before=await supabase.auth.getUser();
    if(before.error||before.data.user?.id!==operation.actorId)return {kind:"refused",message:"Account changed. Reopen this task in the intended workspace."};
    dispatched=true;
    let {data,error}=await supabase.functions.invoke("crm-command",{body:{
      expected_tenant_id:operation.tenantId,command:operation.command,idempotency_key:operation.key,
      ...(approvedFingerprint?{approved_fingerprint:approvedFingerprint}:{})}});
    if(error&&"context" in error&&error.context instanceof Response){
      try {data=await error.context.json();error=null;}catch {return uncertain();}
    }
    const after=await supabase.auth.getUser();
    if(after.error||after.data.user?.id!==operation.actorId)return uncertain();
    if(error||!object(data))return uncertain();
    if(data.outcome==="approval_required"&&typeof data.fingerprint==="string"&&data.fingerprint.length>0)
      return {kind:"approval",fingerprint:data.fingerprint,summary:typeof data.summary==="string"?data.summary:"Review the proposed task change."};
    if(data.ok===true){
      const read=data.readback;
      if(!object(read)||read.id!==operation.taskId||read.status!==operation.targetStatus||
        read.external_effect!==false||read.notification_sent!==false||typeof read.updated_at!=="string"||!Number.isFinite(Date.parse(read.updated_at)))return uncertain();
      return {kind:"acknowledged"};
    }
    if(data.outcome_unknown===true)return uncertain();
    return {kind:"refused",message:"The task change was refused. Refresh its current details and review your permissions."};
  }catch{return dispatched?uncertain():{kind:"refused",message:"Your account could not be verified. Reopen this task before changing it."};}
}
