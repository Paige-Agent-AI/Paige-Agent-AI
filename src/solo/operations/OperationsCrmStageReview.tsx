import { useEffect, useRef, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import type { CrmWorkRecord } from "./operations-native-work";
import { restoreCrmWorkOperation, submitCrmWorkStageOperation, type CrmWorkOperation } from "./operations-crm-work-command";
import { crmWorkEditMatchesReadback } from "./operations-crm-work-edit";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";

/** A review caller of existing CRM Trust/CAS/Rail. Browser metadata retains only
 * an exact in-flight command; it stores no tasks, permissions or approval verdicts.
 */
export function OperationsCrmStageReview({ operation: requested, refresh, onClose, onVerified, members=[] }: {
  operation:CrmWorkOperation; refresh:()=>Promise<CrmWorkRecord[]|null>;
  onClose:()=>void; onVerified:(taskId:string)=>void;
  members?:TeamMemberRecord[];
}) {
  const context=useTenantContext();
  const storageKey=`paige:operations-crm-stage:${requested.actorId}:${requested.tenantId}`;
  const [operation]=useState(()=>{
    try {return restoreCrmWorkOperation(JSON.parse(sessionStorage.getItem(storageKey)??"null"),requested.actorId,requested.tenantId)??requested;}
    catch {return requested;}
  });
  const restored=operation!==requested;
  const [phase,setPhase]=useState<"review"|"busy"|"approval"|"uncertain"|"refused">(restored?"uncertain":"review");
  const [proposal,setProposal]=useState<{fingerprint:string;summary:string}|null>(null);
  const [notice,setNotice]=useState("");
  const alive=useRef(true),fence=useRef(false);
  const latest=useRef(context);latest.current=context;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const matches=()=>latest.current.accountContextStatus==="ready"&&latest.current.activeUserId===operation.actorId&&latest.current.activeTenantId===operation.tenantId;
  const forget=()=>{try {sessionStorage.removeItem(storageKey);}catch {/* No browser state confers authority. */}};
  const execute=async()=>{
    if(fence.current||!matches()||phase==="refused")return;
    fence.current=true;setPhase("busy");setNotice("");
    // Save before dispatch so closing the drawer or losing the response cannot
    // turn recovery into a fresh mutation with a new idempotency key.
    try {sessionStorage.setItem(storageKey,JSON.stringify(operation));}
    catch {fence.current=false;setPhase("refused");setNotice("This browser cannot retain action recovery. Allow workspace storage before changing this task.");return;}
    try {
      const result=await submitCrmWorkStageOperation(operation,phase==="approval"?proposal?.fingerprint:undefined);
      if(!alive.current||!matches())return;
      if(result.kind==="approval") {setProposal(result);setPhase("approval");return;}
      setProposal(null);
      if(result.kind!=="acknowledged"){
        if(result.kind==="refused")forget();
        setPhase(result.kind);setNotice(result.message);return;
      }
      const records=await refresh();
      if(!alive.current||!matches())return;
      const current=records?.find(task=>task.id===operation.taskId&&task.tenant_id===operation.tenantId);
      if(!current||!current.updated_at||("targetStatus" in operation?current.status!==operation.targetStatus:!crmWorkEditMatchesReadback(operation,current))){
        setPhase("uncertain");setNotice("The executor responded, but current work has not confirmed this change. Recover the original action before making another change.");return;
      }
      forget();onVerified(operation.taskId);
    }catch {if(alive.current&&matches()){setProposal(null);setPhase("uncertain");setNotice("Current work could not be confirmed. Recover the original action.");}}
    finally {fence.current=false;}
  };
  const changed=!matches();
  const stage="targetStatus" in operation;
  const assignmentId=!stage&&operation.target.kind==="assignment"?operation.target.assigneeId:null;
  const summary=stage?(operation.targetStatus==="in_progress"?"Move this task to In progress.":`Move this task to ${operation.targetStatus === "pending" ? "Ready" : "Completed"}. Internal completion does not record client acceptance.`):
    operation.target.kind==="assignment"?"Change the responsible person for this task.":
    operation.target.dueAt===null?"Remove the recorded due date from this task.":`Set this task’s due date to ${new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(operation.target.dueAt))}.`;
  return <section className="ops-work-editor" aria-busy={phase==="busy"} aria-label={stage?"Review task stage change":"Review task assignment or due date"}>
    <h3>{restored?"Recover the earlier task change":stage?"Review the stage change":"Review the task change"}</h3>
    <p>{proposal?.summary??summary}</p>
    {assignmentId&&<div><span>New responsible person</span>{members.some(person=>person.user_id===assignmentId)?<OperationsAssignee member={members.find(person=>person.user_id===assignmentId)} />:<p>Member unavailable in the current team read.</p>}</div>}
    {restored&&operation.taskId!==requested.taskId&&<p role="status">An earlier task change needs recovery. The newly selected task has not been changed.</p>}
    {notice&&<p role="alert">{notice}</p>}
    {changed&&<p role="alert">Account or workspace changed. Recover this action in its original workspace.</p>}
    <div className="ops-work-editor-actions">
      <button className="ops-action-primary" type="button" disabled={phase==="busy"||phase==="refused"||changed} onClick={()=>void execute()}>
        {phase==="busy"?"Checking current work…":phase==="uncertain"?"Recover original action":phase==="approval"?"Approve exact change":stage?"Confirm stage change":"Confirm task change"}
      </button>
      <button type="button" disabled={phase==="busy"} onClick={()=>{if(phase!=="uncertain")forget();onClose();}}>
        {phase==="uncertain"?"Close · recovery retained":"Back to details"}
      </button>
    </div>
  </section>;
}
