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

/* ───────────────────────── a quiet-hours / do-not-disturb hold (#2132) ───────────────────────── */

/**
 * An approval is never left claimed behind a queued message. A queued copy and the approval have two
 * lifecycles nothing joins: the drain released the message without ever closing the approval (it stayed
 * "in progress" forever), and a decline would not have stopped the message. So an approval-driven send
 * that the pre-send seam would HOLD (the business's do-not-disturb hours, or SMS quiet hours in the
 * contact's time zone) is answered HELD: nothing is queued, nothing is sent, the approval stays pending
 * and unclaimed, and the person approves it again when the hours end. The hold itself is decided by the
 * ONE pre-send seam (runPreSend) — the same function send-message runs — never re-derived here.
 */
export type HoldReason = "quiet_hours" | "tenant_dnd" | "other";

export const HOLD_MESSAGE: Record<HoldReason, string> = {
  quiet_hours: "Not sent: it's quiet hours where this contact is. Nothing went out, and it's still waiting for you. Approve it again after quiet hours end.",
  tenant_dnd: "Not sent: your business's do-not-disturb hours are on. Nothing went out, and it's still waiting for you. Approve it again when they end.",
  other: "Not sent: messages to this contact are on hold right now. Nothing went out, and it's still waiting for you. Approve it again later.",
};

/** The hold a pre-send (or send-message) outcome stands for; null when the outcome is not a hold. */
export function holdReasonOf(outcome: unknown): HoldReason | null {
  if (outcome === "queued_quiet_hours") return "quiet_hours";
  if (outcome === "queued_tenant_dnd") return "tenant_dnd";
  return typeof outcome === "string" && outcome.startsWith("queued_") ? "other" : null;
}

/** The HELD answer. ok:false so every caller keeps the row on screen; `error` is what the person reads. */
export function heldPayload(reason: HoldReason, retryAfter: string | null, channel: string, approvalId: string, extra: Obj = {}): Obj {
  return { ok: false, executed: false, held: true, outcome: "held", hold_reason: reason, retry_after: retryAfter, channel, error: HOLD_MESSAGE[reason], approval_id: approvalId, ...extra };
}

/* ───────────────────────── the held draft: ONE message, ONE approval path (#2150) ───────────────────────── */

/**
 * When the hours begin between the pre-send check and send-message, send-message queues a row and the
 * door cancels it through cancel_scheduled_message, which returns it to an unsent draft that Conversations
 * shows with its own "Approve & send". That draft and this approval are the SAME message. So the door
 * names the draft on the approval (metadata.held_draft_message_id). SMS retries use THAT row and
 * settle if it already left. Email retries refuse: this legacy approval never froze the original sending
 * identity or attachment state, so it cannot authorize a send or attest that an edited message was approved.
 */
export const HELD_DRAFT_KEY = "held_draft_message_id";
/** Legacy held email has no immutable sender/attachment approval binding; it must be reviewed again. */
export const HELD_EMAIL_REQUIRES_REVIEW =
  "This held reply's original sending account and attachments can't be confirmed. Nothing was sent again. Review it in Conversations, or decline it here.";

/** Message statuses that mean the draft has already gone out (messages_status_check, production 2026-10-14). */
export const ALREADY_SENT_STATUSES: ReadonlySet<string> = new Set(["sent", "delivered", "read"]);

/*
 * Person-readable outcomes are answered 200 + ok:false (like the HELD answer): every caller reads the body
 * of a 2xx through supabase.functions.invoke, but a non-2xx arrives as FunctionsHttpError whose message is
 * the generic "Edge Function returned a non-2xx status code" — the explanation would never reach the person.
 */
export const DECIDED_MID_SEND_HELD =
  "This approval changed or was decided while it was being sent. The copy was returned to an unsent draft in Conversations.";
export const DECIDED_MID_SEND_QUEUED =
  "Heads up: this approval changed or was decided while it was being sent, and the original copy couldn't be called back. Its send status can't be confirmed; check it in Conversations.";
export const QUEUED_UNCANCELLABLE =
  "This message's send status can't be confirmed. It can't be approved again, so a second copy can't be sent. Check the original in Conversations.";
export const SCHEDULED_FROM_CONVERSATIONS =
  "Not sent again: this message is already scheduled from Conversations and goes out then. Manage it there, or decline this.";
export const SENT_FROM_CONVERSATIONS = "Already sent from Conversations. Nothing was sent again.";
export const HELD_DRAFT_CHANGED =
  "This reply no longer matches its draft in Conversations (the draft or the contact's address changed since it was held). This approval wasn't completed: review it in Conversations, or decline it here.";

/** The held draft's stored content, as the messages row carries it (comms C-1 columns). */
export interface HeldDraftContent {
  channel_type?: string | null;
  recipients?: unknown;
  subject?: string | null;
  body_html?: string | null;
  body_text?: string | null;
}
/** What this approval would send. */
export interface IntendedSend { channel: string; to: string; subject: string | null | undefined; body: string }

/** Line endings unified, trailing spaces per line and outer whitespace dropped: cosmetic only, never words. */
const normText = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t\u00a0]+$/, "")).join("\n").trim() : "";
const normAddress = (v: unknown, channel: string): string => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return channel === "sms" ? s.replace(/[\s().-]/g, "") : s;
};

/**
 * #2150: the held draft IS this message, but Conversations can edit it (edit → send → undo leaves the edited
 * text as a draft). send-message's message_id path sends the text it is GIVEN and flips that row to sent
 * without rewriting it, so sending this approval's text onto an edited draft would deliver one message and
 * record another. Returns which part differs — or which part cannot be read — and null only when the draft
 * carries exactly what this approval would send. Unsure is a difference: it is never sent.
 */
export function heldDraftChange(draft: HeldDraftContent, intended: IntendedSend): "channel" | "recipient" | "subject" | "body" | null {
  const channel = intended.channel;
  if ((draft.channel_type ?? null) !== channel) return "channel";
  const recipients = Array.isArray(draft.recipients) ? draft.recipients : null;
  const only = recipients && recipients.length === 1 ? recipients[0] as Record<string, unknown> | null : null;
  const draftTo = only && typeof only === "object" ? normAddress(only.address, channel) : "";
  if (!draftTo || draftTo !== normAddress(intended.to, channel)) return "recipient";
  if (channel === "email" && normText(draft.subject) !== normText(intended.subject)) return "subject";
  // The drain's own reading of a stored row: email prefers the HTML body, SMS the text body.
  const draftBody = channel === "email" ? (draft.body_html ?? draft.body_text) : (draft.body_text ?? draft.body_html);
  const stored = normText(draftBody);
  if (!stored || stored !== normText(intended.body)) return "body";
  return null;
}
export const HELD_DRAFT_UNCONFIRMED =
  "This message's original draft or send status can't be confirmed. Check it in Conversations before approving it again.";

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
const isReviewableEmailKind = (kind: unknown): boolean => kind === "owner.lead_followup"
  || kind === "client.followup" || kind === "owner.followup_email";

/** What the person can do instead, per kind. Governed email follow-ups use the existing reply screen. */
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
 *          review_and_send (a supported email follow-up of this same business) or decline_only
 *          (every other send kind — owner.sms_nudge, social.post_publish, ...).
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
  const reviewable = tenant !== "" && sends.every((a) => isReviewableEmailKind(a.action_kind) && lower(a.tenant_id) === tenant);
  const code: SendRefusalCode = reviewable ? "review_and_send" : "decline_only";
  return {
    status: 409,
    payload: { ok: false, executed: false, error: "send_requires_review", reason_code: code, reason: SEND_REFUSAL[code], approval_id: approval.id },
  };
}
