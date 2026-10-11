import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { memberVisibleIdentity } from "@/solo/team-workspace-contract";
import type { CrmWorkRecord } from "./operations-native-work";
import { buildCrmWorkEditOperation, type CrmWorkEditOperation } from "./operations-crm-work-edit";

/** One change per reviewed canonical command; no browser task store or writer. */
export function OperationsCrmWorkEditor({task,actorId,tenantId,members,unavailable,onPropose}:{
  task:CrmWorkRecord;actorId:string;tenantId:string;members:TeamMemberRecord[];unavailable:boolean;
  onPropose:(operation:CrmWorkEditOperation)=>void;
}) {
  const original=useRef(task);
  const scope=`${actorId}:${tenantId}`;
  const [permission,setPermission]=useState<{scope:string;admin:boolean}|null>(null);
  const admin=permission?.scope===scope?permission.admin:null;
  const [assignee,setAssignee]=useState(task.user_id);
  const [due,setDue]=useState("");
  const [clearDate,setClearDate]=useState(false);
  const [notice,setNotice]=useState("");
  useEffect(()=>{
    let current=true;
    void (async()=>{try {
      const result=await supabase.rpc("is_tenant_admin",{_tenant:tenantId});
      if(current)setPermission({scope,admin:!result.error&&result.data===true});
    }catch{if(current)setPermission({scope,admin:false});}})();
    return()=>{current=false;};
  },[scope,tenantId]);
  const stale=(task.updated_at??task.created_at)!==(original.current.updated_at??original.current.created_at);
  const disabled=unavailable||stale||task.tenant_id!==tenantId;
  const propose=(kind:"assignment"|"due")=>{
    if(disabled||kind==="assignment"&&admin!==true)return;
    const parsed=due?new Date(due):null;
    const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(due);
    const validLocal=parsed&&parts&&Number.isFinite(parsed.getTime())&&parsed.getFullYear()===+parts[1]&&parsed.getMonth()+1===+parts[2]&&parsed.getDate()===+parts[3]&&parsed.getHours()===+parts[4]&&parsed.getMinutes()===+parts[5];
    if(kind==="due"&&!clearDate&&!validLocal){setNotice("Choose a valid due date and time.");return;}
    const operation=buildCrmWorkEditOperation(original.current,kind==="assignment"?{kind,assigneeId:assignee}:{kind,dueAt:clearDate?null:parsed!.toISOString()},
      {actorId,tenantId,key:crypto.randomUUID()},members);
    if(!operation){setNotice("This change is unavailable or already matches current work. Refresh the task and team before trying again.");return;}
    setNotice("");onPropose(operation);
  };
  return <section className="ops-work-editor" aria-label="Edit task responsibility and due date">
    <h3>Plan the next step</h3>
    {stale&&<p role="alert">This task changed while you were editing. Close and reopen its current details before proposing another change.</p>}
    {notice&&<p role="alert">{notice}</p>}
    {admin===null?<p role="status">Checking assignment permissions…</p>:admin&&<div>
      <label>Responsible person<select aria-label="New CRM task responsible person" value={assignee} disabled={disabled||members.length===0} onChange={event=>setAssignee(event.target.value)}>
        {!members.some(person=>person.user_id===assignee)&&<option value={assignee}>Current member unavailable</option>}
        {members.filter(person=>person.status==="active").map(person=><option key={person.user_id} value={person.user_id}>{memberVisibleIdentity(person).primary}</option>)}
      </select></label>
      <button type="button" disabled={disabled||members.length===0||assignee===task.user_id} onClick={()=>propose("assignment")}>Review reassignment</button>
    </div>}
    <label>New due date and time<input aria-label="New CRM task due date" type="datetime-local" value={due} disabled={disabled||clearDate} onChange={event=>setDue(event.target.value)} /></label>
    <p>Time uses your device’s timezone. Review the exact date before confirming.</p>
    {task.due_date&&<label className="ops-work-editor-check"><input type="checkbox" checked={clearDate} disabled={disabled} onChange={event=>setClearDate(event.target.checked)} />Remove the current due date</label>}
    <button type="button" disabled={disabled||!due&&!clearDate} onClick={()=>propose("due")}>Review due date</button>
  </section>;
}
