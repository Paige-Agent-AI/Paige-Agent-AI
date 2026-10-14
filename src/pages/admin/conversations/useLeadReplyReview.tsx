import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PaigeConfirmCard, type ConfirmActionState } from "@/components/chat/PaigeConfirmCard";
import { parseConfirmPreview, type ConfirmEmailPreview } from "@/components/chat/confirmPreview";
import { Button } from "@/components/ui/button";
import { parseCommsEmailCommand, FINGERPRINT, type CommsEmailCommand } from "../../../../supabase/functions/_shared/comms-email/contract";
import { GOVERNED_SEND_COLS } from "./governedSend";

type Input = {
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
};
type Call = { expected_tenant_id: string; operation_id: string; approval_id: string; command: CommsEmailCommand };
type Review = {
  scope: object;
  revision: object;
  call: Call;
  phase: "decide" | "report";
  state: ConfirmActionState;
  summary: string;
  preview?: ConfirmEmailPreview;
  fingerprint?: string;
  expiresAt?: number;
  note?: string;
  canCheck?: boolean;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// A surface adapter for the existing command door and confirmation card. It neither grants
// authority nor writes approvals/messages. Only the server-resolved exact preview is approvable.
export function useLeadReplyReview(input: Input, onAccepted: () => void) {
  const scopeKey = JSON.stringify([input.tenantId, input.contactId, input.threadKey]);
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const scope = scopeRef.current;
  const revisionKey = JSON.stringify(input);
  const revisionRef = useRef({ key: revisionKey });
  if (revisionRef.current.key !== revisionKey) revisionRef.current = { key: revisionKey };
  const revision = revisionRef.current;
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<{ scope: object; text: string } | null>(null);
  const [busyScope, setBusyScope] = useState<object | null>(null);
  const lock = useRef<object | null>(null);
  const accepted = useRef<Set<string>>(new Set());
  const current = review?.scope === scope ? review : null;
  const busy = busyScope === scope;
  const currentScope = (requestScope: object) => live.current && scopeRef.current === requestScope;
  const hasUnsettledSend = current?.phase === "report" && (current.state === "working" || current.state === "unconfirmed");

  const prepare = async () => {
    if (input.disabled || hasUnsettledSend || lock.current === scope) return;
    setError(null);
    const refuse = (text: string) => setError({ scope, text });
    if (!input.tenantId || !input.contactId || !input.threadKey || !input.approvalId) return refuse("Open the lead reply in its original conversation first.");
    if (input.channel !== "email") return refuse("Lead reply approval needs a business email identity.");
    if (input.uploading || input.attachmentCount) return refuse("Attachments are not supported by this lead reply approval yet. Remove them to review this reply; your draft is kept.");
    if (input.scheduledFor) return refuse("Scheduled lead replies are not supported by this approval yet. Clear the schedule to review now; your draft is kept.");
    if (input.signatureEnabled) return refuse("Turn off the automatic signature and include its words in the draft before reviewing this lead reply.");
    let command: CommsEmailCommand;
    try {
      command = parseCommsEmailCommand({ action: "comms.email_send", contact_id: input.contactId, connector_id: input.connectorId || null, subject: input.subject, body: input.body });
    } catch { return refuse("Choose a sending address and add a subject (up to 200 characters) and reply (up to 10,000 characters)."); }
    const call: Call = { expected_tenant_id: input.tenantId, operation_id: crypto.randomUUID(), approval_id: input.approvalId, command };
    lock.current = scope; setBusyScope(scope); setReview(null);
    try {
      const response = await supabase.functions.invoke("comms-email-command", { body: call });
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
      setReview({ scope, revision, call, phase: "decide", state: "pending", summary: result.summary, preview, fingerprint: result.fingerprint, expiresAt });
    } catch {
      if (currentScope(scope) && revisionRef.current === revision) refuse("Couldn't prepare the review. Nothing was approved here; your draft is kept.");
    } finally {
      if (lock.current === scope) lock.current = null;
      if (currentScope(scope)) setBusyScope(null);
    }
  };

  const approve = async (fingerprints: string[]) => {
    if (!current || current.phase !== "decide" || input.disabled || lock.current === scope) return;
    if (current.revision !== revision || current.expiresAt! <= Date.now() || fingerprints.length !== 1 || fingerprints[0] !== current.fingerprint) {
      setReview(null); setError({ scope, text: "The draft or sending identity changed, or this review expired. Review the current reply again." }); return;
    }
    lock.current = scope; setBusyScope(scope);
    setReview({ ...current, phase: "report", state: "working", fingerprint: undefined, note: "Sending the exact reply you approved…" });
    try {
      const response = await supabase.functions.invoke("comms-email-command", { body: { ...current.call, approved_fingerprint: current.fingerprint } });
      if (!currentScope(scope)) return;
      const result = response.error ? null : object(response.data);
      // Missing/malformed/error answers are unknown, never a safe-to-retry failure.
      if (result?.outcome === "provider_accepted" && result.ok === true && result.operation_id === current.call.operation_id && result.provider_receipt_available === true) {
        setReview({ ...current, phase: "report", state: "done", fingerprint: undefined, note: "Accepted by the email service. Delivery is not confirmed." });
        if (!accepted.current.has(current.call.operation_id)) { accepted.current.add(current.call.operation_id); onAccepted(); }
      } else if (result && ["refused", "failed", "held", "needs_setup"].includes(String(result.outcome))) {
        setReview({ ...current, phase: "report", state: "failed", fingerprint: undefined, note: result.outcome === "held" ? "Not sent. Sending is held; review a fresh approval when it is allowed." : "Not sent. Your draft is kept; check the contact and business email before reviewing again." });
      } else {
        setReview({ ...current, phase: "report", state: "unconfirmed", fingerprint: undefined, canCheck: true, note: "Couldn't confirm whether this reply went out. Don't resend. Check its recorded status." });
      }
    } catch {
      if (currentScope(scope)) setReview({ ...current, phase: "report", state: "unconfirmed", fingerprint: undefined, canCheck: true, note: "Couldn't confirm whether this reply went out. Don't resend. Check its recorded status." });
    } finally {
      if (lock.current === scope) lock.current = null;
      if (currentScope(scope)) setBusyScope(null);
    }
  };

  const checkStatus = async () => {
    if (!current?.canCheck || lock.current === scope) return;
    lock.current = scope; setBusyScope(scope);
    try {
      // Receipt-only read. Re-entering the command door can reconcile some legacy providers by
      // sending again; a UI status check must never invoke that pathway.
      // messages is not in generated client types yet; match the mounted inbox's read adapter.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (supabase as any).from("messages").select(`id, tenant_id, contact_id, status, provider_message_id, ${GOVERNED_SEND_COLS}`)
        .eq("tenant_id", current.call.expected_tenant_id).eq("contact_id", current.call.command.contact_id)
        .eq("meta->comms_email_binding->>operation_id", current.call.operation_id).limit(1).maybeSingle();
      if (!currentScope(scope)) return;
      const row = response.error ? null : object(response.data);
      if (row?.tenant_id === current.call.expected_tenant_id && row.contact_id === current.call.command.contact_id && row.comms_email_operation === current.call.operation_id) {
        if (row.comms_email_state === "provider_accepted" && typeof row.provider_message_id === "string" && row.provider_message_id && ["sent", "delivered"].includes(String(row.status))) {
          setReview({ ...current, state: "done", canCheck: false, note: row.status === "delivered" ? "Delivery confirmed in this conversation." : "Accepted by the email service. Delivery is not confirmed." });
          if (!accepted.current.has(current.call.operation_id)) { accepted.current.add(current.call.operation_id); onAccepted(); }
          return;
        }
        if (["failed", "refused"].includes(String(row.comms_email_state))) {
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
  const panel = <>
    {error?.scope === scope ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{error.text}</p> : null}
    {stale ? <p role="status" className="px-3 py-2 text-sm text-muted-foreground">The draft changed. Review the current reply again before approving.</p> : current ? (
      <div className="space-y-2 border-t border-border px-3 py-3">
        {current.phase === "decide" ? <PaigeConfirmCard actions={[{ summary: current.summary, fingerprint: current.fingerprint, preview: current.preview }]} disabled={busy || input.disabled} focusOnMount onApprove={(fps) => { void approve(fps); }} onDeny={() => setReview(null)} />
          : <PaigeConfirmCard mode="report" actions={[{ summary: current.summary, preview: current.preview, state: current.state, note: current.note }]} note={current.note} focusOnMount />}
        {current.canCheck ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { void checkStatus(); }}>{busy ? "Checking…" : "Check sending status"}</Button> : null}
      </div>
    ) : null}
  </>;
  return { prepare, panel, busy, blocksSending: !!hasUnsettledSend || busy };
}
