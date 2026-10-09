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

/**
 * #1140 two-mailbox pilot — the separately-authorized CONTENT read. comms.messages_read
 * stays envelope-only by construction; bodies flow only through this capability's
 * executor (public.read_message_content), which enforces the mailbox policy in SQL:
 * personal = the granting owner only, shared_support = tenant staff, inactive
 * connector = revoked consent = refusal. Plain-text body only, bounded to 8000 chars.
 */
export const COMMS_MESSAGE_CONTENT_READ = {
  key: "comms.message_content_read",
  domain: "comms",
  owner: "comms",
  humanSurface: "/solo/:account/clients/conversations",
  readiness: "none",
  evidence: {
    signalKinds: ["comms.message_content"],
    adapter: "public.read_message_content",
    audience: "owner_internal",
    freshness: "live read of the unified inbox row plus its canonical labels and classification on every call; no cached snapshot exists",
    staleAfterDays: 1,
    projectionWindowDays: 1,
    sourceSystem: "unified_messages",
    sourceActorTypes: ["person", "agent"],
    classification: "operational",
    lifecycle: "current",
    safeSummary: "One message's envelope, plain-text body (bounded), canonical labels and classification — after the mailbox policy admits the caller.",
    referencePrefix: "comms:",
    factValues: {
      direction: ["inbound", "outbound"],
      channel: ["email", "sms", "voice"],
      status: ["sent", "queued", "failed", "scheduled", "received"],
    },
  },
  action: {
    classification: "read",
    executor: "public.read_message_content",
    idempotency: "read-only projection; no rows are written",
    riskPolicyKey: "read_only",
    approvalAuthority: "none",
    chatTool: "read_message_content",
    seatAuthority: "member",
  },
  outcome: {
    kinds: ["current"],
    projector: "public.read_message_content",
    railVisibility: "owner_internal",
  },
  chatBinding: "PARTIAL",
  // PARTIAL, not LIVE: the chat tool is wired and the RPC is caller-scoped, but no
  // authenticated end-to-end drive has been recorded yet (same bar as messages_read).
  mindBinding: "UNAVAILABLE",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

/**
 * #1140 — the shared-support mailbox's case list: open cases, their classification
 * tier, and pending follow-ups. Read-only, tenant-scoped, shared_support connectors
 * only (the engine never opens cases on personal mailboxes).
 */
export const COMMS_SUPPORT_CASES_READ = {
  key: "comms.support_cases_read",
  domain: "comms",
  owner: "comms",
  humanSurface: "/solo/:account/clients/conversations",
  readiness: "none",
  evidence: {
    signalKinds: ["comms.support_case"],
    adapter: "public.read_support_cases",
    audience: "owner_internal",
    freshness: "live read of support_cases plus each thread's latest subject on every call",
    staleAfterDays: 1,
    projectionWindowDays: 7,
    sourceSystem: "support_cases",
    sourceActorTypes: ["person", "agent"],
    classification: "operational",
    lifecycle: "current",
    safeSummary: "Support case state per thread: status, intent tier, last activity, and pending follow-ups.",
    referencePrefix: "comms:case:",
    factValues: {
      status: ["open", "awaiting_owner", "drafted", "sent", "awaiting_customer", "resolved", "closed"],
      last_risk_tier: ["routine", "elevated"],
    },
  },
  action: {
    classification: "read",
    executor: "public.read_support_cases",
    idempotency: "read-only projection; no rows are written",
    riskPolicyKey: "read_only",
    approvalAuthority: "none",
    chatTool: "read_support_cases",
    seatAuthority: "member",
  },
  outcome: {
    kinds: ["current"],
    projector: "public.read_support_cases",
    railVisibility: "owner_internal",
  },
  chatBinding: "PARTIAL",
  mindBinding: "UNAVAILABLE",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

/**
 * #1140 — governed Gmail mailbox organization: label/unlabel, archive/unarchive,
 * trash/untrash, unsubscribe proposals. Every provider-side write is an external
 * effect on a real mailbox and goes through the canonical approval card
 * (comms-mailbox-command), which alone claims the approval and executes the STORED
 * call. The union has no delete kind and the required scope (gmail.modify) excludes
 * permanent deletion — reversibility is structural, not behavioral. The door
 * re-proves the mailbox policy (owner binding, active connector, granted scope)
 * on every command, including undo.
 */
export const COMMS_MAILBOX_ORGANIZE = {
  key: "comms.gmail_organize",
  domain: "comms",
  owner: "comms",
  humanSurface: "/solo/:account/clients/conversations",
  readiness: "none",
  action: {
    classification: "external_effect",
    executor: "public.record_mailbox_organize",
    chatTool: "gmail_organize",
    riskPolicyKey: "high",
    approvalAuthority: "chat-canonical",
    seatAuthority: "door-seat",
    idempotency: "Applying the same organization twice is the same mailbox state (idempotent provider calls); each approved execution records the canonical mirror and its undo window under the actor + tenant + message + kind + label digest. Unsubscribe sends once per recorded target.",
  },
  outcome: {
    kinds: ["applied", "refused", "failed", "outcome_unknown"],
    projector: "public.read_message_content",
    railVisibility: "owner_internal",
  },
  chatBinding: "LIVE",
  // LIVE = the Chat wiring exists and the door is the one execution path (the registry's
  // requirement for mutating capabilities). The authenticated end-to-end drive is still
  // owed post-deploy and is named in the delivery evidence; maturity PARTIAL carries it.
  mindBinding: "UNAVAILABLE",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

/**
 * The Capability Kit declaration the organize door binds through decideDeclaredCapability.
 * The command is the closed union from _shared/inbox-intelligence/organize.ts; the door
 * re-parses the STORED command with that parser before anything runs.
 */
export const COMMS_MAILBOX_ORGANIZE_CAPABILITY = defineCapability({
  identity: { id: "comms.gmail_organize", version: 1, domain: "comms", owner: "comms", humanSurface: "/solo/:account/clients/conversations", description: "Organize one synced Gmail mailbox message reversibly — label, archive, trash, their undos, or a proposed unsubscribe (the person sends the one-click request themselves — Paige never sends it). Never a permanent deletion; the mailbox kinds are reversible and the unsubscribe kinds are not presented as undoable." },
  input: objectInputSchema({
    properties: {
      kind: { type: "string", enum: ["label", "unlabel", "archive", "unarchive", "trash", "untrash", "unsubscribe_propose"] },
      message_id: { type: "string", format: "uuid" },
      label: { anyOf: [{ type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,31}$" }, { type: "null" }] },
    },
    required: ["kind", "message_id"],
  }),
  effect: "external_effect",
  governance: { actionRiskKey: "gmail_organize", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("comms.gmail_organize.execute") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.record_mailbox_organize", connectionResolver: null },
  idempotency: { mode: "required", key: "Server actor + tenant + message + kind + label. Provider modify/trash calls are idempotent state transitions; an unknown provider result is reported, never blindly retried as a new approval.", readback: "public.read_message_content", replay: "return_recorded_result" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});


/**
 * The read Kit declarations the capability-kit lint's read construction clears:
 * effect read + actionRiskKey null + read_only + none + a public.read_* executor whose
 * name pins the tool, with the tool schema bound to THIS declaration's .input.
 */
export const COMMS_MESSAGE_CONTENT_READ_KIT = defineCapability({
  identity: { id: "comms.message_content_read", version: 1, domain: "comms", owner: "comms", humanSurface: "/solo/:account/clients/conversations", description: "Read one inbox message's envelope, bounded plain-text body, canonical labels and classification, after the mailbox policy admits the caller." },
  input: objectInputSchema({ properties: {
    message_id: { type: "string", format: "uuid", description: "The message id from inbox_list or a support case." },
  }, required: ["message_id"] }),
  effect: "read", governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("comms.message_content_read.execute") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.read_message_content", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const COMMS_SUPPORT_CASES_READ_KIT = defineCapability({
  identity: { id: "comms.support_cases_read", version: 1, domain: "comms", owner: "comms", humanSurface: "/solo/:account/clients/conversations", description: "List the shared-support mailbox's cases — status, risk tier, last activity, pending follow-ups." },
  input: objectInputSchema({ properties: {
    status: { type: "string", enum: ["open", "awaiting_owner", "drafted", "sent", "awaiting_customer", "resolved", "closed"], description: "Filter to one status." },
    followups_only: { type: "boolean", description: "True to list only cases with a pending follow-up." },
  }, required: [] }),
  effect: "read", governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("comms.support_cases_read.execute") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.read_support_cases", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

