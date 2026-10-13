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
/** A filtered read: awaited for a list, or maybeSingle() for one row (the supabase-js builder shape). */
interface ReadQ extends PromiseLike<Res> {
  eq(column: string, value: unknown): ReadQ;
  in(column: string, values: unknown[]): ReadQ;
  maybeSingle(): PromiseLike<Res>;
}
/** The slice of the service client this module uses: filtered reads only, no writes. */
export interface SendKindAdmin {
  from(table: string): { select(columns: string): ReadQ };
}

export interface ApprovalRowForRefusal {
  id: string;
  tenant_id?: string | null;
  metadata: unknown;
}

export interface RefusalResult { status: number; payload: Obj }

const SEND_KIND_EXECUTOR = "send_via_approval";
const LEAD_REPLY_KIND = "owner.lead_followup";

/** What the person can do instead, per kind. Only a reply to a new lead has a review-and-send screen. */
export const SEND_REFUSAL = {
  review_and_send: "This reply goes out only from the business's verified email. Review and send it from the reply screen.",
  decline_only: "This can be declined for now; sending it from here isn't available yet.",
} as const;
export type SendRefusalCode = keyof typeof SEND_REFUSAL;

const lower = (v: unknown): string => str(v).toLowerCase();

/** The action id an approval names, when it names one — lower-cased, so it compares with what the database returns. */
export function approvalActionId(metadata: unknown): string | null {
  const id = lower(obj(metadata).action_id);
  return UUID.test(id) ? id : null;
}

/**
 * Decide whether this door must refuse an approval because it is an outbound message. It reads the
 * same two signals the database guard (paige_guard_send_approval_requires_governed_send) reads: the
 * action named by metadata.action_id, and any action whose approval_id is this approval — so dropping
 * or rewriting metadata.action_id cannot route a send past this door. Ids compare case-insensitively.
 *   null → no send action stands behind this approval: the caller continues exactly as before (§58).
 *   409  → a send_via_approval action does, in any draft shape: refused. No claim, no acknowledge, no
 *          send-message call, no write of any kind. reason_code says what the person can do instead:
 *          review_and_send (a reply to a new lead of this same business) or decline_only (every other
 *          send kind — client.followup, owner.sms_nudge, social.post_publish, ...).
 *   503  → an action or its kind could not be read: unavailable, never a guess either way.
 * The payload carries nothing read from the action row; a crafted approval naming another business's
 * reply is told decline_only, exactly like any other send it cannot complete here.
 */
export async function refuseSendKindApproval(admin: SendKindAdmin, approval: ApprovalRowForRefusal): Promise<RefusalResult | null> {
  const approvalId = lower(approval.id);
  const unavailable = (detail: string): RefusalResult =>
    ({ status: 503, payload: { ok: false, executed: false, error: "unavailable", detail, approval_id: approval.id } });

  const actions: Obj[] = [];
  const named = approvalActionId(approval.metadata);
  if (named) {
    const read = await admin.from("paige_actions").select("id,tenant_id,action_kind,approval_id").eq("id", named).maybeSingle();
    if (read.error) return unavailable("action_read_failed");
    const row = obj(read.data);
    if (lower(row.id) === named) actions.push(row); // gone → names no kind (0 such rows in production, 2026-10-13)
  }
  if (UUID.test(approvalId)) {
    const back = await admin.from("paige_actions").select("id,tenant_id,action_kind,approval_id").eq("approval_id", approvalId);
    if (back.error) return unavailable("action_read_failed");
    for (const r of Array.isArray(back.data) ? back.data : []) {
      const row = obj(r);
      if (lower(row.approval_id) === approvalId && !actions.some((a) => lower(a.id) === lower(row.id))) actions.push(row);
    }
  }
  if (actions.length === 0) return null;

  const slugs = [...new Set(actions.map((a) => str(a.action_kind)).filter(Boolean))];
  if (slugs.length === 0) return null;
  const kindRead = await admin.from("paige_action_kinds").select("slug,executor").in("slug", slugs);
  if (kindRead.error) return unavailable("action_kind_read_failed");
  const sendSlugs = new Set((Array.isArray(kindRead.data) ? kindRead.data : [])
    .map(obj).filter((k) => k.executor === SEND_KIND_EXECUTOR).map((k) => str(k.slug)));
  const sends = actions.filter((a) => sendSlugs.has(str(a.action_kind)));
  if (sends.length === 0) return null;

  const tenant = lower(approval.tenant_id);
  const reviewable = tenant !== "" && sends.every((a) => a.action_kind === LEAD_REPLY_KIND && lower(a.tenant_id) === tenant);
  const code: SendRefusalCode = reviewable ? "review_and_send" : "decline_only";
  return {
    status: 409,
    payload: { ok: false, executed: false, error: "send_requires_review", reason_code: code, reason: SEND_REFUSAL[code], approval_id: approval.id },
  };
}
