// INT-328 comms.email_send — the Chat half. Mirrors _shared/sales-invoice-chat.ts.
//
// Selection only. comms-email-command is the sole atomic approval consumer and execution gate:
// this module builds the canonical command from the model's closed arguments (or, on an approved
// card, takes the STORED call verbatim), derives a stable operation id, hands it to the door with
// the caller's own JWT, and narrows what comes back to closed, scalar keys plus the server-authored
// card. It resolves no recipient, sender, HTML, tenant or governance — the door does all of that on
// the server — and it never calls a provider.
//
// Scope (§13): ONE business email to ONE existing contact. Never marketing, newsletters, invoices,
// agreements or booking links — those keep their own tools.
import { COMMS_EMAIL_SEND_CAPABILITY } from "../paige-spine/domains/comms.ts";
import { CRM_APPROVAL_CANDIDATE_LIMIT, resolveCrmApprovedFingerprint } from "../crm-command/approval-resolution.ts";
import { COMMS_EMAIL_ACTION, COMMS_EMAIL_BODY_MAX, COMMS_EMAIL_SUBJECT_MAX, COMMS_EMAIL_TOOL, FINGERPRINT, UUID, parseCommsEmailCommand, type CommsEmailCommand } from "./contract.ts";

const DOOR = "comms-email-command";

// The tool schema is a projection of the Kit declaration's fields (the same names, the same
// required set), with model-facing descriptions. Actor, tenant, recipient address, sender address,
// HTML, operation and approval material are not model arguments.
const kitProperties = COMMS_EMAIL_SEND_CAPABILITY.input.properties as Readonly<Record<string, unknown>>;
const DESCRIPTIONS: Record<string, Record<string, unknown>> = {
  contact_id: { type: "string", format: "uuid", description: "The id of ONE existing contact in this workspace, from a contact read. Never guess it from a name." },
  subject: { type: "string", minLength: 1, maxLength: COMMS_EMAIL_SUBJECT_MAX, description: "One-line subject, no line breaks." },
  body: { type: "string", minLength: 1, maxLength: COMMS_EMAIL_BODY_MAX, description: "The email body as plain text. Blank lines separate paragraphs. No HTML." },
  connector_id: { type: "string", format: "uuid", description: "Omit unless this tool returned a list of sender addresses and the person chose one; then pass that choice's connector_id." },
};
const toolProperties = Object.fromEntries(Object.keys(kitProperties).map((key) => {
  const described = DESCRIPTIONS[key];
  if (!described) throw new Error(`comms_send_email: no Chat description for declared field ${key}`);
  return [key, described];
}));

export const COMMS_EMAIL_TOOLS = [
  {
    type: "function",
    function: {
      // A string literal, not COMMS_EMAIL_TOOL: capability-kit-lint binds a tool schema to its
      // defineCapability() declaration by the literal name it reads here.
      name: "comms_send_email",
      description: "With approval, send ONE one-to-one business email to ONE existing contact from the business's own email address. First resolve the contact with a contact read; if more than one contact could match the name, ask the person which one — never pick by name. The server picks the contact's email address and the sender; the person sees the exact email on a Needs your OK card before anything goes out. Never for marketing, newsletters, campaigns, invoices, agreements or booking links — those have their own tools. The email service accepting a message is not delivery. If the outcome could not be confirmed, never resend.",
      parameters: { type: "object", properties: toolProperties, required: [...COMMS_EMAIL_SEND_CAPABILITY.input.required], additionalProperties: false },
    },
  },
] as const;
export const COMMS_EMAIL_TOOL_NAMES: ReadonlySet<string> = new Set(COMMS_EMAIL_TOOLS.map((t) => t.function.name));

type Turn = { thread_id: string | null; user_turn_ordinal: number; user_turn: unknown };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Assistant/tool transcript growth cannot mint a second operation for the same user command. */
export async function commsEmailOperationId(tenant: string, actor: string, command: unknown, turn: Turn): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical({ namespace: "comms_email_chat_v1", tenant, actor, command, turn }))))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type CommsEmailApprovalQuery = {
  eq(key: string, value: unknown): CommsEmailApprovalQuery; in(key: string, values: string[]): CommsEmailApprovalQuery;
  is(key: string, value: null): CommsEmailApprovalQuery; not(key: string, operator: string, value: null): CommsEmailApprovalQuery;
  gt(key: string, value: string): CommsEmailApprovalQuery; limit(value: number): PromiseLike<{ data: { fingerprint?: unknown; args?: unknown }[] | null; error: unknown }>;
};
type Reply = { data: unknown; error: unknown };
export type CommsEmailChatDependencies = {
  admin: { from(name: string): { select(value: string): CommsEmailApprovalQuery } };
  caller: { functions: { invoke(name: string, options: { body: Record<string, unknown> }): Promise<Reply> } };
};
export type CommsEmailChatContext = { tenantId: string | null; userId: string; toolName: string; args: Record<string, unknown>; approved: Set<string>; sameToolCalls: number; turn: Turn };
type Refusal = "ambiguous" | "unclaimable" | "lookup_failed";
/** `spent`: the approval token this call handed to comms-email-command to redeem. The chat records it
 *  against the call, so the approval card reports what the call actually did (approval-outcome.ts)
 *  instead of "Didn't run" for an email that went out. */
export type CommsEmailChatResult = { content: Record<string, unknown>; refusal?: Refusal; tokens?: string[]; spent?: string };

function refusal(reason: Refusal): CommsEmailChatResult {
  const message = reason === "ambiguous" ? "More than one email approval could apply." : reason === "lookup_failed" ? "The email approval could not be checked." : "The email approval cannot be used in this scope.";
  return { refusal: reason, content: { success: false, error: message, note: "Nothing was sent by this call. Ask for a fresh email request; do not retry automatically." } };
}

const text = (value: unknown, max: number): string | null => typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
/** The card's email preview, narrowed to exactly the fields the person approves. Null when malformed. */
export function commsEmailConfirmPreview(value: unknown): { kind: "email"; to_name?: string; to_address: string; from_address: string; subject: string; body_text: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  const to = text(p.to_address, 320), from = text(p.from_address, 320), subject = text(p.subject, COMMS_EMAIL_SUBJECT_MAX), body = text(p.body_text, COMMS_EMAIL_BODY_MAX);
  if (p.kind !== "email" || !to || !from || !subject || !body) return null;
  if (p.to_name !== undefined && p.to_name !== null && text(p.to_name, 200) === null) return null;
  return { kind: "email", ...(typeof p.to_name === "string" && p.to_name ? { to_name: p.to_name } : {}), to_address: to, from_address: from, subject, body_text: body };
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Closed summary projection: provider ids, message ids, addresses, errors and headers never reach the model. */
export function commsEmailChatSafeResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["ok", "replayed", "provider_receipt_available", "delivery_confirmed"]) if (typeof source[key] === "boolean") out[key] = source[key];
  if (typeof source.outcome === "string" && /^[a-z_]{1,40}$/.test(source.outcome)) out.outcome = source.outcome;
  for (const key of ["reason", "code"]) if (typeof source[key] === "string" && CODE.test(source[key] as string)) out[key] = source[key];
  if (typeof source.reconciled_operation_id === "string") out.reconciled = true;
  return out;
}

const UNCONFIRMED = new Set(["prepared", "dispatching", "unknown", "outcome_unknown"]);
// §13: nothing re-checks an unknown send in the background. The only re-check is the door's own:
// an identical request (same operation, or same recipient + content) settles THAT send instead of
// minting a second one. Say exactly that, never "the platform keeps checking".
const UNKNOWN_NOTE = "Do not resend. Say you could not confirm whether it went out; asking for the same email again will check that send rather than send a second one.";
const REPLAY_NOTE = "This is the saved result of an earlier identical request; nothing new was sent.";
const NO_CODES = "Tell the person in plain words; never quote an internal code.";
/**
 * Door replies that carry no `outcome` but are, by construction, answered BEFORE any send is asked
 * for (method, JWT, request shape, workspace check, approval-store proposal write). Only these are
 * narrated "Not sent". A reply without an outcome that is NOT one of the door's own pre-send codes
 * (a gateway or runtime error body) proves nothing about whether a send was already asked for, so
 * it stays unconfirmed. The door marks an approval-store failure during a prepared recovery
 * `outcome_unknown` explicitly, so APPROVAL_STORE_UNAVAILABLE without an outcome is pre-send.
 */
const PRE_SEND_DOOR_CODES = new Set(["METHOD_NOT_ALLOWED", "UNAUTHENTICATED", "COMMS_EMAIL_COMMAND_INVALID", "WORKSPACE_CHANGED", "APPROVAL_STORE_UNAVAILABLE"]);
/** Plain-language owner notes for every reason/code the door, the executor or send-message can return. */
const REASON_NOTES: Record<string, string> = {
  // Who it goes to / who it comes from.
  RECIPIENT_EMAIL_MISSING: "This contact has no email address on file. Ask the person for it, or to add it to the contact.",
  TENANT_EMAIL_SENDER_MISSING: "The business has no email address connected to send from yet. It has to be connected in the business's settings first.",
  EMAIL_PROVIDER_NOT_CONFIGURED: "The business has no working email sending set up yet. It has to be connected in the business's settings first.",
  EMAIL_RECONNECT_REQUIRED: "The business's email connection needs to be reconnected in its settings.",
  CONTACT_NOT_IN_WORKSPACE: "That contact is not in this workspace.",
  RECIPIENT_CHANGED: "The contact's email address changed after the approval. Show the person the new address and propose the email again.",
  SENDER_CHANGED: "The business's sending address or its details changed after the approval. Propose the email again so the person sees the new sender.",
  CONTENT_CHANGED: "The email no longer matches what was approved. Propose it again so the person can approve the exact email.",
  // The recipient's preferences and the business's sending rules.
  BLOCKED_SUPPRESSED: "This address unsubscribed or previously bounced, so it cannot be emailed.",
  BLOCKED_CLIENT_DND: "This contact asked not to be contacted.",
  BLOCKED_NO_CONSENT: "This contact has not agreed to be contacted by email, so it cannot be sent.",
  QUEUED_TENANT_DND: "The business has do-not-disturb on right now. Nothing was sent or scheduled; it can be sent once that is off.",
  QUEUED_QUIET_HOURS: "It is inside the business's quiet hours. Nothing was sent or scheduled; it can be sent after quiet hours.",
  RECIPIENT_PREFERENCES_UNVERIFIED: "This contact's contact preferences could not be checked, so nothing was sent.",
  PRE_SEND_UNVERIFIED: "This contact's contact preferences could not be checked right before sending, so nothing was sent. It is safe to ask again.",
  EMAIL_READINESS_UNVERIFIED: "The email setup could not be checked just now, so nothing was sent. It is safe to try again in a moment.",
  SEND_NO_LONGER_ELIGIBLE: "Something about the contact, their address or the sending address changed since it was prepared, so nothing was sent. Propose the email again.",
  // The email service.
  PROVIDER_REJECTED: "The email service turned the message down, so it was not sent. Check the address and the business's email setup before trying again.",
  PROVIDER_NOT_ATTEMPTED: "The email service was never reached, so it was not sent. The business's email setup may need attention.",
  UNSPECIFIED: "It was stopped before sending and no further detail was recorded.",
  // The workspace, the approval and the request itself — all answered before any send.
  WORKSPACE_CHANGED: "The active workspace changed, so nothing was sent. Ask the person to reopen the right workspace and ask again.",
  UNAUTHENTICATED: "The person's sign-in could not be confirmed, so nothing was sent. Ask them to sign in again.",
  METHOD_NOT_ALLOWED: "The request could not be processed, so nothing was sent.",
  COMMS_EMAIL_COMMAND_INVALID: "The request was not in a form that can be sent, so nothing was sent.",
  COMMS_EMAIL_INVALID: "The approved request was not in a form that can be sent, so nothing was sent. Propose it again.",
  COMMS_EMAIL_FORBIDDEN: "Only a business owner or admin can send email from the business's address.",
  COMMS_EMAIL_AUTHORITY_UNAVAILABLE: "The approval could not be confirmed for this workspace, so nothing was sent. Propose it again.",
  COMMS_EMAIL_PREPARE_REFUSED: "The email could not be prepared for sending, so nothing was sent.",
  COMMS_EMAIL_PARTIES_UNAVAILABLE: "The contact or the sending address could not be read just now, so nothing was sent. It is safe to try again in a moment.",
  COMMS_EMAIL_RECONCILIATION_UNVERIFIED: "Earlier sends of this email could not be checked just now, so nothing was sent. It is safe to try again in a moment.",
  COMMS_EMAIL_DECISION_RECEIPT_FAILED: "The approval record could not be saved, so nothing was sent. It is safe to try again.",
  APPROVAL_STORE_UNAVAILABLE: "Approvals could not be saved or read just now, so nothing was sent. It is safe to try again in a moment.",
  APPROVAL_CYCLE_INVALID: "That approval no longer matches this email, so nothing was sent. Propose it again.",
  APPROVAL_CLAIM_INVALID: "That approval could not be used, so nothing was sent. Propose it again.",
  SEND_NOT_ADMITTED: "It was approved but the sending step did not take it. Nothing went out. The person can ask for it again, which starts a new request.",
};
function notSentNote(...keys: unknown[]): string {
  const plain = keys.map((k) => typeof k === "string" ? REASON_NOTES[k] : undefined).find((n) => n);
  return `Not sent. ${plain ?? "It was stopped before sending. Do not retry automatically."} ${NO_CODES}`;
}
const withReplay = (content: Record<string, unknown>): Record<string, unknown> =>
  content.replayed === true ? { ...content, note: `${content.note} ${REPLAY_NOTE}` } : content;

function readSenders(value: unknown): { connector_id: string; from_address: string }[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return [];
    const r = s as Record<string, unknown>;
    const from = text(r.from_address, 320);
    return typeof r.connector_id === "string" && UUID.test(r.connector_id) && from ? [{ connector_id: r.connector_id.toLowerCase(), from_address: from }] : [];
  });
}

const MODEL_KEYS = new Set(["contact_id", "subject", "body", "connector_id"]);
/** Door outcomes that guarantee nothing was dispatched for this operation. */
const NOT_SENT_OUTCOMES = new Set<unknown>(["refused", "held", "needs_setup", "failed"]);

/** Selection only. comms-email-command alone claims the approval and executes the stored call. */
export async function dispatchCommsEmailChat(ctx: CommsEmailChatContext, deps: CommsEmailChatDependencies): Promise<CommsEmailChatResult> {
  if (ctx.toolName !== COMMS_EMAIL_TOOL) return { content: { success: false, error: "Email action unavailable." } };
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) return { content: { success: false, error: "Email workspace unavailable." } };
  if (!ctx.args || typeof ctx.args !== "object" || Array.isArray(ctx.args)) return { content: { success: false, error: "Invalid email request." } };
  // `confirm` is the compatibility flag the general gate advertises on every mutating tool; it is
  // never approval here (the card's fingerprint is) and never part of the command.
  const modelArgs = { ...ctx.args };
  if (typeof modelArgs.confirm === "boolean") delete modelArgs.confirm;
  if (Object.keys(modelArgs).some((key) => !MODEL_KEYS.has(key))) return { content: { success: false, error: "Invalid email request. Pass only contact_id, subject, body and, when the person chose a sender, connector_id." } };

  const tokens: string[] = [];
  let approvedArgs: Record<string, unknown> | undefined;
  let fingerprint: string | undefined;
  if (ctx.approved.size) {
    try {
      const reply = await deps.admin.from("paige_pending_confirmations").select("fingerprint,args")
        .eq("tenant_id", ctx.tenantId).eq("user_id", ctx.userId).eq("tool_name", COMMS_EMAIL_TOOL)
        .in("fingerprint", [...ctx.approved].map((token) => token.split(":")[0]))
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
        .gt("expires_at", new Date().toISOString()).limit(CRM_APPROVAL_CANDIDATE_LIMIT + 1);
      if (reply.error) return refusal("lookup_failed");
      const rows = reply.data ?? [];
      for (const row of rows) for (const token of ctx.approved) if (token.split(":")[0] === row.fingerprint) tokens.push(token);
      // The door stores no approval_subject; the subject is read from the STORED command (the
      // contact the person saw on the card), never recomputed from model drift.
      const storedContact = (args: unknown): string | null => {
        const c = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>).command : null;
        const id = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>).contact_id : null;
        return typeof id === "string" ? id.toLowerCase() : null;
      };
      const subjected = rows.map((row) => { const id = storedContact(row.args); return { fingerprint: row.fingerprint, args: id ? { approval_subject: `${COMMS_EMAIL_ACTION}:${id}` } : {} }; });
      const subject = typeof modelArgs.contact_id === "string" ? `${COMMS_EMAIL_ACTION}:${modelArgs.contact_id.toLowerCase()}` : "";
      const selected = resolveCrmApprovedFingerprint(subjected, subject, ctx.sameToolCalls);
      if (selected.kind === "ambiguous") return { ...refusal("ambiguous"), tokens };
      if (selected.kind === "claim") {
        if (!ctx.approved.has(selected.fingerprint)) return { ...refusal("unclaimable"), tokens };
        const stored = rows.find((row) => row.fingerprint === selected.fingerprint)?.args;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { ...refusal("unclaimable"), tokens };
        approvedArgs = stored as Record<string, unknown>; fingerprint = selected.fingerprint;
      }
    } catch { return refusal("lookup_failed"); }
  }

  let command: CommsEmailCommand;
  let body: Record<string, unknown>;
  let spent: string | undefined;
  try {
    if (approvedArgs) {
      if (approvedArgs.expected_tenant_id !== ctx.tenantId || typeof approvedArgs.operation_id !== "string" || !UUID.test(approvedArgs.operation_id) || !fingerprint || !FINGERPRINT.test(fingerprint)) return { ...refusal("unclaimable"), tokens };
      command = parseCommsEmailCommand(approvedArgs.command);
      body = { expected_tenant_id: ctx.tenantId, operation_id: approvedArgs.operation_id, command, approved_fingerprint: fingerprint };
      spent = [...ctx.approved].find((token) => token.split(":")[0] === fingerprint);
    } else {
      command = parseCommsEmailCommand({ action: COMMS_EMAIL_ACTION, contact_id: modelArgs.contact_id, connector_id: modelArgs.connector_id ?? null, subject: modelArgs.subject, body: modelArgs.body });
      body = { expected_tenant_id: ctx.tenantId, operation_id: await commsEmailOperationId(ctx.tenantId, ctx.userId, command, ctx.turn), command };
    }
  } catch {
    return approvedArgs ? { ...refusal("unclaimable"), tokens } : { content: { success: false, error: "Invalid email request. contact_id must be a contact's id from a contact read; subject is one line of at most 200 characters; body is plain text of at most 10000 characters." }, tokens };
  }

  try {
    const reply = await deps.caller.functions.invoke(DOOR, { body });
    let data = reply.data;
    if (reply.error) {
      const error = reply.error as { context?: { json?: () => Promise<unknown> } };
      if (!error.context?.json) throw new Error("unanswered");
      data = await error.context.json();
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("unanswered");
    const result = data as Record<string, unknown>;
    if (result.outcome === "approval_required" && typeof result.fingerprint === "string" && FINGERPRINT.test(result.fingerprint)) {
      const preview = commsEmailConfirmPreview(result.preview);
      return { tokens, spent, content: { success: false, needs_confirm: true, requires_operator_approval: true, confirm_fingerprint: result.fingerprint,
        confirm_summary: typeof result.summary === "string" && result.summary ? result.summary : "Approve this email", ...(preview ? { confirm_preview: preview } : {}),
        note: "Show the Needs your OK card. Nothing was sent yet. Do not call this tool again until the person approves." } };
    }
    const safe = commsEmailChatSafeResult(result);
    if (result.ok === true && result.outcome === "provider_accepted") {
      return { tokens, spent, content: withReplay({ ...safe, success: true, delivery_confirmed: false, note: 'The email service accepted the message. That is not proof it was delivered or read — say "sent (accepted for delivery)", never "they received it" or "delivered".' }) };
    }
    // A door reply with no outcome is "Not sent" only when it is one of the door's own pre-send
    // answers; anything else that lacks an outcome (a runtime/gateway body) stays unconfirmed.
    const preSendRefusal = result.outcome === undefined && typeof result.code === "string" && PRE_SEND_DOOR_CODES.has(result.code);
    if (preSendRefusal) return { tokens, spent, content: { ...safe, success: false, outcome: "refused", not_applied: true, delivery_confirmed: false, note: notSentNote(result.code) } };
    if (result.outcome === "outcome_unknown" && result.code === "COMMS_EMAIL_IDENTICAL_IN_FLIGHT") {
      // Not "reconciled": the other send was named, not settled.
      const { reconciled: _notSettled, ...unsettled } = safe;
      return { tokens, spent, content: { ...unsettled, success: false, outcome: "outcome_unknown", delivery_confirmed: false, note: "An identical email to this person is already being sent, so this one was held back. Do not resend. Say it may already have gone out; asking again later will check that send rather than send a second one." } };
    }
    if (result.outcome === "outcome_unknown" && result.code === "COMMS_EMAIL_TEAMMATE_IN_FLIGHT") {
      // Someone else on the team asked for this exact email and its outcome is not confirmed. It is
      // theirs to settle: asking again here cannot check it, so never promise that.
      return { tokens, spent, content: { ...safe, success: false, outcome: "outcome_unknown", delivery_confirmed: false, note: `A teammate already asked for this exact email to this person, and whether it went out is not confirmed yet. Do not resend. Say it may already have gone out and suggest checking with the teammate who sent it. ${NO_CODES}` } };
    }
    if (typeof result.outcome !== "string" || UNCONFIRMED.has(result.outcome)) return { tokens, spent, content: withReplay({ ...safe, success: false, outcome: "outcome_unknown", delivery_confirmed: false, note: UNKNOWN_NOTE }) };
    if (result.outcome === "sender_choice_required") {
      return { tokens, spent, content: { ...safe, success: false, senders: readSenders(result.senders), note: "Nothing was sent. More than one business email address can send this. Ask the person which address to send from, then call again with that connector_id." } };
    }
    // The door returns these only when nothing was dispatched (refused / held / needs_setup are
    // answered before any claim; failed is a provider that refused the message), so the card may say
    // "didn't go through" — never "may have gone through" for an email that cannot have gone.
    const notApplied = NOT_SENT_OUTCOMES.has(result.outcome) ? { not_applied: true } : {};
    return { tokens, spent, content: withReplay({ ...safe, success: false, ...notApplied, note: notSentNote(result.reason, result.code) }) };
  } catch {
    return { tokens, spent, content: { success: false, outcome: "outcome_unknown", delivery_confirmed: false, note: `The email request has no verified response. ${UNKNOWN_NOTE}` } };
  }
}
