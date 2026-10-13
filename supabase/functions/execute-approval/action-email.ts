// execute-approval — the action-backed email approval (the owner.lead_followup family).
//
// An approval minted by advance_action for a `send_via_approval` action kind carries
// metadata.action_id. Until this module, such an approval whose draft had no top-level `channel`
// (the composer's nested `draft.subject/draft.body_html` shape) fell through to execute-approval's
// "acknowledge" path: the row was marked approved, trg_ppa_sync_action marked the action DONE, and
// NOTHING was sent — a false success (§13). This is the one place that decides such an approval:
// it sends, or it fails honestly. It never acknowledges a send_via_approval action.
//
// Who the email goes to and who it comes from are resolved on the server (§9): the recipient is the
// action's contact's PRIMARY email in the approval's tenant (never a model-supplied `to`); the
// sender is the business's OWN email connector (resolveCommsEmailParties + emailSenderReadiness —
// one home for what a usable sender is). The tenant is the approval row's, already authorised by
// the caller check in index.ts, and must equal the action row's.
//
// Free of Deno-only imports so vitest can drive it against an in-memory client; index.ts injects the
// service client, the send-message call and the environment.
import { emailSenderReadiness, readEmailSenderFacts, resolveCommsEmailParties, type CommsEmailAdmin } from "../_shared/comms-email/readiness.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────────── the draft ───────────────────────────── */

export type ActionDraft =
  | { kind: "email"; subject: string; bodyHtml: string; shape: "contract" | "legacy_nested" }
  /** An SMS draft: execute-approval's existing comms path handles it, unchanged (§58). */
  | { kind: "other_channel" }
  | { kind: "unsendable"; reason: "draft_incomplete" | "unsupported_channel" | "draft_not_sendable" };

/**
 * Read the drafted email out of an approval's draft_content.
 *   contract: {channel:'email', subject, body (html), body_text, raw}
 *   legacy:   the composer's response stored whole — {draft:{subject, body_html, body_text}, …}
 * Any `to`/`recipient` in the draft is ignored on purpose: a model never picks the recipient.
 */
export function extractActionDraft(draftContent: unknown, category: string): ActionDraft {
  const dc = obj(draftContent);
  const channel = str(dc.channel).toLowerCase();
  if (channel === "email") {
    const subject = str(dc.subject);
    const bodyHtml = str(dc.body) || str(dc.body_html);
    return subject && bodyHtml ? { kind: "email", subject, bodyHtml, shape: "contract" } : { kind: "unsendable", reason: "draft_incomplete" };
  }
  if (channel === "sms") return { kind: "other_channel" };
  if (channel) return { kind: "unsendable", reason: "unsupported_channel" };
  // No channel: an SMS-category kind keeps the existing comms path (it decides SMS by category).
  if (category.toLowerCase().includes("sms")) return { kind: "other_channel" };
  const nested = obj(dc.draft);
  const subject = str(nested.subject);
  const bodyHtml = str(nested.body_html);
  if (subject && bodyHtml) return { kind: "email", subject, bodyHtml, shape: "legacy_nested" };
  if (Object.keys(nested).length) return { kind: "unsendable", reason: "draft_incomplete" };
  return { kind: "unsendable", reason: "draft_not_sendable" };
}

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

/* ───────────────────────────── the decision ───────────────────────────── */

interface Res { data: unknown; error: unknown }
interface ReadQ extends PromiseLike<Res> { eq(column: string, value: unknown): ReadQ; maybeSingle(): PromiseLike<Res> }
interface WriteQ extends PromiseLike<Res> { eq(column: string, value: unknown): WriteQ }
/** The slice of the service client this module uses. Every read/write is filtered to server-derived ids. */
export interface ActionEmailAdmin extends CommsEmailAdmin {
  from(table: string): { select(columns: string): ReadQ; update(values: Obj): WriteQ };
}

export interface ApprovalRowForSend {
  id: string;
  tenant_id: string | null;
  conversation_id: string | null;
  category: string | null;
  type: string | null;
  draft_content: unknown;
  metadata: unknown;
}

/** The body execute-approval forwards to send-message (with the caller's JWT, so it authorises the same person). */
export interface SendMessageRequest {
  channel: "email";
  to: string;
  subject: string;
  body: string;
  contact_id: string;
  conversation_id?: string;
  approval_id: string;
  connector_id: string;
  idempotency_key: string;
}

export interface ActionEmailDeps {
  admin: ActionEmailAdmin;
  /** POST send-message. Throws only when no answer came back at all (the outcome is then unknown). */
  sendMessage(req: SendMessageRequest): Promise<{ httpOk: boolean; body: unknown }>;
  releaseClaim(): Promise<unknown>;
  env(key: string): string | undefined;
  now(): Date;
  log?(msg: string): void;
}

export interface ActionEmailResult { status: number; payload: Obj }

const SEND_KIND_EXECUTOR = "send_via_approval";
const CLOSED_ACTION = new Set(["done", "dismissed", "failed", "expired"]);

/** The action id an approval names, when it names one. */
export function approvalActionId(metadata: unknown): string | null {
  const id = str(obj(metadata).action_id);
  return UUID.test(id) ? id : null;
}

/**
 * Decide an action-backed approval. Returns null when the approval is NOT an action-backed email
 * send (no action, a non-send kind, or an SMS draft) — the caller continues with its existing paths.
 * Every non-null answer is final: sent, queued (claim kept), or refused/failed (claim released).
 * Called only after the caller atomically claimed the approval row.
 */
export async function decideActionEmailApproval(
  deps: ActionEmailDeps,
  approval: ApprovalRowForSend,
  choice: { connectorId: string | null },
): Promise<ActionEmailResult | null> {
  const actionId = approvalActionId(approval.metadata);
  if (!actionId) return null;
  const category = String(approval.category ?? approval.type ?? "");
  const draft = extractActionDraft(approval.draft_content, category);
  const approvalId = approval.id;

  const refuse = async (status: number, payload: Obj): Promise<ActionEmailResult> => {
    await deps.releaseClaim();
    return { status, payload: { ok: false, executed: false, approval_id: approvalId, ...payload } };
  };

  const actionRead = await deps.admin.from("paige_actions")
    .select("id,tenant_id,action_kind,contact_id,approval_id,status").eq("id", actionId).maybeSingle();
  if (actionRead.error) return refuse(503, { error: "unavailable", detail: "action_read_failed" });
  const action = obj(actionRead.data);
  if (action.id !== actionId) {
    // The action is gone. If the draft is an email we still must not acknowledge it as handled.
    return draft.kind === "email" ? refuse(409, { error: "action_not_found" }) : null;
  }

  const kindRead = await deps.admin.from("paige_action_kinds").select("slug,executor").eq("slug", String(action.action_kind ?? "")).maybeSingle();
  if (kindRead.error) return refuse(503, { error: "unavailable", detail: "action_kind_read_failed" });
  if (obj(kindRead.data).executor !== SEND_KIND_EXECUTOR) return null; // not a send kind: unchanged behaviour (§58)

  // From here this is a send_via_approval action: it sends, or it fails honestly. Never acknowledged.
  if (draft.kind === "other_channel") return null; // SMS: the existing comms path sends it
  // §9: the approval's tenant (already authorised against the caller) must be the action's tenant,
  // and the action must point back at this approval — a crafted approval cannot drive another row.
  if (!approval.tenant_id || action.tenant_id !== approval.tenant_id) return refuse(403, { error: "action_tenant_mismatch" });
  if (action.approval_id !== approvalId) return refuse(409, { error: "action_approval_mismatch" });
  if (CLOSED_ACTION.has(String(action.status ?? ""))) return refuse(409, { error: "action_closed", action_status: action.status });
  if (draft.kind === "unsendable") return refuse(422, { error: "not_sendable", reason: draft.reason });

  const tenantId = approval.tenant_id;
  const contactId = typeof action.contact_id === "string" ? action.contact_id : null;
  if (!contactId) return refuse(422, { error: "no_recipient", detail: "the action has no contact" });

  let parties: Awaited<ReturnType<typeof resolveCommsEmailParties>>;
  try {
    parties = await resolveCommsEmailParties(deps.admin, { tenantId, contactId, connectorId: choice.connectorId });
  } catch {
    return refuse(503, { error: "unavailable", detail: "party_read_failed" });
  }
  if (parties.kind === "contact_not_in_workspace") return refuse(422, { error: "no_recipient", detail: "contact_not_in_workspace" });
  if (parties.kind === "recipient_missing") return refuse(422, { error: "no_recipient", detail: "the contact has no primary email" });
  if (parties.kind === "sender_missing") return refuse(422, { error: "needs_setup", reason: "TENANT_EMAIL_SENDER_MISSING" });
  if (parties.kind === "sender_choice_required") return refuse(422, { error: "sender_choice_required", senders: parties.senders });

  // The resolved connector must be usable right now (same check every governed email send uses).
  let senderFacts: Awaited<ReturnType<typeof readEmailSenderFacts>>;
  try {
    senderFacts = await readEmailSenderFacts(deps.admin, tenantId, parties.connectorId);
  } catch {
    return refuse(503, { error: "unavailable", detail: "sender_read_failed" });
  }
  const notReady = emailSenderReadiness(senderFacts, {
    resendConfigured: !!deps.env("RESEND_API_KEY"),
    googleConfigured: !!deps.env("GOOGLE_OAUTH_CLIENT_ID") && !!deps.env("GOOGLE_OAUTH_CLIENT_SECRET"),
  });
  if (notReady) return refuse(422, { error: "needs_setup", reason: notReady.reason });

  let sent: { httpOk: boolean; body: unknown };
  try {
    sent = await deps.sendMessage({
      channel: "email",
      to: parties.recipient,
      subject: draft.subject,
      body: draft.bodyHtml,
      contact_id: contactId,
      ...(approval.conversation_id ? { conversation_id: approval.conversation_id } : {}),
      approval_id: approvalId,
      connector_id: parties.connectorId,
      idempotency_key: `approval:${approvalId}`,
    });
  } catch {
    // No answer: the email may or may not have gone. Keep the claim (a second press must not send a
    // second copy) and say so — never a guessed success, never a silent retry.
    await stampMetadata(deps, approval, { send_outcome: "unknown", send_outcome_at: deps.now().toISOString() });
    return { status: 502, payload: { ok: false, executed: false, error: "send_outcome_unknown", approval_id: approvalId } };
  }

  const outcome = classifySendResult(sent.httpOk, sent.body);
  if (outcome.kind === "queued") {
    // Accepted, not yet sent. The claim stays (no second send); the row is NOT marked approved,
    // because nothing has gone out yet and the action must not read as done.
    await stampMetadata(deps, approval, {
      send_queued: { outcome: outcome.outcome, scheduled_for: outcome.scheduledFor, message_id: outcome.messageId, at: deps.now().toISOString() },
    });
    return { status: 200, payload: { ok: true, executed: false, queued: true, outcome: outcome.outcome, scheduled_for: outcome.scheduledFor, channel: "email", approval_id: approvalId } };
  }
  if (outcome.kind === "failed") {
    // send-message leaves the row 'pending' on failure — release so a genuine retry is possible.
    await deps.releaseClaim();
    return { status: 502, payload: { ok: false, executed: false, error: outcome.error, detail: sent.body, approval_id: approvalId } };
  }

  // Sent. send-message already stamped the approval approved+sent_at (and the action follows via
  // trg_ppa_sync_action). Record the touch on the contact, inside the tenant.
  const touched = await deps.admin.from("clients").update({ last_contacted_at: deps.now().toISOString() })
    .eq("id", contactId).eq("tenant_id", tenantId);
  if (touched.error) deps.log?.(`[execute-approval] last_contacted_at not recorded for approval ${approvalId}`);
  return {
    status: 200,
    payload: { ok: true, executed: true, channel: "email", approval_id: approvalId, audit_id: outcome.auditId, last_contacted_recorded: !touched.error },
  };
}

async function stampMetadata(deps: ActionEmailDeps, approval: ApprovalRowForSend, extra: Obj): Promise<void> {
  const res = await deps.admin.from("paige_pending_approvals").update({ metadata: { ...obj(approval.metadata), ...extra } }).eq("id", approval.id);
  if (res.error) deps.log?.(`[execute-approval] approval ${approval.id} metadata not stamped`);
}
