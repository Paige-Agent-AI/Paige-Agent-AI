import { useEffect, useRef, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import type { CrmWorkRecord } from "./operations-native-work";
import { restoreCrmWorkStageOperation, submitCrmWorkStageOperation, type CrmWorkStageOperation } from "./operations-crm-work-command";

/** A review caller of existing CRM Trust/CAS/Rail. Browser metadata retains only
 * an exact in-flight command; it stores no tasks, permissions or approval verdicts.
 */
export function OperationsCrmStageReview({ operation: requested, refresh, onClose, onVerified }: {
  operation:CrmWorkStageOperation; refresh:()=>Promise<CrmWorkRecord[]|null>;
  onClose:()=>void; onVerified:(taskId:string)=>void;
}) {
  const context=useTenantContext();
  const storageKey=`paige:operations-crm-stage:${requested.actorId}:${requested.tenantId}`;
  const [operation]=useState(()=>{
    try {return restoreCrmWorkStageOperation(JSON.parse(sessionStorage.getItem(storageKey)??"null"),requested.actorId,requested.tenantId)??requested;}
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
      if(!current||current.status!==operation.targetStatus||!current.updated_at){
        setPhase("uncertain");setNotice("The executor responded, but current work has not confirmed this stage. Recover the original action before making another change.");return;
      }
      forget();onVerified(operation.taskId);
    }catch {if(alive.current&&matches()){setProposal(null);setPhase("uncertain");setNotice("Current work could not be confirmed. Recover the original action.");}}
    finally {fence.current=false;}
  };
  const changed=!matches();
  return <section className="ops-work-editor" aria-busy={phase==="busy"} aria-label="Review task stage change">
    <h3>{restored?"Recover the earlier task change":"Review the stage change"}</h3>
    <p>{proposal?.summary??`Move this task to ${operation.targetStatus === "pending" ? "Ready" : operation.targetStatus === "completed" ? "Completed" : "In progress"}. Internal completion does not record client acceptance.`}</p>
    {restored&&operation.taskId!==requested.taskId&&<p role="status">An earlier task change needs recovery. The newly selected task has not been changed.</p>}
    {notice&&<p role="alert">{notice}</p>}
    {changed&&<p role="alert">Account or workspace changed. Recover this action in its original workspace.</p>}
    <div className="ops-work-editor-actions">
      <button className="ops-action-primary" type="button" disabled={phase==="busy"||phase==="refused"||changed} onClick={()=>void execute()}>
        {phase==="busy"?"Checking current work…":phase==="uncertain"?"Recover original action":phase==="approval"?"Approve exact change":"Confirm stage change"}
      </button>
      <button type="button" disabled={phase==="busy"} onClick={()=>{if(phase!=="uncertain")forget();onClose();}}>
        {phase==="uncertain"?"Close · recovery retained":"Back to details"}
      </button>
    </div>
  </section>;
}
