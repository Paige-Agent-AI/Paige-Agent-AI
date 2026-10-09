import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

/**
 * Comms Messages Read — Paige's inbox visibility (#1104, first Stage 3 capability-
 * mandate slice). The owner's finding: platform-sent email IS canonical data
 * (public.messages, the unified inbox) but Paige had no registered read verb, so she
 * honestly reported "I can't see your direct sends." This registers the ENVELOPE read:
 * direction, channel, subject, status, contact, timestamps — bounded and live.
 *
 * Deliberately NOT included: message bodies. Envelope-only is the conservative read
 * (redaction by construction); body access is a separately-gated future capability,
 * never smuggled in with this one.
 *
 * The adapter (public.list_inbox_messages) is caller-scoped exactly like every other
 * Spine reader: the tenant is derived from current_user_tenant_id() and can never be
 * supplied from the wire (§59). No resolvable tenant → empty set, fail-closed.
 */
export const COMMS_MESSAGES_READ = {
  key: "comms.messages_read",
  domain: "comms",
  owner: "comms",
  humanSurface: "/solo/:account/clients/conversations",
  evidence: {
    signalKinds: ["comms.message_envelope"],
    adapter: "public.list_inbox_messages",
    audience: "owner_internal",
    freshness: "live read of the unified inbox on every call; no cached snapshot exists, so no returned row can be stale — created_at is the row's own time, not a freshness deadline",
    staleAfterDays: 1,
    projectionWindowDays: 1,
    sourceSystem: "unified_messages",
    sourceActorTypes: ["person", "agent"],
    classification: "operational",
    lifecycle: "current",
    safeSummary: "A message envelope's direction, channel, subject line, and delivery status.",
    referencePrefix: "comms:",
    factValues: {
      direction: ["inbound", "outbound"],
      channel: ["email", "sms", "voice"],
      status: ["sent", "queued", "failed", "scheduled"],
    },
  },
  action: {
    classification: "read",
    executor: "public.list_inbox_messages",
    idempotency: "read-only envelope projection; no rows are written",
    riskPolicyKey: "read_only",
    approvalAuthority: "none",
    chatTool: "inbox_list",
  },
  outcome: {
    kinds: ["current"],
    projector: "public.list_inbox_messages",
    railVisibility: "owner_internal",
  },
  chatBinding: "PARTIAL",
  // PARTIAL, not LIVE: the chat tool is wired (inbox_list) and calls the caller-scoped
  // RPC, but no authenticated end-to-end drive has been recorded yet. LIVE requires
  // that proof — an owner asking Paige what was sent and her answering from the inbox.
  mindBinding: "UNAVAILABLE",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

/**
 * INT-328 — Comms Email Send: ONE business email to ONE existing contact, through the tenant's
 * own email sender, governed end to end. Mirrors the invoice governed send
 * (sales_invoice.email_send): comms-email-command is the only door; it resolves the recipient
 * (the contact's primary address) and the sender on the server, raises the canonical approval
 * card, and its executor prepares one bound `messages` row that send-message claims, sends and
 * finalizes. Never marketing, never an invoice, agreement, booking link or campaign — those keep
 * their own capabilities.
 *
 * What the outcome means, stated so nobody over-reads it (§13): `provider_accepted` is the email
 * provider taking the message. It is never delivery, an open or a reply. An unknown provider
 * result is reconciled under the same operation, never retried as a new one.
 */
export const COMMS_EMAIL_SEND = {
  key: "comms.email_send",
  domain: "comms",
  owner: "comms",
  humanSurface: "/solo/:account/clients/conversations",
  readiness: "none",
  action: {
    classification: "external_effect",
    executor: "public.prepare_comms_email_send",
    chatTool: "comms_send_email",
    riskPolicyKey: "high",
    approvalAuthority: "chat-canonical",
    idempotency: "Server-derived tenant + authenticated actor + operation UUID (Chat derives it from the stable turn and command; an approval reuses the stored call). public.prepare_comms_email_send binds exactly one messages row per operation (unique index messages_comms_email_operation) and replays an identical prepare; send-message admits it only through public.claim_comms_email_send and records it through public.finalize_comms_email_send. An unknown provider result is reconciled under the same operation and the provider Idempotency-Key comms-email:<operation>, never retried as a new operation; an identical new request is routed to that reconciliation. Honest residuals: only a Resend operation inside 23 hours is reconciled. Gmail and SMTP have no provider idempotency, so an unknown send there is never auto-reconciled; it blocks only an identical resend (same recipient and content) and no other email. A Gmail or SMTP send that passes the 20 s deadline may still go out after it is recorded unknown. SMTP returns no provider receipt, so an SMTP send can be reported only as unknown, never as accepted. The approved sender is bound by address and provider; from_name and reply_to are read at send time from the connector and are not part of the approval. With no Chat thread, the operation id derives from the user-turn position, that turn's text and the command (the same derivation the invoice Chat uses; the turn context carries no per-session nonce), so the identical command at the same turn position in a later threadless session replays the earlier recorded result instead of sending again; the person is told it is the saved result of an earlier identical request, and changing any word sends.",
  },
  outcome: {
    kinds: ["provider_accepted", "refused", "failed", "needs_setup", "held", "sender_choice_required", "outcome_unknown"],
    projector: "public.read_comms_email_send_result",
    railVisibility: "Provider acceptance only; never delivered, opened or replied.",
  },
  chatBinding: "LIVE",
  mindBinding: "UNAVAILABLE",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

/**
 * The Capability Kit declaration the door binds through decideDeclaredCapability. It validates the
 * declared risk against the canonical policy (`comms_send_email` is `high` in action-risk.ts); it is
 * not another dispatcher, permission grant or approval channel.
 */
export const COMMS_EMAIL_SEND_CAPABILITY = defineCapability({
  identity: { id: "comms.email_send", version: 1, domain: "comms", owner: "comms", humanSurface: "/solo/:account/clients/conversations", description: "Send one business email to one existing contact through the workspace's own email sender. Provider acceptance is not delivery." },
  input: objectInputSchema({
    properties: {
      contact_id: { type: "string", format: "uuid" },
      connector_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
      subject: { type: "string", minLength: 1, maxLength: 200 },
      body: { type: "string", minLength: 1, maxLength: 10000 },
    },
    required: ["contact_id", "subject", "body"],
  }),
  effect: "external_effect",
  governance: { actionRiskKey: "comms_send_email", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("comms.email_send.execute") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.prepare_comms_email_send", connectionResolver: null },
  idempotency: { mode: "required", key: "Server actor + tenant + operation UUID + exact recipient address, sender address and content digest. Unknown provider results are reconciled under the same operation, never automatically resent as a new one.", readback: "public.read_comms_email_send_result", replay: "reconcile_then_return" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

/**
 * INT-345 K-3 — the governed calling-setup act's Capability Kit declaration.
 * The chat door binds the action-risk key comms_setup_calling (high → confirm) to
 * this declaration; it is not a second dispatcher. The executor is the dedicated
 * seam edge, tenant/actor server-derived (§59), and the effect is the one-time,
 * free, idempotent connection of the workspace's calling account — never a number
 * purchase or a primary selection.
 */
export const COMMS_SETUP_CALLING_CAPABILITY = defineCapability({
  identity: { id: "comms.setup_calling", version: 1, domain: "comms", owner: "comms", humanSurface: "/solo/:account/settings/registration", description: "Connect this workspace's calling account (one-time, free, idempotent). Buys no number and selects no primary; calling is READY only after the owner's Send-from-this choice." },
  input: objectInputSchema({
    properties: {
      dry_run: { type: "boolean" },
    },
    required: [],
  }),
  effect: "external_effect",
  governance: { actionRiskKey: "comms_setup_calling", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("comms.setup_calling.execute") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "unavailable"] },
  providerBinding: { kind: "internal", operation: "edge.comms-setup-calling", connectionResolver: null },
  idempotency: { mode: "required", key: "Server actor + tenant; the provisioning core is idempotent per step (existing row → skip; 23505 → skip; Vault upsert by name; TwiML ensure idempotent). skipped_existing performs no act.", readback: "public.tenant_comms_readiness() -> calling", replay: "reconcile_then_return" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});
