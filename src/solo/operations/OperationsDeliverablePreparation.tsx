import { useEffect,useRef,useState } from "react";
import { FileCheck2 } from "lucide-react";
import { readStaffDelivery,writeStaffDelivery,staffDeliveryCaller,type StaffDeliveryScope,type StaffDeliveryRead,type StaffDeliveryAction } from "./operations-delivery-staff";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { readDeliverySourceSessions,readDeliverySourceVersions,deliverySourceCaller,type DeliverySourceSession,type DeliverySourceVersion } from "./operations-delivery-source";
import { OperationsAssignee } from "./OperationsAssignee";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction } from "@/components/ui/alert-dialog";
import "./operations-staff-delivery-review.css";
export type PreparationProps={scope:StaffDeliveryScope;members:TeamMemberRecord[];theme?:string;onSubmitted?:()=>void;registerCloseGuard?:(guard:()=>boolean)=>()=>void};
type Sources={key:string;loading:boolean;sessions:DeliverySourceSession[]|null;work:StaffDeliveryRead|null};
type Versions={key:string;loading:boolean;versions:DeliverySourceVersion[]|null;unsupported:number};
/** Source preparation only: existing Studio versions and the canonical Delivery writer. */
export function OperationsDeliverablePreparation({scope,members,theme="dark",onSubmitted,registerCloseGuard}:PreparationProps){
 const key=JSON.stringify(scope),live=useRef(key);live.current=key;
 const mounted=useRef(false),writing=useRef(false),sequence=useRef(0);
 const [refresh,setRefresh]=useState(0),[sources,setSources]=useState<Sources>({key,loading:true,sessions:null,work:null});
 const [sessionId,setSessionId]=useState(""),[artifactId,setArtifactId]=useState(""),[versionId,setVersionId]=useState(""),[reviewerId,setReviewerId]=useState("");
 const selection=JSON.stringify([key,sessionId,artifactId]),selectionLive=useRef(selection);selectionLive.current=selection;
 const [versions,setVersions]=useState<Versions>({key:selection,loading:false,versions:null,unsupported:0});
 const [busy,setBusy]=useState(false),[confirming,setConfirming]=useState(false),[hint,setHint]=useState("");
 const [outcome,setOutcome]=useState<{key:string;kind:"verified"|"refused"|"unverified";message:string}|null>(null);
 const intent=useRef<{key:string;action:Extract<StaffDeliveryAction,{kind:"submit"}>;unconfirmed:boolean}|null>(null),invoker=useRef<HTMLButtonElement|null>(null),feedback=useRef<HTMLDivElement|null>(null);
 const current=()=>mounted.current&&live.current===key;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let cancelled=false;const ticket=++sequence.current,same=()=>!cancelled&&current()&&sequence.current===ticket;
  setSources({key,loading:true,sessions:null,work:null});setConfirming(false);
  void(async()=>{
   const [work,source]=await Promise.all([readStaffDelivery(staffDeliveryCaller,scope,same),readDeliverySourceSessions(deliverySourceCaller,scope,same)]);
   if(!same())return;
   setSources({key,loading:false,work,sessions:source.kind==="ready"?source.sessions:null});
   const retained=intent.current;
   if(retained?.unconfirmed&&retained.key===key&&work.kind==="ready"&&work.submissions.some(row=>row.artifact_version_id===retained.action.artifactVersionId&&row.reviewer_user_id===retained.action.reviewerId&&row.submitted_by===scope.actorId&&row.revision_no===retained.action.expectedRevisionNo+1)){
    retained.unconfirmed=false;setOutcome({key,kind:"verified",message:"The original version and reviewer are confirmed in the recorded submission. The earlier request was not confirmed directly."});onSubmitted?.();
   }
  })();return()=>{cancelled=true;};
 // Exact scope/read fences; recovery observes retained intent and never writes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,refresh]);
 const data=sources.key===key&&!sources.loading&&sources.work?.kind==="ready"?sources.work:null;
 const sessions=sources.key===key?sources.sessions:null,session=sessions?.find(row=>row.id===sessionId),artifact=session?.artifacts.find(row=>row.id===artifactId);
 useEffect(()=>{
  let cancelled=false;const same=()=>!cancelled&&current()&&selectionLive.current===selection;
  if(!session||!artifact){setVersions({key:selection,loading:false,versions:null,unsupported:0});return()=>{cancelled=true;};}
  setVersions({key:selection,loading:true,versions:null,unsupported:0});
  void readDeliverySourceVersions(deliverySourceCaller,scope,session.id,artifact.id,same).then(read=>{
   if(same())setVersions({key:selection,loading:false,versions:read.kind==="ready"?read.versions:null,unsupported:read.kind==="ready"?read.unsupportedCount:0});
  });return()=>{cancelled=true;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[selection,refresh,Boolean(session),Boolean(artifact)]);
 const listed=versions.key===selection&&!versions.loading?versions.versions:null,version=listed?.find(row=>row.id===versionId);
 const membersAvailable=members.filter(row=>row.status==="active"&&row.user_id!==scope.actorId),reviewer=membersAvailable.find(row=>row.user_id===reviewerId);
 const latest=data?.submissions[0],release=latest?data?.releases.find(row=>row.submission_id===latest.id):undefined;
 const eligible=Boolean(data)&&(!latest||latest.state==="revision_requested"||release?.state==="client_revision_requested");
 const result=outcome?.key===key?outcome:null,unknown=Boolean(intent.current?.unconfirmed),dirty=Boolean(sessionId||artifactId||versionId||reviewerId)&&result?.kind!=="verified";
 const locked=busy||unknown||result?.kind==="verified"||result?.kind==="refused"||Boolean(sources.loading)||!eligible;
 const canSubmit=!locked&&Boolean(version&&reviewer),needsGuard=busy||dirty||unknown;
 useBeforeUnloadGuard(needsGuard);
 useEffect(()=>registerAccountSwitchGuard(()=>{if(needsGuard){setHint("Finish or clear this preparation before switching workspaces.");return false;}return true;}),[needsGuard]);
 useEffect(()=>registerCloseGuard?.(()=>{if(needsGuard){setHint(unknown?"Inspect the original submission before leaving; its outcome remains unconfirmed.":busy?"Wait for submission and readback before closing.":"Clear this preparation explicitly before closing.");return false;}return true;}),[needsGuard,unknown,busy,registerCloseGuard]);
 useEffect(()=>{if(result||hint)feedback.current?.scrollIntoView?.({block:"nearest",behavior:"auto"});},[result,hint]);
 const save=async()=>{
  if(!current()||!confirming||!canSubmit||!version||!reviewer||writing.current)return;
  const action:Extract<StaffDeliveryAction,{kind:"submit"}>={kind:"submit",artifactVersionId:version.id,reviewerId:reviewer.user_id,expectedRevisionNo:latest?.revision_no??0};
  intent.current={key,action,unconfirmed:true};writing.current=true;setBusy(true);setConfirming(false);
  try{const saved=await writeStaffDelivery(staffDeliveryCaller,scope,action,current);if(!current())return;
   if(saved.kind==="verified"){intent.current.unconfirmed=false;setOutcome({key,kind:"verified",message:"Submission is recorded and verified. Internal review and client acceptance remain separate decisions."});onSubmitted?.();}
   else if(saved.kind!=="scope_changed"){
    if(saved.kind==="refused"||saved.kind==="invalid")intent.current.unconfirmed=false;
    setOutcome({key,kind:saved.kind==="refused"||saved.kind==="invalid"?"refused":"unverified",message:saved.kind==="refused"||saved.kind==="invalid"?"Submission was refused. Inspect current work and source access before continuing.":"Submission could not be confirmed. Inspect the original recorded submission before another write."});
   }
  }catch{if(current())setOutcome({key,kind:"unverified",message:"Submission could not be confirmed. Inspect its original recorded state before another write."});}
  finally{writing.current=false;if(mounted.current)setBusy(false);}
 };
 const inspect=()=>{if(!busy){if(!unknown)setOutcome(null);setRefresh(n=>n+1);}};
 const restoreFocus=(event:Event)=>{if(invoker.current?.isConnected&&!invoker.current.disabled){event.preventDefault();invoker.current.focus();}else if(feedback.current?.isConnected){event.preventDefault();feedback.current.focus();}};
 return <section className="paige-solo ops-staff-review ops-delivery-preparation" data-pg={theme} data-theme={theme} aria-label="Prepare a deliverable">
  <header><FileCheck2 size={24} aria-hidden="true"/><h2>Prepare the next version</h2><button type="button" disabled={busy} onClick={inspect}>Inspect recorded submission</button></header>
  {sources.key!==key||sources.loading?<p role="status">Reading saved work and source versions...</p>:!data||!sessions?<div role="status"><h3>Source access unavailable</h3><p>Inspect current work and Studio access. No substitute source is shown.</p></div>:!eligible?<p>A submitted version is already awaiting its next decision. Review the recorded work before preparing another version.</p>:<>
   {sessions.length===0?<p>No readable Studio sources returned. Prepare an immutable text version in Studio, then inspect sources here.</p>:<div className="ops-staff-source-grid">
    <label>Studio source<select aria-label="Studio session" value={sessionId} disabled={locked} onChange={e=>{setSessionId(e.target.value);setArtifactId("");setVersionId("");}}><option value="">Choose a saved source</option>{sessions.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
    <label>Saved work<select aria-label="Saved artifact" value={artifactId} disabled={locked||!session} onChange={e=>{setArtifactId(e.target.value);setVersionId("");}}><option value="">Choose saved work</option>{session?.artifacts.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
    <label>Immutable version<select aria-label="Artifact version" value={versionId} disabled={locked||!listed} onChange={e=>setVersionId(e.target.value)}><option value="">Choose the exact version</option>{listed?.map(row=><option key={row.id} value={row.id}>Version {row.versionNo} · {row.title}</option>)}</select></label>
    <label>Independent reviewer<select aria-label="Independent reviewer" value={reviewerId} disabled={locked} onChange={e=>setReviewerId(e.target.value)}><option value="">Choose a responsible person</option>{membersAvailable.map(row=><option key={row.user_id} value={row.user_id}>{row.full_name||"Team member"}</option>)}</select></label>
   </div>}
   {versions.key===selection&&versions.loading&&<p role="status">Reading immutable versions...</p>}
   {artifact&&!versions.loading&&versions.key===selection&&listed===null&&<p role="status">The saved versions could not be inspected. Retry the source read before submitting.</p>}
   {versions.key===selection&&versions.unsupported>0&&<p>{versions.unsupported} saved versions cannot be submitted as text deliverables.</p>}
   {reviewer&&<div className="ops-staff-people"><div><span>Proposed reviewer</span><OperationsAssignee member={reviewer}/></div><p>Independent review<br/><span>Studio eligibility is checked on submission.</span></p></div>}
   {version&&<article aria-label="Exact preparation source"><h3>{version.title}</h3><p>Saved version {version.versionNo}</p><div className="ops-staff-document" tabIndex={0}>{version.body}</div></article>}
   <button type="button" className="ops-staff-primary" disabled={!canSubmit} onClick={e=>{invoker.current=e.currentTarget;setHint("");setConfirming(true);}}>Review submission</button>
  </>}
  {dirty&&!busy&&!unknown&&<button type="button" onClick={()=>{setSessionId("");setArtifactId("");setVersionId("");setReviewerId("");setHint("");}}>Clear preparation</button>}
  <div ref={feedback} role="status" tabIndex={-1} aria-live="polite">{busy?<p>Submitting and verifying the recorded version...</p>:result?<p>{result.message}</p>:unknown?<p>An earlier submission remains unconfirmed. Return to its original inspection before another write.</p>:hint?<p>{hint}</p>:null}</div>
  <AlertDialog open={confirming&&canSubmit} onOpenChange={setConfirming}><AlertDialogContent className="paige-solo ops-staff-confirm" data-pg={theme} data-theme={theme} onCloseAutoFocus={restoreFocus}><AlertDialogHeader><AlertDialogTitle>Submit this version for internal review?</AlertDialogTitle><AlertDialogDescription>{version?.title} · saved version {version?.versionNo} · {reviewer?.full_name||"Team member"}. This records the exact immutable source for independent review. It does not record client acceptance.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep preparing</AlertDialogCancel><AlertDialogAction className="ops-staff-primary" onClick={()=>void save()}>Confirm submission</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
