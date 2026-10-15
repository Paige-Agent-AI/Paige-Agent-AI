import { useCallback, useEffect, useRef, useState } from "react";
import { usePendingApprovals, type ApprovalQueueRow } from "@/hooks/usePendingApprovals";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GOVERNED_SEND_COLS } from "./governedSend";
import { UUID } from "../../../../supabase/functions/_shared/comms-email/contract";

type EntryProps = {
  tenantId: string; contactId: string; approval: ApprovalQueueRow; canEdit: boolean;
  disabled: boolean; onEdit: (approval: ApprovalQueueRow, draft: { subject: string; body: string }) => void;
};
type Readback = { scope: object; editable: boolean; loading: boolean; note: string | null };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const UNCONFIRMED = "This reply already has a recorded sending attempt. Don't resend. Check its recorded status.";
const UNVERIFIED = "Sending status couldn't be verified. Don't resend. Check its recorded status.";

function LeadReplyDraftEntry({tenantId,contactId,approval,canEdit,disabled,onEdit}: EntryProps) {
  const key=JSON.stringify([tenantId,contactId,approval.id]);
  const scopeRef=useRef({key});
  if(scopeRef.current.key!==key)scopeRef.current={key};
  const scope=scopeRef.current, request=useRef(0);
  const [record,setRecord]=useState<Readback|null>(null);
  const current=record?.scope===scope?record:null;
  const refresh=useCallback(async()=>{
    const attempt=++request.current;
    const settle=(editable:boolean,note:string|null)=>{if(request.current===attempt&&scopeRef.current===scope)setRecord({scope,editable,loading:false,note});};
    setRecord({scope,editable:false,loading:true,note:null});
    try {
      // Existing Messages is the durable record, including after a reload. This read must
      // never re-enter the command door: some legacy reconciliation paths can send again.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result=object(await (supabase as any).from("messages")
        .select(`id,tenant_id,contact_id,channel_type,direction,status,provider_message_id,lead_reply_approval_id:meta->comms_email_binding->>approval_id,${GOVERNED_SEND_COLS}`)
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
      if(!live.length){settle(true,null);return;}
      const sent=live.length===1?live[0]:null;
      if(sent?.comms_email_state==="provider_accepted"&&typeof sent.provider_message_id==="string"&&sent.provider_message_id.trim()&&["sent","read","delivered"].includes(String(sent.status))){
        settle(false,sent.status==="delivered"?"Delivery confirmed in this conversation.":"Accepted by the email service. Delivery is not confirmed.");return;
      }
      settle(false,UNCONFIRMED);
    }catch{settle(false,UNVERIFIED);}
  },[scope,tenantId,contactId,approval.id]);
  useEffect(()=>{if(canEdit)void refresh();return()=>{request.current+=1;};},[canEdit,refresh]);
  const draft=object(approval.draft_content);
  const ready=draft?.channel==="email"&&typeof draft.subject==="string"&&draft.subject.trim()&&typeof draft.body==="string"&&draft.body.trim();
  return <div className="space-y-2">
    <p className="text-sm font-medium">{ready?"PAIGE prepared a reply":"Reply draft needs attention"}</p>
    {ready?<p className="break-words text-sm text-muted-foreground">{draft.subject as string}</p>:<p className="text-sm text-muted-foreground">No complete email draft is available.</p>}
    {!canEdit?<p className="text-xs text-muted-foreground">An owner or admin can review and approve this reply.</p>
      : !current||current.loading?<p role="status" className="text-sm text-muted-foreground">Checking this reply's recorded status…</p>
      : current.editable?(ready?<Button variant="outline" size="sm" className="hover:text-secondary-foreground" disabled={disabled} onClick={()=>onEdit(approval,{subject:draft.subject as string,body:draft.body as string})}>Edit and review reply</Button>:null)
      : <><p role="status" className="text-sm text-muted-foreground">{current.note}</p><Button variant="outline" size="sm" className="hover:text-secondary-foreground" disabled={disabled} onClick={()=>{void refresh();}}>Check sending status</Button></>}
  </div>;
}

/** A contextual entry to the existing composer; the approval queue remains the draft's home. */
export function LeadReplyDrafts({ tenantId, contactId, onEdit, disabled }: {
  tenantId: string;
  contactId: string;
  onEdit: (approval: ApprovalQueueRow, draft: { subject: string; body: string }) => void;
  disabled: boolean;
}) {
  const approvals = usePendingApprovals({ contactId });
  const authorityScopeRef = useRef({ tenantId });
  if (authorityScopeRef.current.tenantId !== tenantId) authorityScopeRef.current = { tenantId };
  const authorityScope = authorityScopeRef.current;
  const [authority, setAuthority] = useState<{ scope: object; canEdit: boolean } | null>(null);
  const canEdit = authority?.scope === authorityScope && authority.canEdit;
  useEffect(() => {
    let current = true;
    setAuthority({ scope: authorityScope, canEdit: false });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("is_tenant_admin" as never, { _tenant: tenantId } as never);
        if (current) setAuthority({ scope: authorityScope, canEdit: error === null && data === true });
      } catch {
        if (current) setAuthority({ scope: authorityScope, canEdit: false });
      }
    })();
    return () => { current = false; };
  }, [tenantId, authorityScope]);
  const drafts = approvals.items.filter((a) => a.tenant_id === tenantId && a.contact_id === contactId && a.status === "pending" && a.category === "owner.lead_followup");
  if (approvals.error) return <p role="status" className="text-sm text-muted-foreground">Reply drafts couldn't load. <button type="button" className="underline" onClick={() => { void approvals.refresh(); }}>Try again</button></p>;
  if (!drafts.length) return null;
  return <section aria-label="PAIGE lead replies" className="space-y-3 border-t border-border pt-3">
    {drafts.map(approval=><LeadReplyDraftEntry key={approval.id} tenantId={tenantId} contactId={contactId} approval={approval} canEdit={canEdit} disabled={disabled} onEdit={onEdit}/>)}
  </section>;
}
