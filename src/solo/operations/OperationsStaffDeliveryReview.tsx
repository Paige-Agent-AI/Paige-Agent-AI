import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, FileCheck2 } from "lucide-react";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { OperationsAssignee } from "./OperationsAssignee";
import { readStaffDelivery, readStaffArtifact, writeStaffDelivery, staffDeliveryCaller, type StaffDeliveryScope, type StaffDeliveryRead, type StaffArtifactRead, type StaffDeliveryAction } from "./operations-delivery-staff";
import {browserDeliveryRecoveryStorage,readDeliveryRecovery,saveDeliveryRecovery,clearDeliveryRecovery,type RecoveryStorage} from "./operations-delivery-local-recovery";
import "./operations-staff-delivery-review.css";

type Read = {key:string;data:StaffDeliveryRead|null;artifact:StaffArtifactRead|null;loading:boolean};
type Outcome = {key:string;kind:"verified"|"refused"|"unverified";message:string};
/** Operations-owned controls; shared client routes and the real client decision remain Clients-owned. */
export function OperationsStaffDeliveryReview({scope,members,theme="dark",registerCloseGuard,recoveryStorage}:{scope:StaffDeliveryScope;members:TeamMemberRecord[];theme?:string;registerCloseGuard?:(guard:()=>boolean)=>()=>void;recoveryStorage?:RecoveryStorage}) {
 const key=JSON.stringify(scope),live=useRef(key);live.current=key;
 const storage=recoveryStorage??browserDeliveryRecoveryStorage(),draftScope=useRef({key,scope}),draftSubmission=useRef<Extract<StaffDeliveryAction,{kind:"review"}>["submission"]|null>(null);
 const [recoveryChecked,setRecoveryChecked]=useState<string|null>(null),[recoveryUnavailable,setRecoveryUnavailable]=useState(false);
 const mounted=useRef(false),sequence=useRef(0),writing=useRef(false);
 const [read,setRead]=useState<Read>({key,data:null,artifact:null,loading:true});
 const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const noteOwner=useRef(key);
 const [note,setNote]=useState(""),[noteSource,setNoteSource]=useState<string|null>(null);
 const [pending,setPending]=useState<StaffDeliveryAction|null>(null),[outcome,setOutcome]=useState<Outcome|null>(null);
 const [hint,setHint]=useState(""),invoker=useRef<HTMLButtonElement|null>(null),feedback=useRef<HTMLDivElement|null>(null);
 const retainedIntent=useRef<{key:string;action:StaffDeliveryAction;scope:StaffDeliveryScope;unconfirmed:boolean}|null>(null);
 useEffect(()=>{if(outcome?.key===key||hint)feedback.current?.scrollIntoView?.({block:"nearest",behavior:"auto"});},[outcome,key,hint]);
 const current=()=>mounted.current&&live.current===key;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  const restored=readDeliveryRecovery(storage,scope);draftScope.current={key,scope};setRecoveryUnavailable(restored.kind==="unavailable");setOutcome(null);
  if(restored.kind==="retained"){
   const r=restored.recovery;draftScope.current={key,scope:r.scope};
   if(r.kind==="draft"&&r.draft.kind==="review"){draftSubmission.current=r.draft.submission;noteOwner.current=key;setNote(r.draft.note);setNoteSource(JSON.stringify([key,r.draft.submission.id,r.draft.submission.revision_no,r.draft.submission.artifact_digest,r.draft.submission.updated_at]));}
   else if(r.kind==="attempt"){retainedIntent.current={key,action:r.action,scope:r.scope,unconfirmed:true};setOutcome({key,kind:"unverified",message:"An original delivery change remains unconfirmed. Inspect its recorded state before another write."});
    if(r.action.kind==="review"){draftSubmission.current=r.action.submission;noteOwner.current=key;setNote(r.action.note??"");setNoteSource(JSON.stringify([key,r.action.submission.id,r.action.submission.revision_no,r.action.submission.artifact_digest,r.action.submission.updated_at]));}
   }else{setRecoveryUnavailable(true);setHint("A preparation draft is retained. Return to preparation or clear its unsaved selections explicitly before reviewing.");}
  }else if(restored.kind==="unavailable")setHint("Local recovery is unavailable. Inspect the original work before continuing; no new write is permitted.");
  setRecoveryChecked(key);
 // Storage syntax never grants source access, and uncertain intent is never replayed.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key]);

 useEffect(()=>{
  const ticket=++sequence.current;let cancelled=false;
  setRead({key,data:null,artifact:null,loading:true});setPending(null);
  const same=()=>!cancelled&&current()&&sequence.current===ticket;
  void (async()=>{
   const data=await readStaffDelivery(staffDeliveryCaller,scope,same);
   if(!same())return;
   const latest=data.kind==="ready"?data.submissions[0]:null;
   const artifact=latest?await readStaffArtifact(staffDeliveryCaller,scope,latest,same):null;
   if(same()){
    setRead({key,data,artifact,loading:false});
    const intent=retainedIntent.current;
    if(intent?.unconfirmed&&intent.key===key&&data.kind==="ready"&&artifact?.kind==="ready"&&intent.action.kind!=="submit"){
     const original=intent.action.submission;
     const recorded=data.submissions.find(row=>row.id===original.id&&row.artifact_version_id===original.artifact_version_id&&row.artifact_digest===original.artifact_digest&&row.revision_no===original.revision_no);
     const matched=intent.action.kind==="review"?recorded?.state===intent.action.decision&&recorded.reviewed_by===scope.actorId&&recorded.review_note===(intent.action.note?.trim()||null)&&recorded.updated_at!==original.updated_at:recorded?.state==="approved"&&data.releases.some(row=>row.submission_id===original.id&&row.released_by===scope.actorId);
     if(matched){intent.unconfirmed=false;if(!clearDeliveryRecovery(storage,scope,{version:1,scope:intent.scope,kind:"attempt",action:intent.action}))setRecoveryUnavailable(true);setOutcome({key,kind:"verified",message:`The recorded state confirms your ${intent.action.kind==="release"?"client release":intent.action.decision==="approved"?"internal approval":"revision request"}. Your earlier request could not be confirmed directly.`});setNote("");setNoteSource(null);}
    }
   }
  })();
  return()=>{cancelled=true;};
 // Exact scope and read sequence fence both content and submitted-version actions.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,revision]);
 const visible=read.key===key?read:null,data=visible?.data?.kind==="ready"?visible.data:null;
 const latest=data?.submissions[0],artifact=visible?.artifact?.kind==="ready"?visible.artifact:null;
 const release=latest?data?.releases.find(row=>row.submission_id===latest.id):undefined;
 const source=latest?JSON.stringify([key,latest.id,latest.revision_no,latest.artifact_digest,latest.updated_at]):null;
 const result=outcome?.key===key?outcome:null,dirty=Boolean(note);
 const mismatched=dirty&&noteSource!==source;
 const unknown=Boolean(retainedIntent.current?.unconfirmed);
 const noteVisible=Boolean(artifact&&noteOwner.current===key&&latest&&draftSubmission.current&&latest.id===draftSubmission.current.id&&latest.artifact_version_id===draftSubmission.current.artifact_version_id&&latest.artifact_digest===draftSubmission.current.artifact_digest);
 const locked=recoveryChecked!==key||recoveryUnavailable||unknown||busy||Boolean(visible?.loading)||!artifact||mismatched||result?.kind==="unverified"||result?.kind==="refused";
 const reviewing=latest?.state==="in_review"&&latest.reviewer_user_id===scope.actorId&&latest.submitted_by!==scope.actorId;
 const needsGuard=busy||dirty||unknown;
 useBeforeUnloadGuard(needsGuard);
 useEffect(()=>registerAccountSwitchGuard(()=>!needsGuard),[needsGuard]);
 useEffect(()=>registerCloseGuard?.(()=>{if(needsGuard){setHint(unknown?"Inspect the original change before closing; its outcome remains unconfirmed.":busy?"Wait for recorded readback before closing.":"Clear the unsaved review note explicitly before closing.");return false;}return true;}),[registerCloseGuard,needsGuard,unknown,busy]);

 const request=(action:StaffDeliveryAction,button:HTMLButtonElement)=>{
  if(!current()||locked)return;
  if(action.kind==="review"&&action.decision==="revision_requested"&&!note.trim()){setHint("Add the changes this version needs before requesting revisions.");feedback.current?.focus();return;}
  invoker.current=button;setHint("");setPending(action);
 };
 const save=async()=>{
  if(!pending||!current()||locked||writing.current)return;
  const action=pending,originalScope=draftScope.current.key===key?draftScope.current.scope:scope;
  if(!saveDeliveryRecovery(storage,scope,{version:1,scope:originalScope,kind:"attempt",action})){setPending(null);setOutcome({key,kind:"refused",message:"Local recovery could not retain the original delivery change. No request was sent. Retry recovery before continuing."});return;}
  retainedIntent.current={key,action,scope:originalScope,unconfirmed:true};writing.current=true;setBusy(true);setPending(null);
  try{
   const saved=await writeStaffDelivery(staffDeliveryCaller,originalScope,action,current);
   if(!current())return;
   if(saved.kind==="verified"){
    retainedIntent.current.unconfirmed=false;if(!clearDeliveryRecovery(storage,scope,{version:1,scope:originalScope,kind:"attempt",action}))setRecoveryUnavailable(true);
    setNote("");setNoteSource(null);setOutcome({key,kind:"verified",message:action.kind==="release"?"This version is released for client review. Its recorded client decision is shown separately.":action.kind==="review"&&action.decision==="approved"?"Internal approval is recorded. Client acceptance is still a separate decision.":"Your revision request is recorded for this version."});setRevision(n=>n+1);
   }else if(saved.kind!=="scope_changed"){if(saved.kind==="refused"||saved.kind==="invalid"){retainedIntent.current.unconfirmed=false;if(!clearDeliveryRecovery(storage,scope,{version:1,scope:originalScope,kind:"attempt",action}))setRecoveryUnavailable(true);if(note&&draftSubmission.current)saveDeliveryRecovery(storage,scope,{version:1,scope:originalScope,kind:"draft",draft:{kind:"review",submission:draftSubmission.current,note}});else clearDeliveryRecovery(storage,scope);}setOutcome({key,kind:saved.kind==="refused"||saved.kind==="invalid"?"refused":"unverified",message:saved.kind==="refused"||saved.kind==="invalid"?"The change was refused. Inspect the current work and your access before continuing.":"The change could not be confirmed. Inspect its recorded state; another write is locked while this outcome remains unconfirmed."});}
  }catch{if(current())setOutcome({key,kind:"unverified",message:"The change could not be confirmed. Inspect its recorded state before any further action."});}
  finally{writing.current=false;if(mounted.current)setBusy(false);}
 };
 const refresh=()=>{if(!busy){setPending(null);if(!unknown&&result?.kind!=="unverified")setOutcome(null);setRevision(n=>n+1);}};
 const restoreFocus=(event:Event)=>{const button=invoker.current;if(button?.isConnected&&!button.disabled){event.preventDefault();button.focus();}else if(feedback.current?.isConnected){event.preventDefault();feedback.current.focus();}};
 return <section className="paige-solo ops-staff-review" data-pg={theme} data-theme={theme} aria-label="Deliverable review">
  <header><FileCheck2 size={24} aria-hidden="true"/><h2>Review the work</h2><button type="button" disabled={busy} onClick={refresh}>Inspect recorded state</button></header>
  {data&&<ol className="ops-staff-progression" aria-label="Delivery progression">
   {[{label:"Internal review",complete:latest?.state==="approved"},{label:"Released for client review",complete:Boolean(release)},{label:"Accepted",complete:release?.state==="accepted"}].map(stage=><li key={stage.label} data-complete={stage.complete}>{stage.complete?<CheckCircle2 size={18} aria-hidden="true"/>:<Circle size={18} aria-hidden="true"/>}<span>{stage.label}</span><span className="sr-only">{stage.complete?"recorded":"not recorded"}</span></li>)}
  </ol>}
  {!visible||visible.loading?<p role="status">Loading the submitted version...</p>:!data?<div role="status"><h3>Submitted work unavailable</h3><p>Your current access could not read this work. Inspect the recorded state or ask the accountable owner to check its review.</p></div>:!latest?<div><h3>No submitted version yet</h3><p>Prepare an immutable text version in Studio and nominate an eligible reviewer before this work can be reviewed.</p></div>:<>
   <div className="ops-staff-people"><div><span>Submitted by</span>{members.find(m=>m.user_id===latest.submitted_by)?<OperationsAssignee member={members.find(m=>m.user_id===latest.submitted_by)}/>:<strong>Member unavailable</strong>}</div><div><span>Reviewer</span>{members.find(m=>m.user_id===latest.reviewer_user_id)?<OperationsAssignee member={members.find(m=>m.user_id===latest.reviewer_user_id)}/>:<strong>Member unavailable</strong>}</div><p>Version {latest.revision_no}<br/><span>{latest.state==="approved"?"Internally approved":latest.state==="revision_requested"?"Changes requested":"In internal review"}</span></p></div>
   {artifact?<article aria-label="Exact submitted artifact"><h3>{artifact.title}</h3><div className="ops-staff-document" tabIndex={0}>{artifact.body}</div></article>:<p role="status">The exact submitted content cannot be inspected with current source access. No substitute version is shown.</p>}
   {latest.review_note&&<section aria-label="Recorded internal review"><h3>Recorded review note</h3><p className="ops-staff-note">{latest.review_note}</p></section>}
   {release&&<section aria-label="Recorded client outcome"><h3>{release.state==="accepted"?"Client acceptance recorded":release.state==="client_revision_requested"?"Client requested changes":"Awaiting client review"}</h3><p>{release.state==="accepted"?`Version ${latest.revision_no} was explicitly accepted at ${release.decision_at}.`:release.state==="client_revision_requested"?"Prepare a new immutable version, obtain a new internal review and release it again.":"Internal work is approved; the linked client's decision has not been recorded."}</p>{release.client_note&&<p className="ops-staff-note">{release.client_note}</p>}</section>}
   {reviewing&&<div className="ops-staff-decisions">{artifact&&<><label>Review note<textarea aria-label="Review note" maxLength={4000} value={noteVisible?note:""} disabled={busy||unknown||mismatched||result?.kind==="unverified"} onChange={event=>{const text=event.target.value;setNote(text);if(!note){setNoteSource(source);noteOwner.current=key;draftSubmission.current=latest;draftScope.current={key,scope};}if(text&&draftSubmission.current&&!saveDeliveryRecovery(storage,scope,{version:1,scope:draftScope.current.scope,kind:"draft",draft:{kind:"review",submission:draftSubmission.current,note:text}}))setHint("Local recovery could not retain your review note. No decision will be sent without original-intent retention.");else setHint("");}}/></label><p>Describe what needs to change. A note is required for revisions.</p></>}<div><button type="button" disabled={locked} onClick={event=>request({kind:"review",submission:latest,decision:"revision_requested",note:note.trim()||null},event.currentTarget)}>Request changes</button><button type="button" disabled={locked} className="ops-staff-primary" onClick={event=>request({kind:"review",submission:latest,decision:"approved",note:note.trim()||null},event.currentTarget)}>Approve internally</button></div></div>}
   {latest.state==="approved"&&!release&&<button type="button" className="ops-staff-primary" disabled={locked} onClick={event=>request({kind:"release",submission:latest},event.currentTarget)}>Release for client review</button>}
  </>}
  {note&&noteVisible&&!reviewing&&<section aria-label="Retained review note"><h3>Your retained draft</h3><p className="ops-staff-note">{note}</p><p>This draft has not been confirmed as the recorded review. Keep a copy or clear it explicitly.</p></section>}
  {mismatched&&<p role="status">Your draft note belongs to the previous inspected version. Keep a copy when source access permits, then clear it explicitly before deciding on the current version.</p>}
  {note&&!unknown&&<button type="button" disabled={busy} onClick={()=>{if(!clearDeliveryRecovery(storage,draftScope.current.scope)){setHint("Local recovery could not be cleared. Your review draft is retained.");return;}setNote("");setNoteSource(null);draftSubmission.current=null;draftScope.current={key,scope};}}>Clear review note</button>}
  <div ref={feedback} role="status" tabIndex={-1} aria-live="polite">{busy?<p>Saving and verifying the recorded change...</p>:result?<p>{result.message}</p>:hint?<p>{hint}</p>:null}</div>
  <AlertDialog open={Boolean(pending)&&!locked} onOpenChange={open=>{if(!open)setPending(null);}}><AlertDialogContent className="paige-solo ops-staff-confirm" data-pg={theme} data-theme={theme} onCloseAutoFocus={restoreFocus}><AlertDialogHeader><AlertDialogTitle>{pending?.kind==="release"?`Release version ${latest?.revision_no} for client review?`:pending?.kind==="review"&&pending.decision==="approved"?`Approve version ${latest?.revision_no} internally?`:`Request changes to version ${latest?.revision_no}?`}</AlertDialogTitle><AlertDialogDescription>{artifact?.title}. {pending?.kind==="release"?"This exposes this exact approved version to the linked client for their explicit decision.":"This records your internal review of the exact submitted version. It does not record client acceptance."}</AlertDialogDescription></AlertDialogHeader>{noteVisible&&note.trim()&&<p className="ops-staff-note">{note}</p>}<AlertDialogFooter><AlertDialogCancel>Keep reviewing</AlertDialogCancel><AlertDialogAction className="ops-staff-primary" onClick={()=>void save()}>{pending?.kind==="release"?"Confirm client release":pending?.kind==="review"&&pending.decision==="approved"?"Confirm internal approval":"Confirm changes request"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
