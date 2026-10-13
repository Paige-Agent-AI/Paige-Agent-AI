// Experience 03 · S3 — binding a drafted lead reply's approval to ONE governed email send.
//
// The reply screen sends the reply through this door (comms.email_send) and names the approval it
// answers. The door never trusts that claim: before anything is proposed or prepared it re-reads, with
// the service role and filtered to the server-derived tenant, that the approval is
//   * in this business,
//   * still `pending`,
//   * the approval of an `owner.lead_followup` action (metadata.action_id → paige_actions whose
//     approval_id points back at it, same business) — the one send-kind with a record path,
//   * for the SAME person the email goes to (the action's contact, and the approval's own contact
//     when it carries one).
// The approval id is part of the fingerprinted arguments, so a card approved for one approval can
// never be confirmed against another. After the provider accepts the send, the door records it on
// the approval through lead_reply_record_send_service (20271031000000), which re-proves everything
// in SQL. A failure to record never turns an accepted send into a failed one: the email went out.
//
// Deno-free and dependency-free so node:test drives it directly.
import { UUID } from "../_shared/comms-email/contract.ts";

export const LEAD_REPLY_ACTION_KIND = "owner.lead_followup" as const;

export type LeadReplyApprovalRefusal =
  | "LEAD_REPLY_APPROVAL_UNAVAILABLE"     // the read failed: nothing was proposed or sent; safe to retry
  | "LEAD_REPLY_APPROVAL_NOT_FOUND"       // no such approval in THIS business (another business's id reads the same)
  | "LEAD_REPLY_APPROVAL_NOT_PENDING"     // already approved / declined / sent
  | "LEAD_REPLY_APPROVAL_WRONG_KIND"      // not a drafted reply to a new lead
  | "LEAD_REPLY_APPROVAL_CONTACT_MISMATCH"; // the approval is for a different person

interface ReadResult { data: unknown; error: unknown }
interface ReadQuery { eq(column: string, value: unknown): ReadQuery; maybeSingle(): PromiseLike<ReadResult> }
/** The slice of the service client this check uses. */
export interface LeadReplyApprovalAdmin {
  from(table: string): { select(columns: string): ReadQuery };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<ReadResult>;
}
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const lower = (v: unknown): string | null => typeof v === "string" ? v.trim().toLowerCase() : null;

/** null = the approval may carry this send; otherwise the refusal code. Never throws. */
export async function verifyLeadReplyApproval(
  admin: LeadReplyApprovalAdmin,
  input: { tenantId: string; approvalId: string; contactId: string },
): Promise<LeadReplyApprovalRefusal | null> {
  try {
    const tenantId = lower(input.tenantId), approvalId = lower(input.approvalId), contactId = lower(input.contactId);
    if (!tenantId || !approvalId || !contactId || !UUID.test(tenantId) || !UUID.test(approvalId) || !UUID.test(contactId)) return "LEAD_REPLY_APPROVAL_NOT_FOUND";
    const ap = await admin.from("paige_pending_approvals").select("id,tenant_id,status,contact_id,metadata")
      .eq("id", approvalId).eq("tenant_id", tenantId).maybeSingle();
    if (ap.error) return "LEAD_REPLY_APPROVAL_UNAVAILABLE";
    const approval = object(ap.data);
    if (!approval || lower(approval.id) !== approvalId || lower(approval.tenant_id) !== tenantId) return "LEAD_REPLY_APPROVAL_NOT_FOUND";
    if (approval.status !== "pending") return "LEAD_REPLY_APPROVAL_NOT_PENDING";
    const actionId = lower(object(approval.metadata)?.action_id);
    if (!actionId || !UUID.test(actionId)) return "LEAD_REPLY_APPROVAL_WRONG_KIND";
    const act = await admin.from("paige_actions").select("id,tenant_id,approval_id,action_kind,contact_id")
      .eq("id", actionId).eq("tenant_id", tenantId).eq("approval_id", approvalId).maybeSingle();
    if (act.error) return "LEAD_REPLY_APPROVAL_UNAVAILABLE";
    const action = object(act.data);
    if (!action || lower(action.id) !== actionId || lower(action.tenant_id) !== tenantId || lower(action.approval_id) !== approvalId
      || action.action_kind !== LEAD_REPLY_ACTION_KIND) return "LEAD_REPLY_APPROVAL_WRONG_KIND";
    if (lower(action.contact_id) !== contactId) return "LEAD_REPLY_APPROVAL_CONTACT_MISMATCH";
    if (approval.contact_id !== null && approval.contact_id !== undefined && lower(approval.contact_id) !== contactId) return "LEAD_REPLY_APPROVAL_CONTACT_MISMATCH";
    return null;
  } catch {
    return "LEAD_REPLY_APPROVAL_UNAVAILABLE";
  }
}

/**
 * The approval the STORED (approved) call carries must be the one this request names — both absent,
 * or the same id. Anything else is a card approved for one approval being confirmed against another.
 */
export function storedApprovalMatches(storedArgs: unknown, requestApprovalId: string | undefined): boolean {
  const stored = object(storedArgs)?.approval_id;
  if (requestApprovalId === undefined) return stored === undefined || stored === null;
  return typeof stored === "string" && stored.toLowerCase() === requestApprovalId.toLowerCase();
}

export type LeadReplyRecordStatus = "recorded" | "pending_record";

/**
 * Record a provider-accepted send on its approval (lead_reply_record_send_service). Only a
 * `{ ok: true }` answer is "recorded"; an error, a throw or any other answer is "pending_record" —
 * the send stays accepted and the record can be retried (the same operation replays through this door,
 * or the reply screen calls lead_reply_record_send). Never throws.
 */
export async function recordLeadReplySend(
  admin: LeadReplyApprovalAdmin,
  input: { approvalId: string; operationId: string; actorUserId: string },
): Promise<LeadReplyRecordStatus> {
  try {
    const { data, error } = await admin.rpc("lead_reply_record_send_service", {
      _approval_id: input.approvalId, _operation_id: input.operationId, _actor: input.actorUserId,
    });
    return !error && object(data)?.ok === true ? "recorded" : "pending_record";
  } catch {
    return "pending_record";
  }
}
