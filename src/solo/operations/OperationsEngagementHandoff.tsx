import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import type { EngagementEvidence } from "./operations-engagement-readiness";
import { prepareEngagementHandoff, type HandoffScope } from "./operations-engagement-handoff";
import { writeEngagementHandoff, type HandoffWriteResult } from "./operations-engagement-handoff-write";
import { inspectOriginalHandoff } from "./operations-handoff-recovery";
import { clearPendingHandoff, readPendingHandoff, retainPendingHandoff } from "./operations-handoff-intent";
import { resolveHandoffLocalDeadline } from "./operations-handoff-date";
import { OperationsAssignee } from "./OperationsAssignee";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type Props = { scope:HandoffScope; evidence:EngagementEvidence; members:TeamMemberRecord[]; peopleReady:boolean;
 theme:string; onVerified:(planId:string)=>Promise<void> };
const stamp=(scope:HandoffScope,evidence:EngagementEvidence)=>JSON.stringify([scope,evidence]);
/** Prepared for the existing Delivery drawer. Not mounted or released until the handoff database gate passes. */
export function OperationsEngagementHandoff({scope,evidence,members,peopleReady,theme,onVerified}:Props) {
 const [initial]=useState(()=>stamp(scope,evidence));const current=stamp(scope,evidence)===initial;
 const [pending,setPending]=useState(()=>readPendingHandoff(scope.actorId,scope.tenantId,evidence.agreementId));
 const [title,setTitle]=useState("");const [summary,setSummary]=useState("");const [owner,setOwner]=useState("");
 const [start,setStart]=useState("");const [finish,setFinish]=useState("");
 const [steps,setSteps]=useState([{title:"",person:"",due:"",priority:"normal" as "low"|"normal"|"high"|"urgent"}]);
 const [admin,setAdmin]=useState<boolean|null>(null);const [busy,setBusy]=useState(false);const [review,setReview]=useState(false);
 const [result,setResult]=useState<HandoffWriteResult|null>(null);const [notice,setNotice]=useState("");
 const mounted=useRef(true);const submitting=useRef(false);const liveStamp=useRef(stamp(scope,evidence));liveStamp.current=stamp(scope,evidence);
 useEffect(()=>{mounted.current=true;let cancelled=false;
  void supabase.rpc("is_tenant_admin",{_tenant:scope.tenantId}).then(({data,error})=>{if(!cancelled)setAdmin(!error&&data===true);},()=>{if(!cancelled)setAdmin(false);});
  return()=>{cancelled=true;mounted.current=false;};
 },[scope.actorId,scope.tenantId]);
 const eligible=members.filter(m=>m.status==="active");const selected=eligible.find(m=>m.user_id===owner);
 const locked=busy||pending.kind!=="absent"||result?.kind==="verified";
 const allowed=current&&admin===true&&peopleReady&&!!selected&&!locked;
 const request=()=>prepareEngagementHandoff(scope,evidence,{title,summary:summary||null,ownerUserId:owner,startsOn:start,endsOn:finish,
  milestones:steps.map(s=>({title:s.title,assignedToUserId:s.person,priority:s.priority,dueAt:s.due?(resolveHandoffLocalDeadline(s.due)?.iso??"invalid"):null}))},crypto.randomUUID(),eligible.map(m=>m.user_id));
 const reviewDraft=()=>{try{if(!allowed||!request()){setNotice("Choose an owner, a valid schedule and a responsible person for every milestone.");return;}setNotice("");setReview(true);}catch{setNotice("Choose valid milestone dates before reviewing.");}};
 const save=async()=>{
  if(!allowed||submitting.current)return;
  let original;try{original=request();}catch{return;}if(!original)return;
  // Recheck the storage lock at confirmation, not only at initial render.
  const prior=readPendingHandoff(scope.actorId,scope.tenantId,evidence.agreementId);
  if(prior.kind!=="absent"){setPending(prior);setReview(false);return;}
  if(!retainPendingHandoff(original)){setPending({kind:"blocked"});setNotice("Recovery information could not be retained. No handoff was submitted.");setReview(false);return;}
  setPending({kind:"valid",request:original});submitting.current=true;setBusy(true);setReview(false);setNotice("");
  const saved=await writeEngagementHandoff(original);
  if(!mounted.current||liveStamp.current!==initial)return;
  setResult(saved);setBusy(false);
  if(saved.kind==="verified"){
   if(clearPendingHandoff(scope.actorId,scope.tenantId,evidence.agreementId))setPending({kind:"absent"});
   try{await onVerified(saved.planId);}catch{if(mounted.current&&liveStamp.current===initial)setNotice("The project was verified. Refresh current work to show the latest view.");}
  }
 };
 const recover=async()=>{
  if(!current||busy||pending.kind!=="valid")return;setBusy(true);setNotice("");
  const recovered=await inspectOriginalHandoff(pending.request);
  if(!mounted.current||liveStamp.current!==initial)return;setBusy(false);
  if(recovered.kind!=="verified"){setNotice(recovered.message);return;}
  setResult({kind:"verified",planId:recovered.planId,milestoneIds:recovered.milestoneIds,replayed:false});
  if(clearPendingHandoff(scope.actorId,scope.tenantId,evidence.agreementId))setPending({kind:"absent"});
  try{await onVerified(recovered.planId);}catch{if(mounted.current&&liveStamp.current===initial)setNotice("The original project was verified. Refresh current work.");}
 };
 if(!current)return <p role="alert">This commitment changed. Close and inspect its current scope before continuing.</p>;
 return <section className="op-delivery-handoff" aria-label="Review delivery handoff">
  <h3>Give this commitment a delivery plan</h3><p>Choose the work and people responsible. These milestones are your reviewed plan; client acceptance comes later.</p>
  {pending.kind==="blocked"&&<p role="alert">Earlier handoff recovery is unavailable. Inspect the engagement and current projects before creating more work.</p>}
  {pending.kind==="valid"&&result?.kind!=="verified"&&<div><p>Inspect the original handoff before submitting another plan.</p><button type="button" disabled={busy} onClick={()=>void recover()}>{busy?"Checking original work…":"Inspect original handoff"}</button></div>}
  <form onSubmit={e=>{e.preventDefault();reviewDraft();}}>
   <fieldset className="ops-create-fields" disabled={locked||admin!==true||!peopleReady}>
    <label>Project name<input required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Delivery context<textarea maxLength={10000} rows={3} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
    <label>Accountable owner<select required value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Choose a person</option>{eligible.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name||"Team member"}</option>)}</select></label>
    {selected&&<OperationsAssignee member={selected}/>}
    <div className="ops-create-pair"><label>Start<input required type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Finish<input required type="date" min={start||undefined} value={finish} onChange={e=>setFinish(e.target.value)}/></label></div>
    {steps.map((step,i)=><fieldset key={i}><legend>Milestone {i+1}</legend>
     <label>Outcome<input required maxLength={500} value={step.title} onChange={e=>setSteps(s=>s.map((v,n)=>n===i?{...v,title:e.target.value}:v))}/></label>
     <label>Responsible person<select required value={step.person} onChange={e=>setSteps(s=>s.map((v,n)=>n===i?{...v,person:e.target.value}:v))}><option value="">Choose a person</option>{eligible.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name||"Team member"}</option>)}</select></label>
     {step.person&&<OperationsAssignee member={eligible.find(m=>m.user_id===step.person)}/>}
     <div className="ops-create-pair"><label>Due date<input type="datetime-local" value={step.due} onChange={e=>setSteps(s=>s.map((v,n)=>n===i?{...v,due:e.target.value}:v))}/></label><label>Priority<select value={step.priority} onChange={e=>setSteps(s=>s.map((v,n)=>n===i?{...v,priority:e.target.value as typeof v.priority}:v))}>{["low","normal","high","urgent"].map(v=><option key={v}>{v}</option>)}</select></label></div>
     {steps.length>1&&<button type="button" onClick={()=>setSteps(s=>s.filter((_,n)=>n!==i))}>Remove milestone {i+1}</button>}
    </fieldset>)}
    <button type="button" disabled={steps.length>=50} onClick={()=>setSteps(s=>[...s,{title:"",person:"",due:"",priority:"normal"}])}>Add milestone</button>
   </fieldset>
   <div role="status" aria-live="polite">{admin===null&&<p>Checking handoff authority…</p>}{admin===false&&<p>A workspace administrator must authorize this handoff.</p>}{!peopleReady&&<p>Refresh the team before assigning delivery work.</p>}{notice&&<p>{notice}</p>}{result&&<p>{result.kind==="verified"?"Delivery project and milestones saved and verified. Client acceptance is still outstanding.":result.message}</p>}</div>
   <button type="submit" disabled={!allowed}>{busy?"Saving and checking…":"Review delivery plan"}</button>
  </form>
  <AlertDialog open={review&&current} onOpenChange={setReview}><AlertDialogContent className="paige-solo ops-detail-sheet" data-pg={theme} data-theme={theme}><AlertDialogHeader><AlertDialogTitle>Create this delivery plan?</AlertDialogTitle><AlertDialogDescription>{title} · {selected?.full_name} · {start} to {finish} · {steps.length} reviewed milestones · Signed version {evidence.version}. This creates accountable work and does not record client acceptance.</AlertDialogDescription></AlertDialogHeader><ul>{steps.map((s,i)=><li key={i}>{s.title} · {eligible.find(m=>m.user_id===s.person)?.full_name} · {s.priority}{s.due?` · ${resolveHandoffLocalDeadline(s.due)?.label??"Invalid local time"}`:" · No deadline"}</li>)}</ul><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={!allowed} onClick={()=>void save()}>Create delivery plan</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
