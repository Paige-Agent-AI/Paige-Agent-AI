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
// an unknown send is reconciled under the SAME operation and provider idempotency key — never
// retried as a new operation.
import { COMMS_EMAIL_ACTION, UUID, commsEmailBodyHtml, commsEmailContentDigest, parseCommsEmailCommand, type CommsEmailCommand } from "./contract.ts";
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
}

/** Re-parse the stored proposal arguments. Anything not exactly the shape the door stored refuses. */
export function parseCommsEmailStoredCall(args: unknown, tenantId: string): (CommsEmailStoredCall & { operationId: string }) | null {
  const a = object(args);
  if (!a || a.expected_tenant_id !== tenantId || typeof a.operation_id !== "string" || !UUID.test(a.operation_id)) return null;
  let command: CommsEmailCommand;
  try { command = parseCommsEmailCommand(a.command); } catch { return null; }
  if (!command.connector_id || typeof a.recipient !== "string" || typeof a.from_address !== "string"
    || typeof a.content_digest !== "string" || !/^[0-9a-f]{64}$/.test(a.content_digest)) return null;
  return { operationId: a.operation_id, command: command as CommsEmailCommand & { connector_id: string }, recipient: a.recipient, fromAddress: a.from_address, contentDigest: a.content_digest };
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

    const { data, error } = await d.prepare({
      _actor_user_id: input.actorUserId, _expected_tenant_id: input.tenantId, _operation_id: input.operationId,
      _contact_id: stored.command.contact_id, _recipient: stored.recipient, _connector_id: stored.command.connector_id,
      _from_address: stored.fromAddress, _subject: stored.command.subject, _body_text: stored.command.body, _body_html: bodyHtml,
      _content_digest: contentDigest, _command: stored.command, _governance: input.governance,
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
 * Settle an operation whose provider outcome is unknown (or whose dispatch went stale). Only a
 * Resend operation inside its idempotency window is re-entered — send-message re-sends the SAME
 * prepared row under the SAME `comms-email:<operation>` key, so the provider returns the original
 * acceptance instead of sending twice. Everything else stays unknown for a person to review.
 */
export async function reconcileCommsEmailSend(operationId: string, tenantId: string, d: Pick<CommsEmailExecutorDependencies, "readResult" | "readBinding" | "send" | "stillCurrent">): Promise<ObjectValue> {
  const stuck = (reconcilable: boolean) => ({ ok: false, outcome: "outcome_unknown", operation_id: operationId, code: COMMS_EMAIL_RECONCILIATION_CODE, reconcilable, delivery_confirmed: false });
  try {
    if (!UUID.test(operationId)) return stuck(false);
    const result = object(await d.readResult(operationId));
    if (!result) return stuck(false);
    if (TERMINAL.has(String(result.outcome))) return commsEmailSafeResult(result, { replayed: true });
    if (result.reconcilable !== true || result.provider !== "resend" || typeof result.message_id !== "string" || !UUID.test(result.message_id)) return stuck(false);
    const b = object(await d.readBinding(result.message_id));
    if (!b || b.operation_id !== operationId || b.tenant_id !== tenantId || b.message_id !== result.message_id
      || typeof b.recipient !== "string" || typeof b.contact_id !== "string" || typeof b.connector_id !== "string"
      || typeof b.subject !== "string" || typeof b.body_html !== "string") return stuck(false);
    if (!await d.stillCurrent()) return stuck(true);
    try {
      await d.send({
        channel: "email", to: b.recipient, contact_id: b.contact_id, connector_id: b.connector_id, message_id: b.message_id,
        subject: b.subject, body: b.body_html, comms_email_operation_id: operationId, comms_email_reconcile: true,
        idempotency_key: `comms-email:${operationId}`,
      });
    } catch { /* settled by the readback */ }
    const after = object(await d.readResult(operationId));
    return after && TERMINAL.has(String(after.outcome)) ? commsEmailSafeResult(after, { reconciled: true }) : stuck(after?.reconcilable === true);
  } catch {
    return stuck(false);
  }
}
