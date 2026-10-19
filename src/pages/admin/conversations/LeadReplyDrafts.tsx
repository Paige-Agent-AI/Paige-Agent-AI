import { useCallback, useEffect, useRef, useState } from "react";
import { usePendingApprovals, type ApprovalQueueRow } from "@/hooks/usePendingApprovals";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UUID, parseCommsEmailCommand } from "../../../../supabase/functions/_shared/comms-email/contract";

import { isFollowupEmailKind, useLeadReplyReview, parseOriginalReplyRecord, readOriginalReplyRecord, ORIGINAL_REPLY_COLS } from "./useLeadReplyReview";
import { shapeEmailDraft } from "../../../../supabase/functions/paige-action-worker/draft";

type EntryProps = {
  tenantId: string; contactId: string; approval: ApprovalQueueRow; canEdit: boolean;
  disabled: boolean; recordDisabled: boolean; onEdit: (approval: ApprovalQueueRow, draft: { subject: string; body: string }) => void;
  current: () => boolean;
  actorId:string|null; threadKey:string|null;
};
type Readback = { scope: object; editable: boolean; loading: boolean; note: string | null; original?:unknown };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const UNCONFIRMED = "This reply already has a recorded sending attempt. Don't resend. Check its recorded status.";
const UNVERIFIED = "Sending status couldn't be verified. Don't resend. Check its recorded status.";

function OriginalReplyReport({actorId,tenantId,contactId,threadKey,approvalId,original,disabled,current}:{actorId:string|null;tenantId:string;contactId:string;threadKey:string|null;approvalId:string;original:unknown;disabled:boolean;current:()=>boolean}){
  const proof=parseOriginalReplyRecord(original,{actorId,tenantId,contactId,threadKey,approvalId});
  const review=useLeadReplyReview({actorId,tenantId,contactId,threadKey,approvalId,connectorId:proof?.connectorId??"",channel:"email",subject:proof?.call.command.subject??"",body:proof?.call.command.body??"",attachmentCount:0,uploading:false,scheduledFor:null,signatureEnabled:false,disabled,current,originalRecord:original},()=>{});
  return review.panel;
}
function LeadReplyDraftEntry({tenantId,contactId,approval,canEdit,disabled,recordDisabled,onEdit,current:isCurrent,actorId,threadKey}: EntryProps) {
  const key=JSON.stringify([actorId,tenantId,contactId,threadKey,approval.id]);
  const scopeRef=useRef({key});
  if(scopeRef.current.key!==key)scopeRef.current={key};
  const scope=scopeRef.current, request=useRef(0);
  const [record,setRecord]=useState<Readback|null>(null);
  const current=record?.scope===scope?record:null;
  const refresh=useCallback(async()=>{
    const attempt=++request.current;
    const settle=(editable:boolean,note:string|null,original?:unknown)=>{if(request.current===attempt&&scopeRef.current===scope&&isCurrent())setRecord({scope,editable,loading:false,note,original});};
    const wait=async<T,>(start:()=>PromiseLike<T>):Promise<T>=>{const check=()=>{if(request.current!==attempt||scopeRef.current!==scope||!isCurrent())throw Error("scope_changed");};check();const result=await start();check();return result;};
    setRecord({scope,editable:false,loading:true,note:null});
    try {
      // Existing Messages is the durable record, including after a reload. This read must
      // never re-enter the command door: some legacy reconciliation paths can send again.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result=object(await (supabase as any).from("messages")
        .select(ORIGINAL_REPLY_COLS)
        .eq("tenant_id",tenantId).eq("contact_id",contactId).eq("meta->comms_email_binding->>approval_id",approval.id)
        .order("created_at",{ascending:false}).limit(21));
      if(!result||result.error!==null||!Array.isArray(result.data)||result.data.length>=21){settle(false,UNVERIFIED);return;}
      const rows: Record<string,unknown>[]=[];
      for(const raw of result.data){
        const row=object(raw);
        if(!row||typeof row.id!=="string"||!UUID.test(row.id)||row.tenant_id!==tenantId||row.contact_id!==contactId||row.lead_reply_approval_id!==approval.id||row.channel_type!=="email"||row.direction!=="outbound"||typeof row.comms_email_operation!=="string"||!UUID.test(row.comms_email_operation)||typeof row.comms_email_state!=="string"){
          settle(false,UNVERIFIED);return;
        }
        rows.push(row);
      }
      const retryable=(row:Record<string,unknown>)=>["failed","refused"].includes(String(row.comms_email_state))&&["draft","blocked","failed"].includes(String(row.status))&&row.provider_message_id===null;
      const live=rows.filter(row=>!retryable(row));
      if(!live.length){
        const metadata=object(approval.metadata);
        if(metadata&&Object.prototype.hasOwnProperty.call(metadata,"governed_send")){
          const prior=object(metadata.governed_send)?.operation_id;
          if(typeof prior!=="string"||!UUID.test(prior)||!rows.some(row=>row.comms_email_operation===prior&&retryable(row))){settle(false,UNVERIFIED);return;}
        }
        settle(approval.status==="pending",approval.status==="pending"?null:"This reply is no longer pending. No new send is available.");return;
      }
      const sent=live.length===1?live[0]:null;
      if(sent?.comms_email_state==="provider_accepted"&&typeof sent.provider_message_id==="string"&&sent.provider_message_id.trim()&&["sent","read","delivered"].includes(String(sent.status))){
        let original:unknown;
        if(threadKey&&actorId&&UUID.test(actorId)&&object(sent.original_binding)){
          try{original=await readOriginalReplyRecord({actorId,tenantId,contactId,threadKey,approvalId:approval.id},rows,wait);}catch{/* Accepted is retained; unavailable historical authority stays status-only. */}
        }
        settle(false,(sent.status==="delivered"?"Delivery confirmed in this conversation.":"Accepted by the email service. Delivery is not confirmed.")+(approval.status==="approved"?"":" Approval recording is still unconfirmed. Don't resend."),original);return;
      }
      settle(false,UNCONFIRMED);
    }catch{settle(false,UNVERIFIED);}
  },[scope,tenantId,contactId,approval.id,approval.status,approval.metadata,isCurrent,actorId,threadKey]);
  useEffect(()=>{if(canEdit)void refresh();return()=>{request.current+=1;};},[canEdit,refresh]);
  const stored=object(approval.draft_content),nested=object(stored?.draft);
  // Older successful composer envelopes predate the worker's flat projection.
  // Reuse that exact projection for review only; never rewrite the saved row or
  // address a message from model output. Competing flat fields are ambiguous.
  const draft=stored?.channel===undefined&&stored?.ok===true&&nested
    &&(nested.channel===undefined||nested.channel==="email")
    &&!["subject","body","body_text","body_html"].some(key=>Object.hasOwn(stored,key))
    ?shapeEmailDraft(stored):stored;
  let ready=false;
  try { if(draft?.channel==="email") { parseCommsEmailCommand({action:"comms.email_send",contact_id:contactId,connector_id:null,subject:draft.subject,body:draft.body});ready=true; } } catch { /* Legacy malformed content grants no send authority. */ }
  return <div className="space-y-2">
    <p className="text-sm font-medium">{current?.original?"Original reply":ready?"PAIGE prepared a reply":"Reply draft needs attention"}</p>
    {!current?.original&&(ready?<p className="break-words text-sm text-muted-foreground">{draft.subject as string}</p>:<p className="text-sm text-muted-foreground">No complete email draft is available.</p>)}
    {!canEdit?<p className="text-xs text-muted-foreground">An owner or admin can review and approve this reply.</p>
      : !current||current.loading?<p role="status" className="text-sm text-muted-foreground">Checking this reply's recorded status…</p>
      : current.editable?(ready?<Button variant="outline" size="sm" className="hover:text-secondary-foreground" disabled={disabled} onClick={()=>{if(isCurrent())onEdit(approval,{subject:draft!.subject as string,body:draft!.body as string});}}>Edit and review reply</Button>:null)
      : current.original?<OriginalReplyReport actorId={actorId} tenantId={tenantId} contactId={contactId} threadKey={threadKey} approvalId={approval.id} original={current.original} disabled={recordDisabled} current={isCurrent}/>
      : <><p role="status" className="text-sm text-muted-foreground">{current.note}</p><Button variant="outline" size="sm" className="hover:text-secondary-foreground" disabled={recordDisabled} onClick={()=>{void refresh();}}>Check sending status</Button></>}
  </div>;
}

/** A contextual entry to the existing composer; the approval queue remains the draft's home. */
export function LeadReplyDrafts({ tenantId, contactId, actorId, approvalId, threadKey=null, onEdit, disabled, recordDisabled=disabled, current:parentCurrent }: {
  tenantId: string;
  contactId: string;
  actorId: string | null;
  approvalId?: string | null;
  /** The currently authorized conversation, never inferred from a historical message id. */
  threadKey?:string|null;
  current?: () => boolean;
  onEdit: (approval: ApprovalQueueRow, draft: { subject: string; body: string }) => void;
  disabled: boolean;
  /** Historical status/recording eligibility only; never enables edit, approval or sending. */
  recordDisabled?: boolean;
}) {
  const approvals = usePendingApprovals({ contactId });
  const [authEpoch,setAuthEpoch]=useState(0);
  const withdrawn=useRef(false);
  const latestParent=useRef(parentCurrent);latestParent.current=parentCurrent;
  useEffect(()=>{const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{if(event!=="INITIAL_SESSION"){
    withdrawn.current=event!=="TOKEN_REFRESHED"&&event!=="SIGNED_IN";
    authorityScopeRef.current={key:"retired-auth-generation"};setAuthEpoch(n=>n+1);
  }});return()=>subscription.unsubscribe();},[]);
  const key=JSON.stringify([actorId,tenantId,contactId,threadKey,approvalId,authEpoch]);
  const authorityScopeRef = useRef({ key });
  if (authorityScopeRef.current.key !== key) authorityScopeRef.current = { key };
  const authorityScope = authorityScopeRef.current;
  const [authority, setAuthority] = useState<{ scope: object; canEdit: boolean } | null>(null);
  const canEdit = authority?.scope === authorityScope && authority.canEdit;
  const isCurrent=useCallback(()=>{try{return authorityScopeRef.current===authorityScope&&!withdrawn.current&&(parentCurrent===undefined||parentCurrent()===true)
    &&(latestParent.current===undefined||latestParent.current()===true);}catch{return false;}},[authorityScope,parentCurrent]);
  const [selection,setSelection]=useState<{scope:object;row:ApprovalQueueRow|null}|null>(null);
  useEffect(() => {
    let current = true;
    setAuthority({ scope: authorityScope, canEdit: false });
    void (async () => {
      try {
        if(!isCurrent() || !actorId) return;
        const user=await supabase.auth.getUser();if(!isCurrent()||user.error||user.data.user?.id!==actorId)return;
        const workspace=await supabase.rpc("current_user_tenant_id");if(!isCurrent()||workspace.error||workspace.data!==tenantId)return;
        const { data, error } = await supabase.rpc("is_tenant_admin" as never, { _tenant: tenantId } as never);
        if (current&&isCurrent()) setAuthority({ scope: authorityScope, canEdit: error === null && data === true });
      } catch {
        if (current) setAuthority({ scope: authorityScope, canEdit: false });
      }
    })();
    return () => { current = false; };
  }, [tenantId, actorId, authorityScope,isCurrent]);
  useEffect(()=>{
    let live=true;setSelection(null);
    if(approvalId===undefined)return;
    if(typeof approvalId!=="string"||!UUID.test(approvalId)||!canEdit){setSelection({scope:authorityScope,row:null});return;}
    void(async()=>{try{
      const {data,error}=await supabase.from("paige_approval_queue_v").select("*").eq("id",approvalId).eq("tenant_id",tenantId).eq("contact_id",contactId).limit(2);
      if(!live||!isCurrent())return;
      const row=!error&&Array.isArray(data)&&data.length===1?data[0] as ApprovalQueueRow:null;
      setSelection({scope:authorityScope,row:row&&row.id===approvalId&&row.tenant_id===tenantId&&row.contact_id===contactId&&isFollowupEmailKind(row.category)?row:null});
    }catch{if(live&&isCurrent())setSelection({scope:authorityScope,row:null});}})();
    return()=>{live=false;};
  },[approvalId,canEdit,authorityScope,tenantId,contactId,isCurrent]);
  const drafts = approvalId!==undefined ? selection?.scope===authorityScope&&selection.row?[selection.row]:[]
    : approvals.items.filter((a) => a.tenant_id === tenantId && a.contact_id === contactId && a.status === "pending" && isFollowupEmailKind(a.category));
  if(withdrawn.current)return <p role="status">Your account changed. Reopen the original reply before another decision.</p>;
  if(approvalId!==undefined&&!drafts.length)return <p role="status" className="text-sm text-muted-foreground">{!selection||selection.scope!==authorityScope?"Checking the selected reply…":"The selected reply is unavailable in this conversation. No replacement was selected."}</p>;
  if (approvals.error) return <p role="status" className="text-sm text-muted-foreground">Reply drafts couldn't load. <button type="button" className="underline" onClick={() => { void approvals.refresh(); }}>Try again</button></p>;
  if (!drafts.length) return null;
  return <section aria-label="PAIGE lead replies" className="space-y-3 border-t border-border pt-3">
    {drafts.map(approval=><LeadReplyDraftEntry key={`${key}:${approval.id}`} actorId={actorId} threadKey={threadKey} tenantId={tenantId} contactId={contactId} approval={approval} canEdit={canEdit} disabled={disabled} recordDisabled={recordDisabled} onEdit={onEdit} current={isCurrent}/>)}
  </section>;
}
