import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { decideClientDelivery, readClientDeliveryArtifact, type ClientDeliveryArtifact, type ClientDeliveryCaller } from "@/lib/operations-client-review";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import "./operations-client-artifact-review.css";

export type ClientArtifactReviewScope = { actorId:string; tenantId:string; releaseId:string; theme?:string };
type ReadState = { key:string; phase:"loading"|"ready"|"unavailable"; artifact?:ClientDeliveryArtifact };
/** Domain-owned review component; portal mount and client identity remain Clients-owned. */
export function OperationsClientArtifactReview({actorId,tenantId,releaseId,theme="dark"}:ClientArtifactReviewScope) {
 const reviewNoteHint=useId();
 const key=JSON.stringify([actorId,tenantId,releaseId]);
 const live=useRef(key);live.current=key;const mounted=useRef(false);const requestNo=useRef(0);const writing=useRef(false);
 const [read,setRead]=useState<ReadState>({key,phase:"loading"});
 const [note,setNote]=useState("");const [busy,setBusy]=useState(false);
 const [decision,setDecision]=useState<"accepted"|"client_revision_requested"|null>(null);
 const [outcome,setOutcome]=useState<{key:string; kind:"verified"|"refused"|"unverified"|"invalid"}|null>(null);
 const [readAgain,setReadAgain]=useState(0);
 const invoker=useRef<HTMLButtonElement|null>(null);const feedback=useRef<HTMLDivElement>(null);
 const current=()=>mounted.current&&live.current===key;
 const caller=supabase as unknown as ClientDeliveryCaller;
 const restoreFocus=(event:Event)=>{const target=invoker.current;if(target?.isConnected&&!target.disabled){event.preventDefault();target.focus();}else if(feedback.current?.isConnected){event.preventDefault();feedback.current.focus();}};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  const sequence=++requestNo.current;let cancelled=false;
  setRead({key,phase:"loading"});setNote("");setDecision(null);setBusy(writing.current);
  const publish=(state:ReadState)=>{if(!cancelled&&current()&&sequence===requestNo.current)setRead(state);};
  void (async()=>{
   try{
    const before=await supabase.auth.getSession();
    if(!actorId||!tenantId||!releaseId||before.error||before.data.session?.user.id!==actorId){publish({key,phase:"unavailable"});return;}
    const result=await caller.rpc("operations_delivery_client_read_scoped",{p_release_id:releaseId,p_expected_actor_id:actorId,p_expected_tenant_id:tenantId});
    const after=await supabase.auth.getSession();
    const artifact=!result.error&&!after.error&&after.data.session?.user.id===actorId?readClientDeliveryArtifact(result.data,{actorId,tenantId,releaseId}):null;
    publish(artifact?{key,phase:"ready",artifact}:{key,phase:"unavailable"});
   }catch{publish({key,phase:"unavailable"});}
  })();
  return()=>{cancelled=true;};
 // The exact scope/read sequence owns all content. No effective/view-as identity can grant acceptance.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,readAgain]);
 const visible=read.key===key?read:null;
 const result=outcome?.key===key?outcome:null;
 const artifact=visible?.phase==="ready"?visible.artifact:undefined;
 const awaiting=artifact?.state==="awaiting_client";
 const locked=busy||result?.kind==="unverified"||result?.kind==="refused";
 const dirty=Boolean(note)&&awaiting&&!result;
 useBeforeUnloadGuard(busy||Boolean(dirty));
 useEffect(()=>registerAccountSwitchGuard(()=>!busy&&!dirty),[busy,dirty]);
 const review=(choice:"accepted"|"client_revision_requested",button:HTMLButtonElement)=>{
  if(!current()||!awaiting||locked)return;
  if(choice==="client_revision_requested"&&!note.trim()){setOutcome({key,kind:"invalid"});feedback.current?.focus();return;}
  invoker.current=button;setDecision(choice);
 };
 const save=async()=>{
  if(!current()||!artifact||!decision||locked||writing.current)return;
  const choice=decision;writing.current=true;setBusy(true);setDecision(null);
  // Actual session and canonical server authority; no client role inferred from a prop or portal preview.
  const sameScope=()=>current();
  try{
   const session=await supabase.auth.getSession();
   if(session.error||session.data.session?.user.id!==actorId){if(current())setRead({key,phase:"unavailable"});return;}
   const saved=await decideClientDelivery(caller,artifact,choice,note.trim()||null,sameScope);
   const after=await supabase.auth.getSession();
   if(!current())return;
   if(after.error||after.data.session?.user.id!==actorId){setRead({key,phase:"unavailable"});return;}
   if(saved.kind==="verified"){setRead({key,phase:"ready",artifact:saved.artifact});setOutcome({key,kind:"verified"});setNote("");}
   else if(saved.kind!=="scope_changed")setOutcome({key,kind:saved.kind==="invalid"?"invalid":saved.kind==="refused"?"refused":"unverified"});
  }catch{if(current())setOutcome({key,kind:"unverified"});}
  finally{writing.current=false;if(mounted.current)setBusy(false);}
 };
 const refresh=()=>{if(!busy){if(result?.kind!=="unverified")setOutcome(null);setReadAgain(v=>v+1);}};
 return <section className="paige-solo ops-client-review" data-pg={theme} data-theme={theme} aria-label="Review released deliverable">
  {!visible||visible.phase==="loading"?<p role="status">Loading your deliverable...</p>:!artifact?<div role="status"><h1>Review unavailable</h1><p>This exact deliverable cannot be read with your current access. Refresh or ask your delivery team to check the review.</p><button type="button" onClick={refresh}>Check review again</button></div>:<>
   <header><p>Version {artifact.revisionNo} <span>{artifact.state==="accepted"?"Accepted":artifact.state==="client_revision_requested"?"Changes requested":"Ready for your review"}</span></p><h1>{artifact.title}</h1><p>Review the delivered work before accepting this version or requesting changes.</p></header>
   <article tabIndex={0} className="ops-client-artifact" aria-label="Released artifact content">{artifact.body}</article>
   {awaiting&&<div className="ops-client-review-controls"><label>Review note<textarea aria-label="Review note" aria-describedby={reviewNoteHint} maxLength={4000} rows={4} value={note} disabled={locked} onChange={event=>{setNote(event.target.value);if(result?.kind==="invalid")setOutcome(null);}}/><small id={reviewNoteHint}>Describe the changes you need. A note is required when requesting changes.</small></label><div><button type="button" disabled={locked} onClick={event=>review("client_revision_requested",event.currentTarget)}>Request changes</button><button type="button" className="ops-client-primary" disabled={locked} onClick={event=>review("accepted",event.currentTarget)}>Accept this version</button></div></div>}
   <div ref={feedback} tabIndex={-1} role="status" aria-live="polite">{busy&&<p>Saving and checking your decision...</p>}{artifact.state==="accepted"&&<p>Your acceptance is recorded for version {artifact.revisionNo}.</p>}{artifact.state==="client_revision_requested"&&<p>Your changes are recorded for version {artifact.revisionNo}. Your team must submit a new version for review.</p>}{result?.kind==="invalid"&&<p>Add a review note before requesting changes.</p>}{result?.kind==="refused"&&<p>Your decision was refused because the review or your access changed. Check the current review before continuing.</p>}{result?.kind==="unverified"&&awaiting&&<p>Your decision could not be confirmed. Check its recorded state; do not submit another decision while the outcome is unknown.</p>}</div>
   <button type="button" disabled={busy||Boolean(dirty)} onClick={refresh}>Check recorded review</button>{dirty&&<p>Finish or clear your review note before checking the recorded state.</p>}
  </>}
  <AlertDialog open={Boolean(decision)&&Boolean(awaiting)&&!locked} onOpenChange={open=>{if(!open)setDecision(null);}}><AlertDialogContent className="paige-solo ops-client-confirm" data-pg={theme} data-theme={theme} onCloseAutoFocus={restoreFocus}><AlertDialogHeader><AlertDialogTitle>{decision==="accepted"?`Accept version ${artifact?.revisionNo}?`:`Request changes to version ${artifact?.revisionNo}?`}</AlertDialogTitle><AlertDialogDescription>{artifact?.title}. {decision==="accepted"?"This records your explicit acceptance of this delivered version.":"Your review note will be recorded against this version. The team must prepare a new version for your next review."}</AlertDialogDescription></AlertDialogHeader>{note.trim()&&<p className="ops-client-confirm-note">{note}</p>}<AlertDialogFooter><AlertDialogCancel>Keep reviewing</AlertDialogCancel><AlertDialogAction className={decision==="accepted"?"ops-client-primary":undefined} onClick={()=>void save()}>{decision==="accepted"?"Confirm acceptance":"Confirm changes"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
