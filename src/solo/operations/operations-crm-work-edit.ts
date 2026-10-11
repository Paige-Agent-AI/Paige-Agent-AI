import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import type { CrmWorkRecord } from "./operations-native-work";

export type CrmWorkEditTarget = Readonly<{kind:"assignment";assigneeId:string}|{kind:"due";dueAt:string|null}>;
type Scope=Readonly<{actorId:string;tenantId:string;key:string}>;
export type CrmWorkEditOperation = Scope & Readonly<{
  taskId:string; target:CrmWorkEditTarget;
  command:Readonly<{
    action:"task.assign"|"task.reschedule";task_id:string;expected_updated_at:string;
    patch:Readonly<{assignee_user_id:string}|{due_date:string|null}>;
  }>;
}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
// A full instant is required; date-only and locale/browser guesses are not due dates.
const instant=(value:unknown):value is string=>{
  if(typeof value!=="string"||!Number.isFinite(Date.parse(value)))return false;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!parts)return false;
  const [,year,month,day,hour,minute,second,,offsetHour="0",offsetMinute="0"]=parts;
  const leap=+year%4===0&&(+year%100!==0||+year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return +month>=1&&+month<=12&&+day>=1&&+day<=days[+month-1]&&+hour<24&&+minute<60&&+second<60&&+offsetHour<=14&&+offsetMinute<60&&(+offsetHour<14||+offsetMinute===0);
};
const sameInstant=(left:string|null,right:string|null)=>left===null||right===null?left===right:instant(left)&&instant(right)&&Date.parse(left)===Date.parse(right);

/** Proposal only. Existing CRM Trust/CAS/Rail and server authority remain required. */
export function buildCrmWorkEditOperation(record:CrmWorkRecord,target:CrmWorkEditTarget,scope:Scope,members:TeamMemberRecord[]):CrmWorkEditOperation|null {
  const version=record.updated_at??record.created_at;
  if(!scope.actorId||!scope.tenantId||record.tenant_id!==scope.tenantId||!record.id||!scope.key||scope.key.length>192||!instant(version))return null;
  if(target.kind==="assignment") {
    if(!uuid.test(target.assigneeId)||target.assigneeId===record.user_id||!members.some(person=>person.user_id===target.assigneeId&&person.status==="active"))return null;
    return Object.freeze({...scope,taskId:record.id,target:Object.freeze({...target}),command:Object.freeze({action:"task.assign",task_id:record.id,expected_updated_at:version,patch:Object.freeze({assignee_user_id:target.assigneeId})})});
  }
  if(target.dueAt!==null&&!instant(target.dueAt)||sameInstant(record.due_date,target.dueAt))return null;
  return Object.freeze({...scope,taskId:record.id,target:Object.freeze({...target}),command:Object.freeze({action:"task.reschedule",task_id:record.id,expected_updated_at:version,patch:Object.freeze({due_date:target.dueAt})})});
}

/** Recovery pins one supported command; stored metadata never proves permission. */
export function restoreCrmWorkEditOperation(value:unknown,actorId:string,tenantId:string):CrmWorkEditOperation|null {
  if(!object(value)||value.actorId!==actorId||value.tenantId!==tenantId||!actorId||!tenantId||typeof value.key!=="string"||!value.key||value.key.length>192||typeof value.taskId!=="string"||!value.taskId||!object(value.command)||!object(value.target))return null;
  const {command,target}=value;
  if(command.task_id!==value.taskId||!instant(command.expected_updated_at)||!object(command.patch)||Object.keys(command).some(key=>!["action","task_id","expected_updated_at","patch"].includes(key)))return null;
  const patch=command.patch;
  if(command.action==="task.assign"&&target.kind==="assignment"&&typeof target.assigneeId==="string"&&uuid.test(target.assigneeId)&&patch.assignee_user_id===target.assigneeId&&Object.keys(patch).length===1&&Object.keys(target).length===2)
    return Object.freeze({actorId,tenantId,key:value.key,taskId:value.taskId,target:Object.freeze({kind:"assignment",assigneeId:target.assigneeId}),command:Object.freeze({action:"task.assign",task_id:value.taskId,expected_updated_at:command.expected_updated_at,patch:Object.freeze({assignee_user_id:target.assigneeId})})});
  if(command.action==="task.reschedule"&&target.kind==="due"&&(target.dueAt===null||instant(target.dueAt))&&patch.due_date===target.dueAt&&Object.keys(patch).length===1&&Object.keys(target).length===2)
    return Object.freeze({actorId,tenantId,key:value.key,taskId:value.taskId,target:Object.freeze({kind:"due",dueAt:target.dueAt}),command:Object.freeze({action:"task.reschedule",task_id:value.taskId,expected_updated_at:command.expected_updated_at,patch:Object.freeze({due_date:target.dueAt})})});
  return null;
}

/** Independent source read after acknowledgement, not a completion/outcome claim. */
export function crmWorkEditMatchesReadback(operation:CrmWorkEditOperation,record:CrmWorkRecord):boolean {
  if(record.id!==operation.taskId||record.tenant_id!==operation.tenantId||!instant(record.updated_at))return false;
  return operation.target.kind==="assignment"?record.user_id===operation.target.assigneeId:sameInstant(record.due_date,operation.target.dueAt);
}
