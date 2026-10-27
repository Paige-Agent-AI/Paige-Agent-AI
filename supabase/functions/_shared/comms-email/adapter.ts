// INT-328 comms.email_send — the governed executor and the reconcile path.
//
// Mirrors _shared/sales-invoice-delivery/adapter.ts. Called ONLY from comms-email-command after the
// canonical gate (decideDeclaredCapability) returned `execute` holding the STORED, approved
// arguments. It has no approval mechanism of its own: it re-proves the facts the person approved
// (same recipient address, same sender address, same content), prepares the one bound messages
// row, asks send-message to send exactly that row, and reports only what the database read back.
//
// Honesty (§13): `provider_accepted` means the email provider took the message. It is never
// "delivered", "opened" or "read". Anything the database cannot confirm is `outcome_unknown`, and
// an unknown send is never retried as a new operation and never re-sent: it stays unknown for a
// person to review (SendGrid, Gmail and SMTP have no idempotent replay; see reconcileCommsEmailSend).
import { COMMS_EMAIL_ACTION, COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS, UUID, canonicalCommsEmailSendAt, commsEmailBodyHtml, commsEmailContentDigest, parseCommsEmailCommand, type CommsEmailCommand } from "./contract.ts";
import type { CommsEmailParties, CommsEmailReadiness } from "./readiness.ts";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue | null => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : null;

export const COMMS_EMAIL_RECONCILIATION_CODE = "COMMS_EMAIL_RECONCILIATION_REQUIRED";
const TERMINAL = new Set(["provider_accepted", "failed", "refused"]);
const answered = (error: unknown) => {
  const code = object(error)?.code;
  return typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code);
};

/**
 * The only keys a comms email result may carry outward. Provider ids, provider names, error text,
 * attempts, timestamps and the binding itself never leave the server. A stored reason is code-shaped
 * (finalize_comms_email_send keeps nothing else) and is surfaced upper-cased.
 */
export function commsEmailSafeResult(value: unknown, extra: ObjectValue = {}): ObjectValue {
  const r = object(value) ?? {};
  const outcome = typeof r.outcome === "string" && TERMINAL.has(r.outcome) ? r.outcome : "outcome_unknown";
  const reason = typeof r.reason === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(r.reason) ? r.reason.toUpperCase() : null;
  return {
    ok: outcome === "provider_accepted",
    outcome,
    ...(reason && outcome !== "provider_accepted" ? { reason } : {}),
    ...(outcome === "outcome_unknown" ? { code: COMMS_EMAIL_RECONCILIATION_CODE } : {}),
    ...(typeof r.operation_id === "string" && UUID.test(r.operation_id) ? { operation_id: r.operation_id } : {}),
    ...(typeof r.message_id === "string" && UUID.test(r.message_id) ? { message_id: r.message_id } : {}),
    provider_receipt_available: outcome === "provider_accepted" && r.provider_receipt_available === true,
    delivery_confirmed: false,
    ...extra,
  };
}

export interface CommsEmailStoredCall {
  command: CommsEmailCommand & { connector_id: string };
  recipient: string;
  fromAddress: string;
  contentDigest: string;
  /** "Approve now, send later": the canonical send time the person approved. Absent = send now. */
  sendAt?: string;
}

/** Re-parse the stored proposal arguments. Anything not exactly the shape the door stored refuses. */
export function parseCommsEmailStoredCall(args: unknown, tenantId: string): (CommsEmailStoredCall & { operationId: string }) | null {
  const a = object(args);
  if (!a || a.expected_tenant_id !== tenantId || typeof a.operation_id !== "string" || !UUID.test(a.operation_id)) return null;
  let command: CommsEmailCommand;
  try { command = parseCommsEmailCommand(a.command); } catch { return null; }
  if (!command.connector_id || typeof a.recipient !== "string" || typeof a.from_address !== "string"
    || typeof a.content_digest !== "string" || !/^[0-9a-f]{64}$/.test(a.content_digest)) return null;
  // A stored send time must already be canonical (the door stored parseCommsEmailSendAt's output);
  // anything else is not the call that was approved.
  let sendAt: string | undefined;
  if (a.send_at !== undefined) {
    try { sendAt = canonicalCommsEmailSendAt(a.send_at); } catch { return null; }
    if (sendAt !== a.send_at) return null;
  }
  return { operationId: a.operation_id, command: command as CommsEmailCommand & { connector_id: string }, recipient: a.recipient, fromAddress: a.from_address, contentDigest: a.content_digest,
    ...(sendAt ? { sendAt } : {}) };
}

export interface CommsEmailExecutorInput {
  actorUserId: string;
  tenantId: string;
  operationId: string;
  stored: CommsEmailStoredCall;
  governance: ObjectValue;
}

export interface CommsEmailExecutorDependencies {
  stillCurrent(): Promise<boolean>;
  /** read_comms_email_send_result for THIS actor + tenant + operation (null when absent). */
  readResult(operationId: string): Promise<unknown>;
  resolveParties(): Promise<CommsEmailParties>;
  readiness(parties: Extract<CommsEmailParties, { kind: "resolved" }>): Promise<CommsEmailReadiness>;
  /** prepare_comms_email_send — returns the RPC's own { data, error } so a database refusal is told apart from silence. */
  prepare(args: ObjectValue): Promise<{ data: unknown; error: unknown }>;
  /** POST send-message with the service role. Its answer is never trusted; the result is read back. */
  send(body: ObjectValue): Promise<unknown>;
  /** read_comms_email_send_binding — the prepared row's stored values, for reconcile. */
  readBinding(messageId: string): Promise<unknown>;
}

const PREPARE_REFUSALS: [string, string][] = [
  ["COMMS_EMAIL_RECIPIENT_CHANGED", "RECIPIENT_CHANGED"],
  ["COMMS_EMAIL_SENDER_CHANGED", "SENDER_CHANGED"],
  ["COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE", "CONTACT_NOT_IN_WORKSPACE"],
  ["COMMS_EMAIL_WORKSPACE_CHANGED", "WORKSPACE_CHANGED"],
  ["COMMS_EMAIL_SEND_AT_INVALID", "COMMS_EMAIL_SEND_AT_INVALID"],
  ["COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED", "COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED"],
];

export async function executeCommsEmailSend(input: CommsEmailExecutorInput, d: CommsEmailExecutorDependencies): Promise<ObjectValue> {
  const unknown = () => ({ ok: false, outcome: "outcome_unknown", operation_id: input.operationId, code: COMMS_EMAIL_RECONCILIATION_CODE, delivery_confirmed: false });
  const refused = (reason: string) => ({ ok: false, outcome: "refused", operation_id: input.operationId, reason, delivery_confirmed: false });
  try {
    const { stored } = input;
    for (const id of [input.actorUserId, input.tenantId, input.operationId, stored.command.contact_id, stored.command.connector_id]) {
      if (typeof id !== "string" || !UUID.test(id)) return refused("COMMS_EMAIL_INVALID");
    }
    if (stored.command.action !== COMMS_EMAIL_ACTION) return refused("COMMS_EMAIL_INVALID");
    if (input.governance.decision_receipt_recorded !== true || !await d.stillCurrent()) return refused("COMMS_EMAIL_AUTHORITY_UNAVAILABLE");

    const prior = object(await d.readResult(input.operationId));
    if (prior && prior.outcome !== "prepared") {
      return TERMINAL.has(String(prior.outcome)) ? commsEmailSafeResult(prior, { replayed: true }) : unknown();
    }

    // The approved call named a person's address and a sender's address. If either moved since the
    // card was shown, this is a different email than the one approved: refuse, send nothing.
    // These reads run before anything is prepared, so a failure here sent nothing: a refusal the
    // owner can safely retry, never an "unknown" that would forbid a resend.
    let parties: Awaited<ReturnType<CommsEmailExecutorDependencies["resolveParties"]>>;
    try { parties = await d.resolveParties(); } catch { return refused("COMMS_EMAIL_PARTIES_UNAVAILABLE"); }
    if (parties.kind === "contact_not_in_workspace") return refused("CONTACT_NOT_IN_WORKSPACE");
    if (parties.kind === "recipient_missing" || ("recipient" in parties && parties.recipient !== stored.recipient)) return refused("RECIPIENT_CHANGED");
    if (parties.kind !== "resolved" || parties.connectorId !== stored.command.connector_id || !parties.fromAddress || parties.fromAddress !== stored.fromAddress) return refused("SENDER_CHANGED");
    let readiness: Awaited<ReturnType<CommsEmailExecutorDependencies["readiness"]>>;
    try { readiness = await d.readiness(parties); } catch { return refused("EMAIL_READINESS_UNVERIFIED"); }
    if (!readiness.eligible) {
      return { ok: false, outcome: readiness.state === "needs_setup" ? "needs_setup" : readiness.state === "held" && !readiness.reason.startsWith("BLOCKED_") ? "held" : "refused", operation_id: input.operationId, reason: readiness.reason, delivery_confirmed: false };
    }

    const bodyHtml = commsEmailBodyHtml(stored.command.body);
    const contentDigest = await commsEmailContentDigest({ recipient: stored.recipient, connectorId: stored.command.connector_id, subject: stored.command.subject, bodyText: stored.command.body });
    if (contentDigest !== stored.contentDigest) return refused("CONTENT_CHANGED");
    if (!await d.stillCurrent()) return refused("WORKSPACE_CHANGED");

    // `_send_at` only for a scheduled call, so every immediate send keeps choosing the 13-argument
    // prepare_comms_email_send exactly as before (PostgREST resolves the overload by argument names).
    const { data, error } = await d.prepare({
      _actor_user_id: input.actorUserId, _expected_tenant_id: input.tenantId, _operation_id: input.operationId,
      _contact_id: stored.command.contact_id, _recipient: stored.recipient, _connector_id: stored.command.connector_id,
      _from_address: stored.fromAddress, _subject: stored.command.subject, _body_text: stored.command.body, _body_html: bodyHtml,
      _content_digest: contentDigest, _command: stored.command, _governance: input.governance,
      ...(stored.sendAt ? { _send_at: stored.sendAt } : {}),
    });
    if (error) {
      if (!answered(error)) return unknown(); // no answer: the prepare may have committed
      const message = String(object(error)?.message ?? "");
      if (message.includes(COMMS_EMAIL_RECONCILIATION_CODE)) return unknown();
      const hit = PREPARE_REFUSALS.find(([needle]) => message.includes(needle));
      return refused(hit ? hit[1] : "COMMS_EMAIL_PREPARE_REFUSED");
    }
    const prepared = object(data);
    if (!prepared || prepared.ok !== true || typeof prepared.message_id !== "string" || !UUID.test(prepared.message_id)) return unknown();
    if (prepared.state !== "prepared") {
      if (!TERMINAL.has(String(prepared.state))) return unknown();
      return commsEmailSafeResult(await d.readResult(input.operationId), { replayed: true });
    }
    // A scheduled email is prepared and queued, never sent here: the drainer releases it at its time.
    // The database echoes the send time it stored; anything else is not the call that was approved.
    if (stored.sendAt) {
      if (prepared.send_at !== stored.sendAt) return unknown();
      return { ok: true, outcome: "scheduled", send_at: stored.sendAt, operation_id: input.operationId, message_id: prepared.message_id,
        ...(prepared.replayed === true ? { replayed: true } : {}), delivery_confirmed: false };
    }
    if (!await d.stillCurrent()) return refused("WORKSPACE_CHANGED");

    try {
      await d.send({
        channel: "email", to: stored.recipient, contact_id: stored.command.contact_id, connector_id: stored.command.connector_id,
        message_id: prepared.message_id, subject: stored.command.subject, body: bodyHtml,
        comms_email_operation_id: input.operationId, idempotency_key: `comms-email:${input.operationId}`,
      });
    } catch { /* an unanswered send is settled by the readback below, never by this throw */ }
    const result = object(await d.readResult(input.operationId));
    return result && TERMINAL.has(String(result.outcome)) ? commsEmailSafeResult(result) : unknown();
  } catch {
    return unknown();
  }
}

/**
 * Settle an operation whose provider outcome is unknown (or whose dispatch went stale). NOTHING IS EVER
 * RE-SENT. A reconcile used to re-send a Resend operation under its `comms-email:<operation>`
 * Idempotency-Key, which made the second request safe; every email now goes through SendGrid (Experience
 * 03), Gmail or SMTP, and none of them has an idempotent replay, so re-POSTing an email the provider may
 * already have accepted could deliver it twice. A recorded outcome is replayed; anything else stays
 * unknown for a person to review (for SendGrid, the provider's own event may still settle it).
 * The dependencies keep their shape for callers; `send` is deliberately never called here.
 */
export async function reconcileCommsEmailSend(operationId: string, _tenantId: string, d: Pick<CommsEmailExecutorDependencies, "readResult" | "readBinding" | "send" | "stillCurrent">): Promise<ObjectValue> {
  const stuck = () => ({ ok: false, outcome: "outcome_unknown", operation_id: operationId, code: COMMS_EMAIL_RECONCILIATION_CODE, reconcilable: false, delivery_confirmed: false });
  try {
    if (!UUID.test(operationId)) return stuck();
    const result = object(await d.readResult(operationId));
    if (!result) return stuck();
    if (TERMINAL.has(String(result.outcome))) return commsEmailSafeResult(result, { replayed: true });
    return stuck();
  } catch {
    return stuck();
  }
}

/* ───────────────────── "Approve now, send later": releasing a scheduled governed email ───────────────────── */

/**
 * Which path a row the scheduled drainer leased takes. Pure. ANY row whose meta carries the
 * `comms_email_binding` key (the same test the SQL guards use, `meta ? 'comms_email_binding'`) is a
 * governed email and is released only through releaseScheduledCommsEmail — never re-posted as a generic
 * draft (send-message refuses that shape with comms_email_binding_required).
 */
export type ScheduledDrainRoute = "comms_email" | "generic";
export function scheduledDrainRoute(row: unknown): ScheduledDrainRoute {
  const meta = object(object(row)?.meta);
  return meta && Object.prototype.hasOwnProperty.call(meta, "comms_email_binding") ? "comms_email" : "generic";
}

export interface ScheduledCommsEmailBinding {
  operationId: string; tenantId: string; actorUserId: string; contactId: string; connectorId: string;
  recipient: string; fromAddress: string; subject: string; bodyText: string; bodyHtml: string;
  contentDigest: string; sendAt: string; state: string;
}

/** The stored binding of a SCHEDULED governed email (one carrying a canonical send_at), or null. */
export function parseScheduledCommsEmailBinding(value: unknown): ScheduledCommsEmailBinding | null {
  const b = object(value);
  if (!b) return null;
  for (const key of ["operation_id", "tenant_id", "actor_user_id", "contact_id", "connector_id"]) {
    if (typeof b[key] !== "string" || !UUID.test(b[key] as string)) return null;
  }
  for (const key of ["recipient", "from_address", "subject", "body_text", "body_html", "state"]) {
    if (typeof b[key] !== "string" || !(b[key] as string)) return null;
  }
  if (typeof b.content_digest !== "string" || !/^[0-9a-f]{64}$/.test(b.content_digest)) return null;
  let sendAt: string;
  try { sendAt = canonicalCommsEmailSendAt(b.send_at); } catch { return null; }
  if (sendAt !== b.send_at) return null;
  return {
    operationId: b.operation_id as string, tenantId: b.tenant_id as string, actorUserId: b.actor_user_id as string,
    contactId: b.contact_id as string, connectorId: b.connector_id as string, recipient: b.recipient as string,
    fromAddress: b.from_address as string, subject: b.subject as string, bodyText: b.body_text as string,
    bodyHtml: b.body_html as string, contentDigest: b.content_digest, sendAt, state: b.state as string,
  };
}

export interface ScheduledReleaseDependencies {
  now(): number;
  /** The server-owned provider kill switch, for the binding's tenant and scheduler. Throws when unreadable. */
  providerExecutionAllowed(input: { tenantId: string; actorUserId: string }): Promise<boolean>;
  /** resolveCommsEmailParties as the scheduler (the person who approved), for the bound contact and sender. */
  resolveParties(input: { tenantId: string; actorUserId: string; contactId: string; connectorId: string }): Promise<CommsEmailParties>;
  readiness(input: { tenantId: string; actorUserId: string; parties: Extract<CommsEmailParties, { kind: "resolved" }> }): Promise<CommsEmailReadiness>;
  /** read_comms_email_send_binding. On a database refusal it throws an Error whose message carries the database's code. */
  readBinding(messageId: string): Promise<unknown>;
  /** POST send-message (service role). `answered` = it finished (HTTP < 500 with a JSON body); `code` = its code/error, if any. */
  send(body: ObjectValue): Promise<{ answered: boolean; code: string | null }>;
  /**
   * close_scheduled_comms_email(.., reason, NULL) — the one close of a scheduled send still 'prepared'.
   * Unlike finalize it succeeds even when the scheduler has left the business (the Rail is then honestly
   * unattributed and the audit row says so). true = the database closed it.
   */
  closeRefused(input: { messageId: string; operationId: string; reason: string }): Promise<boolean>;
  /** Best-effort: the thread's support case (if any) now awaits the customer. Never blocks. */
  markSupportCase(messageId: string): Promise<void>;
}

export type ScheduledReleaseResult =
  /** The email service accepted it (never "delivered"). */
  | { result: "released" }
  /** Closed as refused with this code: nothing went out. */
  | { result: "refused"; reason: string }
  /** Nothing written; the next lease (or a person) decides. `reason` says why, for the drain's log. */
  | { result: "left"; reason: string }
  /** Already past 'prepared' (claimed, or settled) — this release has nothing to do. */
  | { result: "settled" }
  /** The row's binding is not a scheduled governed email this release can read. Nothing written. */
  | { result: "invalid" };

// The scheduler's seat is gone (removed, demoted, banned, or the business closed): _comms_email_seat
// raises one of these. A workspace switch is NOT one — once due, the release no longer needs the
// scheduler to have this business open (_comms_email_release_actor).
const SEAT_GONE: [string, string][] = [
  ["COMMS_EMAIL_ACTOR_UNAVAILABLE", "scheduler_authority_removed"],
  ["COMMS_EMAIL_AUTHORITY_UNAVAILABLE", "scheduler_authority_removed"],
  ["COMMS_EMAIL_WORKSPACE_UNAVAILABLE", "workspace_unavailable"],
];
const RELEASE_REASON = /^[a-z][a-z0-9_]{0,63}$/;
/** How far the edge clock may run behind the database's before a release is held back (send-message's too). */
export const COMMS_EMAIL_RELEASE_CLOCK_TOLERANCE_MS = 60_000;
/**
 * send-message answers that mean THIS request can never be admitted, however often it is retried: the
 * request shape or the row itself is wrong for a scheduled release. Only these close a still-prepared
 * scheduled email; any other answer is treated as transient (allowlist, never a denylist).
 */
export const PERMANENT_RELEASE_REFUSALS: ReadonlySet<string> = new Set([
  "comms_email_send_shape_invalid", "comms_email_binding_required", "agreement_signature_binding_required",
  "COMMS_EMAIL_NOT_SCHEDULED", "COMMS_EMAIL_SCHEDULED_RELEASE_REQUIRED", "message_not_found",
]);
const releaseReason = (code: string | null | undefined, fallback: string) => {
  const r = typeof code === "string" ? code.trim().toLowerCase() : "";
  return RELEASE_REASON.test(r) ? r : fallback;
};

/**
 * Release ONE scheduled governed email the drainer leased. It repeats, as the person who approved it,
 * every check the executor made before its own send (provider kill switch, parties unchanged,
 * readiness, the exact approved content), asks send-message to send exactly the bound row, and reads
 * the binding back. Honesty (§13): `released` means the email service took it, never delivery; any
 * moment the database cannot confirm is `left` (the next lease or a person settles it), never a guess.
 * An email that may have gone out is never closed as refused: only a binding still 'prepared' after an
 * ANSWERED send-message (which proves no claim admitted it) is closed.
 */
export async function releaseScheduledCommsEmail(rawBinding: unknown, messageId: string, d: ScheduledReleaseDependencies): Promise<ScheduledReleaseResult> {
  const binding = parseScheduledCommsEmailBinding(rawBinding);
  if (!binding || typeof messageId !== "string" || !UUID.test(messageId)) return { result: "invalid" };
  const refuse = async (reason: string): Promise<ScheduledReleaseResult> =>
    await d.closeRefused({ messageId, operationId: binding.operationId, reason }).catch(() => false)
      ? { result: "refused", reason } : { result: "left", reason: `close_unrecorded:${reason}` };
  let seatReason = "scheduler_authority_removed";
  const read = async (): Promise<ObjectValue | "seat_gone" | null> => {
    try { return object(await d.readBinding(messageId)); } catch (error) {
      const message = String(object(error)?.message ?? error ?? "");
      const hit = SEAT_GONE.find(([needle]) => message.includes(needle));
      if (hit) { seatReason = hit[1]; return "seat_gone"; }
      return null;
    }
  };
  try {
    if (binding.state !== "prepared") return { result: "settled" };
    const now = d.now(), at = Date.parse(binding.sendAt);
    // The edge clock may run behind the database's: a minute early is let through to send-message, whose
    // claim answers not_before on the database's own clock (the authority) if it really is early.
    if (!Number.isFinite(now) || now + COMMS_EMAIL_RELEASE_CLOCK_TOLERANCE_MS < at) return { result: "left", reason: "not_due" };
    if (now > at + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS) return await refuse("scheduled_release_missed");

    const fresh = await read();
    if (fresh === "seat_gone") return await refuse(seatReason);
    if (!fresh) return { result: "left", reason: "binding_unreadable" };
    if (fresh.state !== "prepared") return { result: "settled" };
    if (fresh.operation_id !== binding.operationId || fresh.send_at !== binding.sendAt) return { result: "left", reason: "binding_moved" };
    if (fresh.eligible !== true) return await refuse("send_no_longer_eligible");

    let allowed: boolean;
    try { allowed = await d.providerExecutionAllowed({ tenantId: binding.tenantId, actorUserId: binding.actorUserId }); }
    catch { return { result: "left", reason: "provider_boundary_unreadable" }; }
    if (allowed !== true) return await refuse("comms_provider_execution_disabled");

    let parties: CommsEmailParties;
    try { parties = await d.resolveParties({ tenantId: binding.tenantId, actorUserId: binding.actorUserId, contactId: binding.contactId, connectorId: binding.connectorId }); }
    catch { return { result: "left", reason: "parties_unreadable" }; }
    if (parties.kind === "contact_not_in_workspace") return await refuse("contact_not_in_workspace");
    if (parties.kind === "recipient_missing" || ("recipient" in parties && parties.recipient !== binding.recipient)) return await refuse("recipient_changed");
    if (parties.kind !== "resolved" || parties.connectorId !== binding.connectorId || !parties.fromAddress || parties.fromAddress !== binding.fromAddress) return await refuse("sender_changed");
    let readiness: CommsEmailReadiness;
    try { readiness = await d.readiness({ tenantId: binding.tenantId, actorUserId: binding.actorUserId, parties }); }
    catch { return { result: "left", reason: "readiness_unreadable" }; }
    if (readiness.state === "unavailable") return { result: "left", reason: "readiness_unreadable" };
    if (!readiness.eligible) return await refuse(releaseReason(readiness.reason, "send_no_longer_eligible"));

    const digest = await commsEmailContentDigest({ recipient: binding.recipient, connectorId: binding.connectorId, subject: binding.subject, bodyText: binding.bodyText });
    if (digest !== binding.contentDigest || commsEmailBodyHtml(binding.bodyText) !== binding.bodyHtml) return await refuse("content_changed");

    let answer: { answered: boolean; code: string | null } = { answered: false, code: null };
    try {
      answer = await d.send({
        channel: "email", to: binding.recipient, contact_id: binding.contactId, connector_id: binding.connectorId,
        message_id: messageId, subject: binding.subject, body: binding.bodyHtml,
        comms_email_operation_id: binding.operationId, idempotency_key: `comms-email:${binding.operationId}`,
        comms_email_scheduled_release: true,
      });
    } catch { /* an unanswered send is settled by the readback below, never by this throw */ }

    const after = await read();
    if (after === "seat_gone" || !after) return { result: "left", reason: "readback_unavailable" };
    if (after.state === "provider_accepted") {
      try { await d.markSupportCase(messageId); } catch { /* the next inbound re-syncs the case */ }
      return { result: "released" };
    }
    if (after.state !== "prepared") return { result: "settled" };
    // Still prepared: no claim admitted it. Only an ANSWERED send-message proves that; an unanswered
    // one may still be admitted, so it is left for the next lease (or closed as missed after the grace).
    if (!answer.answered) return { result: "left", reason: "send_unanswered" };
    // Only an answer that can never change on a retry closes it. Everything else — a binding read that
    // hit a lock timeout or a concurrent change (comms_email_binding_invalid), a claim that was not
    // admitted because an identical email is in flight or the claim errored (COMMS_EMAIL_NOT_CLAIMABLE),
    // not yet due — is left for the next lease; past the grace the sweep closes it as missed.
    const code = typeof answer.code === "string" ? answer.code : "";
    if (!PERMANENT_RELEASE_REFUSALS.has(code)) return { result: "left", reason: `retry:${releaseReason(code, "unanswered_code")}` };
    return await refuse(releaseReason(code, "scheduled_release_not_admitted"));
  } catch {
    return { result: "left", reason: "release_error" };
  }
}
