import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PaigeConfirmCard, type ConfirmActionState } from "@/components/chat/PaigeConfirmCard";
import { parseConfirmPreview, type ConfirmEmailPreview } from "@/components/chat/confirmPreview";
import { Button } from "@/components/ui/button";
import { parseCommsEmailCommand, FINGERPRINT, UUID, type CommsEmailCommand } from "../../../../supabase/functions/_shared/comms-email/contract";
import { GOVERNED_SEND_COLS } from "./governedSend";

export const isFollowupEmailKind = (kind: unknown) => kind === "owner.lead_followup" || kind === "client.followup" || kind === "owner.followup_email";
export type FollowupLocator = { kind:"none" } | {kind:"invalid"} | {kind:"bound";contactId:string;approvalId:string};
/** Navigation claim only. The original-JWT exact queue/door reads remain authority. */
export function parseFollowupLocator(search: URLSearchParams): FollowupLocator {
  if (!search.has("approval")) return {kind:"none"};
  const contacts=search.getAll("contact"),approvals=search.getAll("approval");
  if (contacts.length!==1 || approvals.length!==1 || !UUID.test(contacts[0]) || !UUID.test(approvals[0])) return {kind:"invalid"};
  return {kind:"bound",contactId:contacts[0].toLowerCase(),approvalId:approvals[0].toLowerCase()};
}
export function canReplaceFollowupDraft(value: {subject:string;body:string;attachmentCount:number;scheduledFor:string|null;editingDraftId:string|null;approvalId:string|null;pending:boolean}) {
  return !value.subject.trim() && !value.body.trim() && !value.attachmentCount && !value.scheduledFor && !value.editingDraftId && !value.approvalId && !value.pending;
}

type Input = {
  actorId: string | null;
  tenantId: string | null;
  contactId: string | null;
  threadKey: string | null;
  approvalId: string | null;
  connectorId: string;
  channel: string;
  subject: string;
  body: string;
  attachmentCount: number;
  uploading: boolean;
  scheduledFor: string | null;
  signatureEnabled: boolean;
  disabled: boolean;
  /** Captured monotonic parent fence, never a replacement for server authority. */
  current?: () => boolean;
};
type Call = { expected_tenant_id: string; operation_id: string; approval_id: string; command: CommsEmailCommand };
type Wait = <T>(start: () => PromiseLike<T>) => Promise<T>;
type Review = {
  scope: object;
  identity: string;
  revision: object;
  call: Call;
  phase: "decide" | "report";
  state: ConfirmActionState;
  summary: string;
  preview?: ConfirmEmailPreview;
  fingerprint?: string;
  /** Retained only for the already-approved original call; never spent again. */
  approvedFingerprint?: string;
  expiresAt?: number;
  note?: string;
  canCheck?: boolean;
  recordPending?: boolean;
  acceptedMessageId?: string;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// A surface adapter for the existing command door, confirmation card and record-only RPC.
// It grants no authority and performs no direct table writes. Only the exact preview is approvable.
export function useLeadReplyReview(sourceInput: Input, onAccepted: () => void) {
  const input={...sourceInput};
  const [authEpoch, setAuthEpoch] = useState(0);
  const withdrawn = useRef(false);
  const identity=JSON.stringify([input.actorId,input.tenantId,input.contactId,input.threadKey]);
  const latestInput=useRef(input);latestInput.current=input;
  const scopeKey = JSON.stringify([identity, authEpoch]);
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const scope = scopeRef.current;
  // A temporary navigation/readiness hold blocks dispatch without changing the approved words.
  const revisionKey = JSON.stringify([input.actorId,input.tenantId,input.contactId,input.threadKey,input.approvalId,
    input.connectorId,input.channel,input.subject,input.body,input.attachmentCount,input.uploading,input.scheduledFor,input.signatureEnabled]);
  const revisionRef = useRef({ key: revisionKey });
  if (revisionRef.current.key !== revisionKey) revisionRef.current = { key: revisionKey };
  const revision = revisionRef.current;
  let currentEligible=false;
  try{currentEligible=!input.disabled&&(input.current===undefined||input.current()===true);}catch{ /* a failed parent fence withdraws eligibility */ }
  const eligibilityRef=useRef({scope,revision,eligible:currentEligible});
  if(eligibilityRef.current.scope!==scope||eligibilityRef.current.revision!==revision||eligibilityRef.current.eligible!==currentEligible)
    eligibilityRef.current={scope,revision,eligible:currentEligible};
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === "INITIAL_SESSION") return;
      // Retire old closures synchronously, including before React commits the epoch update.
      // Routine refresh/sign-in still requires fresh getUser + tenant checks on the next action.
      withdrawn.current = event!=="TOKEN_REFRESHED"&&event!=="SIGNED_IN";
      scopeRef.current={key:"retired-auth-generation"};setAuthEpoch(value => value + 1);
    });
    return () => subscription.unsubscribe();
  }, []);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<{ scope: object; text: string } | null>(null);
  const [busyScope, setBusyScope] = useState<object | null>(null);
  const lock = useRef<object | null>(null);
  const attempt = useRef<{ scope: object; revision: object; call: Call } | null>(null);
  const accepted = useRef<Set<string>>(new Set());
  const dispatchedOperations=useRef<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const originalAfterRefresh=review?.identity===identity&&review.call.approval_id===input.approvalId
    &&review.phase==="report"&&(review.state==="working"||review.state==="unconfirmed")&&dispatchedOperations.current.has(review.call.operation_id);
  // Refresh retires the old card, but cannot turn an initiated original send into a new operation.
  // Only a neutral original-attempt reader remains; its reads/recording revalidate current auth.
  const authWithdrawn=withdrawn.current;
  const current=useMemo<Review|null>(()=>review?.scope===scope?review:!authWithdrawn&&originalAfterRefresh
    ?{...review,scope,phase:"report",state:"unconfirmed",fingerprint:undefined,preview:undefined,summary:"Original reply",canCheck:true,
      note:"Your session changed while an original reply outcome was retained. Don't resend. Check its recorded status."}:null,[review,scope,authWithdrawn,originalAfterRefresh]);
  const busy = busyScope === scope;
  const currentScope = (requestScope: object) => {
    try{return live.current&&!withdrawn.current&&scopeRef.current===requestScope&&(input.current===undefined||input.current()===true)
      &&(latestInput.current.current===undefined||latestInput.current.current()===true);}catch{return false;}
  };
  const actionEligibility=()=>{
    const gate=eligibilityRef.current;
    return()=>{if(!gate.eligible||gate!==eligibilityRef.current||input.disabled||latestInput.current.disabled||!currentScope(scope))throw new Error("eligibility_changed");};
  };
  const waitFor = (requestScope:object,eligible?:()=>void):Wait => {
    const deadline=performance.now()+8_000;
    const check=()=>{if(!currentScope(requestScope)||performance.now()>=deadline)throw new Error("request_expired");eligible?.();};
    return start=>new Promise((resolve,reject)=>{
      try{check();}catch(error){reject(error);return;}
      const timer=setTimeout(()=>reject(new Error("request_expired")),Math.max(0,deadline-performance.now()));
      Promise.resolve().then(()=>{check();return start();}).then(value=>{clearTimeout(timer);try{check();resolve(value);}catch(error){reject(error);}},error=>{clearTimeout(timer);reject(error);});
    });
  };
  const authority = async (requestScope: object, wait:Wait) => {
    const check = () => { if (!currentScope(requestScope)) throw new Error("scope_changed"); };
    check();
    const caller = supabase;
    const user = await wait(()=>caller.auth.getUser()); check();
    if (user.error || !input.actorId || user.data.user?.id !== input.actorId) throw new Error("actor_changed");
    const tenant = await wait(()=>caller.rpc("current_user_tenant_id")); check();
    if (tenant.error || tenant.data !== input.tenantId) throw new Error("tenant_changed");
  };
  const hasUnsettledSend = current?.phase === "report" && (current.state === "working" || current.state === "unconfirmed");
  useEffect(() => {
    if (!current || (current.phase === "decide" && current.revision !== revision)) return;
    // Review is an intentional entry: focus the existing card, never its Approve button.
    // Background readback must not pull focus out of a field the owner has resumed editing.
    if (document.activeElement?.matches("input, textarea, [role='combobox']")) return;
    panelRef.current?.querySelector<HTMLElement>("[role='group']")?.focus();
  }, [current, revision]);
  const dismiss = () => { setReview(null); if (triggerRef.current?.isConnected) triggerRef.current.focus(); };

  const prepare = async () => {
    if (input.disabled || hasUnsettledSend || current?.state === "done" || lock.current === scope || !currentScope(scope)) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null);
    const refuse = (text: string) => setError({ scope, text });
    if (![input.actorId,input.tenantId,input.contactId,input.approvalId].every(value => typeof value === "string" && UUID.test(value)) || !input.threadKey) return refuse("Open the lead reply in its original conversation first.");
    if (input.channel !== "email") return refuse("Lead reply approval needs a business email identity.");
    if (input.uploading || input.attachmentCount) return refuse("Attachments are not supported by this lead reply approval yet. Remove them to review this reply; your draft is kept.");
    if (input.scheduledFor) return refuse("Scheduled lead replies are not supported by this approval yet. Clear the schedule to review now; your draft is kept.");
    if (input.signatureEnabled) return refuse("Turn off the automatic signature and include its words in the draft before reviewing this lead reply.");
    let command: CommsEmailCommand;
    try {
      command = parseCommsEmailCommand({ action: "comms.email_send", contact_id: input.contactId, connector_id: input.connectorId || null, subject: input.subject, body: input.body });
    } catch { return refuse("Choose a sending address and add a subject (up to 200 characters) and reply (up to 10,000 characters)."); }
    // A lost/malformed preparation ACK cannot mint another operation for the same intent.
    const call: Call = attempt.current?.scope === scope && attempt.current.revision === revision ? attempt.current.call
      : { expected_tenant_id: input.tenantId!, operation_id: crypto.randomUUID(), approval_id: input.approvalId!, command };
    attempt.current = { scope, revision, call };
    lock.current = scope; setBusyScope(scope); setReview(null);
    const wait=waitFor(scope,actionEligibility());
    try {
      await authority(scope,wait);
      const response = await wait(()=>supabase.functions.invoke("comms-email-command", { body: call }));
      await authority(scope,wait);
      if (!currentScope(scope) || revisionRef.current !== revision) return;
      const result = response.error ? null : object(response.data);
      const preview = parseConfirmPreview(result?.preview);
      const expiresAt = typeof result?.expires_at === "string" ? Date.parse(result.expires_at) : NaN;
      if (result?.outcome !== "approval_required" || result.operation_id !== call.operation_id
        || typeof result.fingerprint !== "string" || !FINGERPRINT.test(result.fingerprint)
        || typeof result.summary !== "string" || !result.summary.trim() || !preview
        || preview.subject !== command.subject || preview.body_text !== command.body
        || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        refuse("This reply isn't ready for approval. Your draft is kept. Check the contact and business email setup, then review again.");
        return;
      }
      setReview({ scope, identity, revision, call, phase: "decide", state: "pending", summary: result.summary, preview, fingerprint: result.fingerprint, expiresAt });
    } catch {
      if (currentScope(scope) && revisionRef.current === revision) refuse("Couldn't prepare the review. Nothing was approved here; your draft is kept.");
    } finally {
      if (lock.current === scope) lock.current = null;
      if (currentScope(scope)) setBusyScope(null);
    }
  };

  const approve = async (fingerprints: string[]) => {
    if (!current || current.phase !== "decide" || input.disabled || lock.current === scope || !currentScope(scope)) return;
    if (current.revision !== revision || current.expiresAt! <= Date.now() || fingerprints.length !== 1 || fingerprints[0] !== current.fingerprint) {
      dismiss(); setError({ scope, text: "The draft or sending identity changed, or this review expired. Review the current reply again." }); return;
    }
    lock.current = scope; setBusyScope(scope);
    const original = { ...current, approvedFingerprint: current.fingerprint };
    setReview({ ...original, phase: "report", state: "working", fingerprint: undefined, note: "Sending the exact reply you approved…" });
    const wait=waitFor(scope,actionEligibility());
    let dispatched=false;
    try {
      await authority(scope,wait);
      const response = await wait(()=>{
        dispatched=true;dispatchedOperations.current.add(current.call.operation_id);
        return supabase.functions.invoke("comms-email-command", { body: { ...current.call, approved_fingerprint: current.fingerprint } });
      });
      await authority(scope,wait);
      if (!currentScope(scope)) return;
      const result = response.error ? null : object(response.data);
      // Missing/malformed/error answers are unknown, never a safe-to-retry failure.
      if (result?.outcome === "provider_accepted" && result.ok === true && result.operation_id === current.call.operation_id && result.provider_receipt_available === true
        && result.approval_id === current.call.approval_id && typeof result.message_id === "string" && UUID.test(result.message_id) && result.delivery_confirmed === false) {
        const recordPending = result.record_status !== "recorded";
        setReview({ ...original, phase: "report", state: recordPending?"unconfirmed":"done", fingerprint: undefined, recordPending, canCheck:recordPending,acceptedMessageId:result.message_id,
          note: "Accepted by the email service. Delivery is not confirmed." + (recordPending ? " The approval record is still unconfirmed. Don't resend." : "") });
        if (!accepted.current.has(current.call.operation_id)) { accepted.current.add(current.call.operation_id); onAccepted(); }
      } else if (result && ["refused", "failed", "held", "needs_setup"].includes(String(result.outcome))) {
        setReview({ ...original, phase: "report", state: "failed", fingerprint: undefined, note: result.outcome === "held" ? "Not sent. Sending is held; review a fresh approval when it is allowed." : "Not sent. Your draft is kept; check the contact and business email before reviewing again." });
      } else {
        setReview({ ...original, phase: "report", state: "unconfirmed", fingerprint: undefined, canCheck: true, note: "Couldn't confirm whether this reply went out. Don't resend. Check its recorded status." });
      }
    } catch {
      if(!dispatched&&scopeRef.current===scope&&!withdrawn.current)setReview(current);
      else if(currentScope(scope))setReview({ ...original, phase: "report", state: "unconfirmed", fingerprint: undefined, canCheck: true, note: "Couldn't confirm whether this reply went out. Don't resend. Check its recorded status." });
    } finally {
      if (lock.current === scope) lock.current = null;
      if (currentScope(scope)) setBusyScope(null);
    }
  };

  const finishRecording = async () => {
    if(!current?.recordPending||!current.acceptedMessageId||!current.approvedFingerprint||!FINGERPRINT.test(current.approvedFingerprint)||busy||input.disabled||lock.current===scope||!currentScope(scope))return;
    lock.current=scope;setBusyScope(scope);
    const wait=waitFor(scope,actionEligibility());
    try{
      await authority(scope,wait);
      // Recheck the exact accepted original before the existing record-only native door.
      // Never re-enter comms-email-command: its absent/unknown paths can propose/reconcile.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proof=await wait<{data:unknown;error:unknown}>(()=>(supabase as any).from("messages")
        .select(`id,tenant_id,contact_id,channel_type,direction,status,provider_message_id,connector_id,subject,body_text,send_actor_id:meta->comms_email_binding->>actor_user_id,lead_reply_approval_id:meta->comms_email_binding->>approval_id,${GOVERNED_SEND_COLS}`)
        .eq("tenant_id",current.call.expected_tenant_id).eq("contact_id",current.call.command.contact_id)
        .eq("meta->comms_email_binding->>approval_id",current.call.approval_id)
        .eq("meta->comms_email_binding->>operation_id",current.call.operation_id).limit(2));
      await authority(scope,wait);
      const row=proof.error||!Array.isArray(proof.data)||proof.data.length!==1?null:object(proof.data[0]);
      if(!row||row.id!==current.acceptedMessageId||row.tenant_id!==current.call.expected_tenant_id
        ||row.contact_id!==current.call.command.contact_id||row.send_actor_id!==input.actorId
        ||row.lead_reply_approval_id!==current.call.approval_id||row.comms_email_operation!==current.call.operation_id
        ||row.channel_type!=="email"||row.direction!=="outbound"||row.comms_email_state!=="provider_accepted"
        ||!["sent","read","delivered"].includes(String(row.status))||typeof row.provider_message_id!=="string"||!row.provider_message_id.trim()
        ||row.connector_id!==current.call.command.connector_id||row.subject!==current.call.command.subject||row.body_text!==current.call.command.body)throw new Error("original_receipt_unverified");
      // The installed authenticated two-UUID RPC predates its generated client declaration.
      const recorder=supabase as unknown as {rpc(name:"lead_reply_record_send",args:{_approval_id:string;_operation_id:string}):PromiseLike<{data:unknown;error:unknown}>};
      const response=await wait(()=>recorder.rpc("lead_reply_record_send",{_approval_id:current.call.approval_id,_operation_id:current.call.operation_id}));
      await authority(scope,wait);if(!currentScope(scope))return;
      const result=response.error?null:object(response.data);
      const recorded=result?.ok===true&&result.state==="provider_accepted"&&result.operation_id===current.call.operation_id
        &&result.approval_id===current.call.approval_id&&result.message_id===current.acceptedMessageId
        &&result.delivery_confirmed===false;
      setReview({...current,state:recorded?"done":"unconfirmed",recordPending:!recorded,canCheck:!recorded,
        note:recorded?"The original accepted reply is recorded. Delivery is not confirmed.":"The original email was accepted, but approval recording is still unconfirmed. Don't resend."});
    }catch{if(currentScope(scope))setReview({...current,note:"The original email was accepted, but approval recording is still unconfirmed. Don't resend."});}
    finally{if(lock.current===scope)lock.current=null;if(currentScope(scope))setBusyScope(null);}
  };

  const checkStatus = async () => {
    if (!current?.canCheck || lock.current === scope || !currentScope(scope)) return;
    lock.current = scope; setBusyScope(scope);
    const wait=waitFor(scope);
    try {
      await authority(scope,wait);
      // Receipt-only read. Re-entering the command door can reconcile some legacy providers by
      // sending again; a UI status check must never invoke that pathway.
      // messages is not in generated client types yet; match the mounted inbox's read adapter.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await wait<{data:unknown;error:unknown}>(()=>(supabase as any).from("messages").select(`id, tenant_id, contact_id, channel_type, direction, status, provider_message_id, send_actor_id:meta->comms_email_binding->>actor_user_id, lead_reply_approval_id:meta->comms_email_binding->>approval_id, ${GOVERNED_SEND_COLS}`)
        .eq("tenant_id", current.call.expected_tenant_id).eq("contact_id", current.call.command.contact_id)
        .eq("meta->comms_email_binding->>approval_id", current.call.approval_id)
        .eq("meta->comms_email_binding->>operation_id", current.call.operation_id).limit(2));
      await authority(scope,wait);
      if (!currentScope(scope)) return;
      const row = response.error || !Array.isArray(response.data) || response.data.length !== 1 ? null : object(response.data[0]);
      if (typeof row?.id === "string" && UUID.test(row.id) && row.tenant_id === current.call.expected_tenant_id && row.contact_id === current.call.command.contact_id
        && row.send_actor_id === input.actorId && row.lead_reply_approval_id === current.call.approval_id && row.channel_type === "email" && row.direction === "outbound" && row.comms_email_operation === current.call.operation_id) {
        if (row.comms_email_state === "provider_accepted" && typeof row.provider_message_id === "string" && row.provider_message_id.trim() && ["sent", "read", "delivered"].includes(String(row.status))) {
          setReview({ ...current, state: "unconfirmed", recordPending:true, canCheck:true, acceptedMessageId:row.id, note: (row.status === "delivered" ? "Delivery confirmed in this conversation." : "Accepted by the email service. Delivery is not confirmed.") + " Approval recording has not been confirmed here. Don't resend." });
          if (!accepted.current.has(current.call.operation_id)) { accepted.current.add(current.call.operation_id); onAccepted(); }
          return;
        }
        if (["failed", "refused"].includes(String(row.comms_email_state)) && ["draft","blocked","failed"].includes(String(row.status)) && row.provider_message_id === null) {
          setReview({ ...current, state: "failed", canCheck: false, note: "The recorded attempt did not complete. Your draft is kept; review again before another attempt." }); return;
        }
      }
      setReview({ ...current, note: "No confirmed outcome is available yet. Don't resend. You can check this same recorded attempt again." });
    } catch {
      if (currentScope(scope)) setReview({ ...current, note: "Status is unavailable. Don't resend; check this recorded attempt again later." });
    } finally {
      if (lock.current === scope) lock.current = null;
      if (currentScope(scope)) setBusyScope(null);
    }
  };

  const stale = current?.phase === "decide" && current.revision !== revision;
  const panel = withdrawn.current ? <p role="status" className="px-3 py-2 text-sm">Your account changed. Reopen the original reply to inspect its outcome before another decision.</p>
    :!currentScope(scope)?<p role="status" className="px-3 py-2 text-sm">The original reply is held while this workspace is unavailable. Return to its current authorized scope before another decision.</p>:<>
    {error?.scope === scope ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{error.text}</p> : null}
    {stale ? <p role="status" className="px-3 py-2 text-sm text-muted-foreground">The draft changed. Review the current reply again before approving.</p> : current ? (
      <div ref={panelRef} className="space-y-2 border-t border-border px-3 py-3">
        {current.phase === "decide" ? <PaigeConfirmCard actions={[{ summary: current.summary, fingerprint: current.fingerprint, preview: current.preview }]} disabled={busy || input.disabled} focusOnMount onApprove={(fps) => { void approve(fps); }} onDeny={dismiss} />
          : <PaigeConfirmCard mode="report" actions={[{ summary: current.summary, preview: current.preview, state: current.state, note: current.note }]} note={current.note} focusOnMount />}
        {current.canCheck ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { void checkStatus(); }}>{busy ? "Checking…" : "Check sending status"}</Button> : null}
        {current.recordPending&&current.acceptedMessageId?<Button variant="outline" size="sm" disabled={busy||input.disabled} onClick={()=>{void finishRecording();}}>Finish recording reply</Button>:null}
      </div>
    ) : null}
  </>;
  const reset = () => { if (busy || hasUnsettledSend) return false; attempt.current=null;setReview(null);setError(null);return true; };
  return { prepare, panel, busy, reset, blocksSending: !!hasUnsettledSend || busy || current?.state === "done", blocksEditing: !!hasUnsettledSend || busy };
}
