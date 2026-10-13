// execute-approval — the outbound-message refusal, and how send-message's answer is read.
//
// An approval minted by advance_action for a `send_via_approval` action kind (client.followup,
// owner.lead_followup, owner.followup_email, owner.sms_nudge, comms-draft-reply, sales.work_followup,
// finance.retainer_reminder, social.post_publish …) carries metadata.action_id. Approving one of those
// through this door used to fall through to the "acknowledge" path: the row was marked approved,
// trg_ppa_sync_action marked the action DONE, and NOTHING was sent — a false success (§13).
//
// Owner ruling (exp03): an outbound message to a contact is sent ONLY through the governed email
// command (comms-email-command / comms.email_send: server-resolved recipient and sender, a
// single-use fingerprint approval bound to the exact words, operation_id idempotency). There is no
// second sender path. So this door does not send these, and does not acknowledge them either: it
// REFUSES — 409 send_requires_review — before it claims, writes or calls anything. The approval
// stays pending; it can still be declined. Production 2026-10-13: 125 pending client.followup
// approvals in the legacy nested draft shape — every one of them is refused here, never sent.
//
// Free of Deno-only imports so vitest drives it against an in-memory client; index.ts injects the
// service client.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────── send-message's answer ───────────────────────── */

export type SendOutcome =
  | { kind: "sent"; auditId: string | null }
  /** Held by the pre-send seam (quiet hours / tenant DND): ACCEPTED — a message row is queued to go later. */
  | { kind: "queued"; outcome: string; scheduledFor: string | null; messageId: string | null }
  | { kind: "failed"; error: string };

/**
 * send-message answers a quiet-hours/DND hold with status:'failed' plus a queued_* outcome (it never
 * invents a new status value, §37). That is NOT a failure: the message row is queued and will go out.
 * Releasing the claim on it let a second Approve queue a SECOND copy — the double send this fixes.
 */
export function classifySendResult(httpOk: boolean, body: unknown): SendOutcome {
  const b = obj(body);
  if (httpOk && b.status === "sent") return { kind: "sent", auditId: typeof b.audit_id === "string" ? b.audit_id : null };
  if (httpOk && typeof b.outcome === "string" && b.outcome.startsWith("queued_")) {
    return {
      kind: "queued", outcome: b.outcome,
      scheduledFor: typeof b.scheduled_for === "string" ? b.scheduled_for : null,
      messageId: typeof b.message_id === "string" ? b.message_id : null,
    };
  }
  return { kind: "failed", error: typeof b.error === "string" && b.error ? b.error : (typeof b.outcome === "string" && b.outcome ? b.outcome : "send_failed") };
}

/* ───────────────────────── the outbound-message refusal ───────────────────────── */

interface Res { data: unknown; error: unknown }
interface ReadQ { eq(column: string, value: unknown): ReadQ; maybeSingle(): PromiseLike<Res> }
/** The slice of the service client this module uses: two filtered reads, no writes. */
export interface SendKindAdmin {
  from(table: string): { select(columns: string): ReadQ };
}

export interface ApprovalRowForRefusal {
  id: string;
  metadata: unknown;
}

export interface RefusalResult { status: number; payload: Obj }

const SEND_KIND_EXECUTOR = "send_via_approval";

export const SEND_REQUIRES_REVIEW_REASON =
  "This is an outbound message. Approving it here would not send it, so it was left pending. " +
  "It goes out only after it is reviewed and sent from the business's verified email — or it can be declined.";

/** The action id an approval names, when it names one. */
export function approvalActionId(metadata: unknown): string | null {
  const id = str(obj(metadata).action_id);
  return UUID.test(id) ? id : null;
}

/**
 * Decide whether this door must refuse an approval because it is an outbound message.
 *   null            → not an action-backed send (no action_id, the action is gone, or a non-send kind):
 *                     the caller continues exactly as before (§58).
 *   409             → the action is a send_via_approval kind, in any draft shape: refused. No claim,
 *                     no acknowledge, no send-message call, no write of any kind.
 *   503             → the action or its kind could not be read: unavailable, never a guess either way.
 *
 * The send-kind refusal does not depend on the action's tenant or on the draft: whatever the row
 * looks like, a send kind is never sent or completed from here. (The payload carries nothing read
 * from the action row, so a crafted approval naming another business's action learns nothing.)
 */
export async function refuseSendKindApproval(admin: SendKindAdmin, approval: ApprovalRowForRefusal): Promise<RefusalResult | null> {
  const actionId = approvalActionId(approval.metadata);
  if (!actionId) return null;
  const unavailable = (detail: string): RefusalResult =>
    ({ status: 503, payload: { ok: false, executed: false, error: "unavailable", detail, approval_id: approval.id } });

  const actionRead = await admin.from("paige_actions").select("id,action_kind").eq("id", actionId).maybeSingle();
  if (actionRead.error) return unavailable("action_read_failed");
  const action = obj(actionRead.data);
  if (action.id !== actionId) return null; // the action is gone: nothing names a kind (0 such rows in production, 2026-10-13)

  const kindRead = await admin.from("paige_action_kinds").select("slug,executor").eq("slug", String(action.action_kind ?? "")).maybeSingle();
  if (kindRead.error) return unavailable("action_kind_read_failed");
  if (obj(kindRead.data).executor !== SEND_KIND_EXECUTOR) return null;

  return {
    status: 409,
    payload: { ok: false, executed: false, error: "send_requires_review", reason: SEND_REQUIRES_REVIEW_REASON, approval_id: approval.id },
  };
}
