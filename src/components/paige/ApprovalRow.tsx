// The existing approval door. Acknowledgement is not necessarily execution.
import { useEffect, useId, useRef, useState } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { Timer, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PaigeAttribution } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { resolveVpForActionKind } from "@/lib/paige/vpDepartments";
import { isNativeOwnerTaskApproval, type ApprovalQueueRow } from "@/hooks/usePendingApprovals";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";

const SLA_LABEL: Record<string,string> = { overdue:"Overdue",due_soon:"Due soon",on_track:"On track",closed:"Closed",unscheduled:"No SLA" };
const TICK_COLOR: Record<string,string> = { overdue:"bg-destructive",due_soon:"bg-gradient-gold",on_track:"bg-muted-foreground/40",closed:"bg-muted-foreground/30",unscheduled:"bg-muted-foreground/30" };
const CHIP_COLOR: Record<string,string> = { overdue:"border-destructive/40 text-destructive",due_soon:"border-accent/40 text-accent",on_track:"text-muted-foreground",closed:"text-muted-foreground",unscheduled:"text-muted-foreground" };
function contactLabel(a: ApprovalQueueRow): string {
  return a.contact_first_name || a.contact_last_name ? [a.contact_first_name,a.contact_last_name].filter(Boolean).join(" ") : a.contact_email ?? "—";
}
type Props = { a: ApprovalQueueRow; showDecline?: boolean; /** Explicit parent readback, never replay. */ onResolved?: () => void };
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v==="object" && !Array.isArray(v);
type Report = "executed"|"scheduled"|"queued"|"acknowledged"|"already"|"in_progress"|"unknown"|"refused"|"failed"|"unavailable"|"declined";
const REPORT: Record<Report,string> = {
  executed:"The reviewed action completed.",
  scheduled:"Approved and scheduled. Nothing has been sent yet.",
  queued:"Approved and queued. Execution has not been confirmed.",
  acknowledged:"Approval recorded. No automated action was executed.",
  already:"This approval was already handled. No new execution was confirmed.",
  in_progress:"This approval is in progress. Execution has not been confirmed.",
  unknown:"The outcome could not be confirmed. It may have gone through. Inspect the record and refresh before making another decision.",
  refused:"The request was refused or your workspace changed. No completed action was reported. Refresh before making another decision.",
  failed:"The action reported a failure. No completed action was confirmed. Refresh to inspect its current status.",
  unavailable:"The request could not be started. Refresh before making another decision.",
  declined:"Decline confirmed. The reviewed action was rejected.",
};
/** Only the incumbent endpoint protocol; exact identity is checked by the caller. */
function executionReport(data: Record<string,unknown>): Report {
  if(typeof data.ok!=="boolean" || typeof data.executed!=="boolean") return "unknown";
  if(["scheduled","queued","acknowledged"].some(k=>k in data && typeof data[k]!=="boolean")
    || "already" in data && typeof data.already!=="string") return "unknown";
  const alternatives=[data.scheduled===true,data.queued===true,data.acknowledged===true,typeof data.already==="string"].filter(Boolean).length;
  if(!data.ok) {
    if(data.executed || alternatives) return "unknown";
    return data.act_outcome==="failed" ? "failed" : data.act_outcome==="approval_pending" ? "refused" : "unknown";
  }
  if(data.executed) return alternatives===0 && (data.act_outcome===undefined || data.act_outcome==="executed") ? "executed" : "unknown";
  if(alternatives!==1 || data.act_outcome!==undefined) return "unknown";
  if(data.scheduled===true) return "scheduled";
  if(data.queued===true) return "queued";
  if(data.acknowledged===true) return "acknowledged";
  return data.already==="in_progress" ? "in_progress" : ["approved","sent"].includes(String(data.already)) ? "already" : "unknown";
}

function FollowupReviewLink({a,followup}:{a:ApprovalQueueRow;followup:boolean}) {
  const routed=useInRouterContext();
  return routed?<RoutedFollowupReviewLink a={a} followup={followup}/>:<p className="text-sm text-muted-foreground">Open the original reply in Conversations to review it.</p>;
}
function RoutedFollowupReviewLink({a,followup}:{a:ApprovalQueueRow;followup:boolean}) {
  const {pathname}=useLocation(),routeRoot=tenantRoutePrefixForPath(pathname);
  const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const href=routeRoot&&uuid(a.id)&&uuid(a.contact_id)?`${routeRoot}/clients/conversations?contact=${encodeURIComponent(a.contact_id)}&approval=${encodeURIComponent(a.id)}`:null;
  return href?<Button asChild size="sm" variant="outline" className="min-h-9 h-auto"><Link to={href}>{followup?"Review reply":"Open Conversations"}</Link></Button>
    :<p className="text-sm text-muted-foreground">The original reply is unavailable. Refresh its status before another decision.</p>;
}

export function ApprovalRow(props: Props) {
  const tenant=useTenantContext(), { isImpersonating }=useImpersonation();
  const generation=useRef(0), identityRef=useRef("");
  const latest=useRef(props.a), invalidated=useRef<ApprovalQueueRow|null>(null);
  const [,authChanged]=useState(0);
  const scopeIdentity=JSON.stringify([tenant.activeUserId,tenant.activeTenantId,tenant.loading,tenant.accountContextLoading,tenant.accountContextStatus,isImpersonating]);
  const previousScope=useRef(scopeIdentity);
  if(previousScope.current!==scopeIdentity) { previousScope.current=scopeIdentity;invalidated.current=latest.current; }
  if(invalidated.current && invalidated.current!==props.a) invalidated.current=null;
  if(latest.current!==props.a) generation.current++;
  latest.current=props.a;
  const identity=JSON.stringify([scopeIdentity,
    props.a.id,props.a.tenant_id,props.a.summary,props.a.draft_content,props.a.source,props.a.category,props.a.status]);
  if(identityRef.current!==identity) { identityRef.current=identity; generation.current++; }
  const captured=generation.current;
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(event==="INITIAL_SESSION") return;
      generation.current++;invalidated.current=latest.current;authChanged(n=>n+1);
    });
    return ()=>subscription.unsubscribe();
  },[]);
  const allowed=tenant.accountContextStatus==="ready" && !tenant.loading && !tenant.accountContextLoading && !isImpersonating
    && !!tenant.activeUserId && (!tenant.activeTenantId || props.a.tenant_id===tenant.activeTenantId);
  // A null platform workspace retains its incumbent backend gate, with no new tenant role.
  if(!allowed || invalidated.current) return <div><p role="status">Refresh the approval in your current ordinary workspace to review it. Any previous request may already have gone through.</p>
    {props.onResolved && <Button size="sm" variant="ghost" onClick={props.onResolved}>Refresh status</Button>}</div>;
  return <ApprovalRowContent key={identity+":"+captured} {...props} actorId={tenant.activeUserId!} tenantId={tenant.activeTenantId}
    current={()=>generation.current===captured && identityRef.current===identity}/>;
}

function ApprovalRowContent({a,showDecline=false,onResolved,actorId,tenantId,current}:Props & {
  actorId:string;tenantId:string|null;current:()=>boolean;
}) {
  const id=useId(), mounted=useRef(false), flight=useRef(false);
  const followup=a.category==="owner.lead_followup"||a.category==="client.followup"||a.category==="owner.followup_email";
  const heldEmail=a.type==="email_draft"&&object(a.metadata)&&Object.prototype.hasOwnProperty.call(a.metadata,"held_draft_message_id");
  const [busy,setBusy]=useState(false),[declining,setDeclining]=useState(false),[rationale,setRationale]=useState("");
  const [detail,setDetail]=useState(false),[report,setReport]=useState<Report|null>(null);
  const viewRef=useRef<HTMLButtonElement>(null),closeRef=useRef<HTMLButtonElement>(null),declineRef=useRef<HTMLButtonElement>(null),reasonRef=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(detail) closeRef.current?.focus();},[detail]);
  useEffect(()=>{if(declining) reasonRef.current?.focus();},[declining]);
  const live=()=>mounted.current && current();
  const close=()=>{setDetail(false);viewRef.current?.focus();};
  const cancel=()=>{setDeclining(false);declineRef.current?.focus();};
  const decide=async(decline:boolean)=>{
    if(flight.current || report || !live() || decline && !rationale.trim()) return;
    flight.current=true;setBusy(true);
    const expires=performance.now()+8_000;let dispatched=false;
    const check=()=>{if(!live() || performance.now()>=expires) throw new Error("intent_expired");};
    const wait=<T,>(start:()=>PromiseLike<T>):Promise<T>=>{
      check();
      return new Promise<T>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("intent_expired")),Math.max(0,expires-performance.now()));
        Promise.resolve().then(()=>{check();return start();}).then(value=>{
          clearTimeout(timer);try{check();resolve(value);}catch(error){reject(error);}
        },error=>{clearTimeout(timer);reject(error);});
      });
    };
    const authority=async()=>{
      const user=await wait(()=>supabase.auth.getUser());
      if(user.error || user.data.user?.id!==actorId) throw new Error("authority_changed");
      const workspace=await wait(()=>supabase.rpc("current_user_tenant_id"));
      if(workspace.error || workspace.data!==tenantId) throw new Error("authority_changed");
      check();
    };
    try {
      await authority();let next:Report;
      if(decline) {
        const reason=rationale.trim();
        // Only the canonical native family uses the exact-version domain
        // rejection writer. Other families retain their incumbent RLS writer.
        const result=await wait<{data:unknown;error:unknown}>(()=>{
          if(isNativeOwnerTaskApproval(a)) {
            if(typeof a.updated_at!=="string" || !a.updated_at) throw new Error("review_version_required");
            dispatched=true;
            // Exact additive migration ABI until generated client types catch up;
            // neither this port nor the UI supplies actor/tenant/task authority.
            const caller=supabase as unknown as {rpc(name:"decline_owner_task_approval",args:{_approval_id:string;_expected_updated_at:string;_reason:string}):PromiseLike<{data:unknown;error:unknown}>};
            return caller.rpc("decline_owner_task_approval",{_approval_id:a.id,_expected_updated_at:a.updated_at,_reason:reason});
          }
          dispatched=true;
          let q=supabase.from("paige_pending_approvals").update({status:"rejected",decision_rationale:reason,reviewed_at:new Date().toISOString()})
            .eq("id",a.id).eq("status","pending");
          q=a.tenant_id ? q.eq("tenant_id",a.tenant_id) : q.is("tenant_id",null);
          return q.select("id,tenant_id,status,decision_rationale").maybeSingle();
        });
        const native=isNativeOwnerTaskApproval(a);
        const data=object(result.data)?result.data:null;
        const uuid=(v:unknown)=>typeof v==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
        next=!result.error && data?.id===a.id && data.tenant_id===a.tenant_id && data.status==="rejected"
          && (native ? data.receipt_recorded===true && data.act_outcome==="cancelled" && uuid(data.receipt_id) && uuid(data.reviewed_by_user_id)
            && typeof data.reviewed_at==="string" && Number.isFinite(Date.parse(data.reviewed_at))
            && typeof data.updated_at==="string" && Number.isFinite(Date.parse(data.updated_at))
            && typeof data.decision_rationale==="string" && typeof data.replayed==="boolean"
            && (data.replayed || data.reviewed_by_user_id===actorId && data.decision_rationale===reason) : data.decision_rationale===reason) ? "declined":"unknown";
      } else {
        const result=await wait(()=>{dispatched=true;return supabase.functions.invoke("execute-approval",{body:{approval_id:a.id}});});
        next=result.error || !object(result.data) || result.data.approval_id!==a.id
          || a.source==="paige_orchestration" && result.data.executed===true && result.data.act_outcome!=="executed"
          ? "unknown":executionReport(result.data);
      }
      await authority();
      if(live()) {setReport(next);setDeclining(false);}
    } catch {if(live()) setReport(dispatched?"unknown":"unavailable");}
    // Latch this intent even before React paints its report. Only a newly read
    // parent row remounts the control; refresh itself never replays the decision.
    finally {if(live()) setBusy(false);}
  };
  const dc:unknown=a.draft_content;
  const fallback=object(dc) ? [dc.subject,dc.body,dc.preview].find(x=>typeof x==="string") as string|undefined : typeof dc==="string" ? dc:"";
  const summary=a.summary ?? fallback;
  const args=a.source==="paige_orchestration" && a.category==="owner.task" && object(dc) && dc.capability==="owner.task" && object(dc.args) ? dc.args:null;
  const state=a.sla_state,draftedVp=resolveVpForActionKind(a.category);
  return <div className="cc-collapse" aria-busy={busy}><div>
    <div className="relative flex items-start gap-2.5 rounded-md border p-2.5 pl-3 hover:bg-muted/40 transition-colors">
      <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full",TICK_COLOR[state] ?? "bg-muted-foreground/30")}/>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium whitespace-pre-wrap break-words min-w-0">{summary || "(no summary)"}</p>
          <Badge variant="outline" className={cn("shrink-0 text-[10px] tabular-nums",CHIP_COLOR[state] ?? "")}><Timer className="mr-1 h-3 w-3"/>{SLA_LABEL[state] ?? state}</Badge>
        </div>
        {args && <div className="space-y-1 whitespace-pre-wrap break-words text-sm">
          {typeof args.title==="string" && <p>{args.title}</p>}{typeof args.description==="string" && <p>{args.description}</p>}
        </div>}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {a.category && <span className="capitalize">{a.category.replace(/_/g," ")}</span>}
          {a.contact_id && <span className="inline-flex items-center gap-1 min-w-0"><User className="h-3 w-3 shrink-0"/><span className="break-words">{contactLabel(a)}</span></span>}
        </div>
        {draftedVp && <PaigeAttribution contributors={[{vp:draftedVp}]} size="sm" showMark={false} leadIn="Drafted by your Paige team"/>}
        <div className="flex flex-wrap items-center justify-end gap-1.5 pt-0.5">
          {followup||heldEmail ? <FollowupReviewLink a={a} followup={followup}/>
            :<Button size="sm" onClick={()=>void decide(false)} disabled={busy || !!report || a.status!=="pending"}
              className="min-h-9 h-auto bg-gradient-gold text-accent-foreground hover:opacity-90">{busy?"Checking…":"Approve"}</Button>}
          <Button size="sm" variant="ghost" className="min-h-9 h-auto" ref={viewRef} aria-expanded={detail} aria-controls={detail?id+"-detail":undefined} onClick={()=>setDetail(true)}>View</Button>
          {showDecline && <Button size="sm" variant="ghost" className="min-h-9 h-auto text-muted-foreground" ref={declineRef}
            onClick={()=>setDeclining(true)} disabled={busy || !!report || a.status!=="pending"}>Decline</Button>}
        </div>
        {detail && <section id={id+"-detail"} className="space-y-2 rounded-md border p-2 text-sm whitespace-pre-wrap break-words" aria-label="Reviewed action details"
          onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();close();}}}>
          {object(dc) ? <>{typeof dc.subject==="string" && <p>{dc.subject}</p>}{typeof dc.body==="string" && <p>{dc.body}</p>}
            {typeof dc.preview==="string" && dc.preview!==dc.body && <p>{dc.preview}</p>}</>:<p>{typeof dc==="string"?dc:summary}</p>}
          <Button size="sm" variant="ghost" ref={closeRef} onClick={close}>Close details</Button>
        </section>}
        {busy && <p role="status" className="text-sm text-muted-foreground">Checking the reviewed action…</p>}
        {report && <div className="space-y-1"><p role="status" className="text-sm">{REPORT[report]}</p>
          {onResolved ? <Button size="sm" variant="ghost" onClick={()=>{if(live()) onResolved();}}>Refresh status</Button>
            :<p className="text-sm text-muted-foreground">Refresh this view to inspect the current status.</p>}</div>}
        {showDecline && declining && <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2"
          onKeyDown={e=>{if(e.key==="Escape" && !busy){e.preventDefault();cancel();}}}>
          <label htmlFor={id+"-reason"} className="text-sm">Reason for declining</label>
          <Textarea id={id+"-reason"} ref={reasonRef} value={rationale} onChange={e=>setRationale(e.target.value)} rows={2}
            maxLength={isNativeOwnerTaskApproval(a)?2000:undefined}
            placeholder={isNativeOwnerTaskApproval(a)?"What needs to change? Your reason will be recorded.":"What needs to change? Paige learns from this."} className="text-sm"/>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="outline" onClick={()=>void decide(true)} disabled={busy || !!report || !rationale.trim()}>Decline action</Button>
          </div>
        </div>}
      </div>
    </div>
  </div></div>;
}
