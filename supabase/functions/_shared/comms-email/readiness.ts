// INT-328 comms.email_send — readiness and server-side party resolution (one home).
//
// `emailSenderReadiness` is THE email-sender check. It was the email branch of the invoice
// delivery readiness (_shared/sales-invoice-delivery/readiness.ts), extracted unchanged so the
// two governed email sends cannot drift into two opinions about what a usable sender is; invoice
// readiness now calls it.
//
// Nothing here exposes a credential, a provider error, a raw recipient or a body: readiness
// returns a state and a code. The caller (comms-email-command) has already resolved the
// authenticated actor, the server-derived tenant and the owner/admin seat (§9/§59).
//
// Deliberately free of Deno-only imports: the sales-invoice readiness (and the vitest suites that
// load it) import this module for `emailSenderReadiness`, so the recipient pre-send check is
// INJECTED by the caller (comms-email-command passes `runPreSend` from _shared/pre-send-pipeline.ts)
// rather than imported here.
import { CLIENT_CONTACT_METHODS_EMBED, clientAddresses } from "../contact-methods.ts";
import { EMAIL_ADDRESS, UUID, normalizeCommsEmailAddress } from "./contract.ts";
import { decideContentRead } from "../inbox-intelligence/policy.ts";

export interface EmailSenderFacts {
  tenantMatches: boolean;
  active: boolean;
  provider: string;
  fromAddress: string | null;
  credentialReferencePresent: boolean;
  smtpConfigured?: boolean;
  /**
   * PAIGE Email (SendGrid) only: the From's domain belongs to THIS business and carries SendGrid
   * verification facts (tenant_email_domains.sendgrid_status='verified' + domain id + time), the same
   * rule prepare_comms_email_send enforces (_comms_email_sendgrid_sender_verified). An active connector
   * row is never this proof: a workspace admin can write a connector, not a verification.
   */
  sendgridSenderVerified?: boolean;
}
/**
 * `sendgridConfigured` is the PRESENCE (never the value) of the platform's restricted SendGrid Mail
 * Send credential. A caller that does not state it (invoice delivery today) does not recognise a
 * SendGrid sender at all: for it, SendGrid stays an unsupported provider, exactly as before.
 */
export interface EmailProviderEnvironment { resendConfigured: boolean; googleConfigured: boolean; sendgridConfigured?: boolean }
export type EmailSenderSetupReason = "TENANT_EMAIL_SENDER_MISSING" | "SENDER_VERIFICATION_MISSING" | "EMAIL_PROVIDER_NOT_CONFIGURED" | "EMAIL_RECONNECT_REQUIRED";

const BASE_EMAIL_PROVIDERS = ["resend", "gmail", "smtp"];
/** The providers a caller recognises: SendGrid only when the caller states the SendGrid credential fact. */
export const emailProvidersFor = (env: Pick<EmailProviderEnvironment, "sendgridConfigured">): string[] =>
  typeof env.sendgridConfigured === "boolean" ? [...BASE_EMAIL_PROVIDERS, "sendgrid"] : BASE_EMAIL_PROVIDERS;

/**
 * null = the sender is usable; otherwise the setup step that is missing. For PAIGE Email (SendGrid)
 * the four states are, in order: no usable connection (TENANT_EMAIL_SENDER_MISSING) → the sending
 * domain is not verified for this business (SENDER_VERIFICATION_MISSING) → the platform's authorized
 * sending credential is not configured (EMAIL_PROVIDER_NOT_CONFIGURED) → ready (null).
 */
export function emailSenderReadiness(
  s: EmailSenderFacts | null | undefined,
  env: EmailProviderEnvironment,
): null | { state: "needs_setup"; reason: EmailSenderSetupReason } {
  const needs = (reason: EmailSenderSetupReason) => ({ state: "needs_setup" as const, reason });
  if (!s || !s.tenantMatches || !s.active || !s.fromAddress || !EMAIL_ADDRESS.test(s.fromAddress) || !emailProvidersFor(env).includes(s.provider)) {
    return needs("TENANT_EMAIL_SENDER_MISSING");
  }
  if (s.provider === "sendgrid") {
    if (s.sendgridSenderVerified !== true) return needs("SENDER_VERIFICATION_MISSING");
    if (env.sendgridConfigured !== true) return needs("EMAIL_PROVIDER_NOT_CONFIGURED");
    return null;
  }
  if (s.provider === "resend" && !env.resendConfigured) return needs("EMAIL_PROVIDER_NOT_CONFIGURED");
  if (s.provider === "gmail" && (!env.googleConfigured || !s.credentialReferencePresent)) return needs("EMAIL_RECONNECT_REQUIRED");
  if (s.provider === "smtp" && (!s.credentialReferencePresent || !s.smtpConfigured)) return needs("EMAIL_RECONNECT_REQUIRED");
  return null;
}

export type CommsEmailReadinessReason =
  | "RECIPIENT_EMAIL_MISSING" | "SENDER_CHOICE_REQUIRED" | EmailSenderSetupReason
  | "BLOCKED_SUPPRESSED" | "BLOCKED_CLIENT_DND" | "BLOCKED_NO_CONSENT"
  | "QUEUED_TENANT_DND" | "QUEUED_QUIET_HOURS" | "RECIPIENT_PREFERENCES_UNVERIFIED"
  | "EMAIL_READINESS_UNVERIFIED" | "READY_FOR_GOVERNED_REVIEW";
export type CommsEmailReadiness = {
  eligible: boolean;
  state: "ready" | "needs_setup" | "held" | "unavailable";
  reason: CommsEmailReadinessReason;
  provider_execution_verified: false;
};
export interface CommsEmailReadinessFacts extends EmailProviderEnvironment {
  recipient: string | null;
  sender: EmailSenderFacts | null;
  /** How many usable senders the workspace has when none was chosen. */
  senderChoices?: number;
  preSend?: { proceed: boolean; outcome: string };
}

const PRE_SEND_REASON: Record<string, CommsEmailReadinessReason> = {
  blocked_suppressed: "BLOCKED_SUPPRESSED",
  blocked_client_dnd: "BLOCKED_CLIENT_DND",
  blocked_no_consent: "BLOCKED_NO_CONSENT",
  queued_tenant_dnd: "QUEUED_TENANT_DND",
  queued_quiet_hours: "QUEUED_QUIET_HOURS",
};

export function commsEmailReadiness(f: CommsEmailReadinessFacts): CommsEmailReadiness {
  const result = (state: CommsEmailReadiness["state"], reason: CommsEmailReadinessReason): CommsEmailReadiness =>
    ({ eligible: state === "ready", state, reason, provider_execution_verified: false });
  if (!f.recipient || !EMAIL_ADDRESS.test(f.recipient)) return result("needs_setup", "RECIPIENT_EMAIL_MISSING");
  if (!f.sender && (f.senderChoices ?? 0) > 1) return result("needs_setup", "SENDER_CHOICE_REQUIRED");
  const sender = emailSenderReadiness(f.sender, f);
  if (sender) return result(sender.state, sender.reason);
  // Recipient-specific preferences are part of readiness: no verified pre-send answer, no send.
  if (!f.preSend) return result("held", "RECIPIENT_PREFERENCES_UNVERIFIED");
  if (!f.preSend.proceed || f.preSend.outcome !== "proceed") return result("held", PRE_SEND_REASON[f.preSend.outcome] ?? "RECIPIENT_PREFERENCES_UNVERIFIED");
  return result("ready", "READY_FOR_GOVERNED_REVIEW");
}

/** The door's outcome for a readiness that is not ready. A block is a refusal; a hold may clear. */
export function commsEmailReadinessOutcome(r: CommsEmailReadiness): "needs_setup" | "refused" | "held" {
  if (r.state === "needs_setup") return "needs_setup";
  if (r.state === "held" && !r.reason.startsWith("BLOCKED_")) return "held";
  return "refused";
}

/* ───────────────────────── reads (service client, tenant-filtered) ───────────────────────── */

interface ReadResult { data: unknown; error: unknown }
interface ReadQuery extends PromiseLike<ReadResult> { eq(column: string, value: unknown): ReadQuery; maybeSingle(): PromiseLike<ReadResult> }
/** The slice of the service client these reads use. Every read is filtered to the server-derived tenant. */
export interface CommsEmailAdmin { from(table: string): { select(columns: string): ReadQuery } }
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
// Reuse the canonical active/tenant/personal-owner mailbox policy. A background
// caller with no authenticated person may use a company sender, never a person's
// private mailbox. This projection carries no credentials or mailbox contents.
function senderAllowed(c: ObjectValue, tenantId: string, actorUserId?: string | null): boolean {
  if (c.mailbox_class === "personal" && (typeof actorUserId !== "string" || !UUID.test(actorUserId))) return false;
  return decideContentRead({ callerUserId: actorUserId ?? "", callerTenantId: tenantId,
    mailboxTenantId: typeof c.tenant_id === "string" ? c.tenant_id : "",
    mailbox: { mailbox_class: c.mailbox_class, mailbox_owner_user_id: c.mailbox_owner_user_id,
      status: c.status, active: c.active, mailbox_scopes: null } }).allowed;
}

export type CommsEmailParties =
  | { kind: "contact_not_in_workspace" }
  | { kind: "recipient_missing"; contactName: string }
  | { kind: "sender_missing"; contactName: string; recipient: string }
  | { kind: "sender_choice_required"; contactName: string; recipient: string; senders: { connector_id: string; from_address: string }[] }
  | { kind: "resolved"; contactId: string; contactName: string; recipient: string; connectorId: string; fromAddress: string | null };

const contactName = (row: ObjectValue): string => {
  const person = [row.first_name, row.last_name].filter((p) => typeof p === "string" && p.trim()).map((p) => (p as string).trim()).join(" ");
  if (person) return person;
  return typeof row.entity_name === "string" && row.entity_name.trim() ? row.entity_name.trim() : "this contact";
};

/**
 * Who the email goes to and who it comes from, resolved on the server — never from model prose.
 * Recipient: the contact's PRIMARY email from public.client_contact_methods, the same source
 * send-message's recipient_contact_mismatch check reads (CLIENT_CONTACT_METHODS_EMBED).
 * Sender: the named connector if one was supplied (readiness grades whether it is usable);
 * otherwise the workspace's only active email sender, or a choice when it has several.
 * A read failure throws: the caller answers "unavailable", never a guessed party.
 */
export async function resolveCommsEmailParties(
  admin: CommsEmailAdmin,
  input: { tenantId: string; actorUserId?: string | null; contactId: string; connectorId: string | null },
  providers: readonly string[] = BASE_EMAIL_PROVIDERS,
): Promise<CommsEmailParties> {
  const contact = await admin.from("clients").select(`id,tenant_id,first_name,last_name,entity_name,${CLIENT_CONTACT_METHODS_EMBED}`)
    .eq("id", input.contactId).eq("tenant_id", input.tenantId).maybeSingle();
  if (contact.error) throw new Error("contact_read_failed");
  const row = object(contact.data);
  if (row.id !== input.contactId || row.tenant_id !== input.tenantId) return { kind: "contact_not_in_workspace" };
  const name = contactName(row);
  const recipient = normalizeCommsEmailAddress(clientAddresses(row as { client_contact_methods?: unknown }).email);
  if (!recipient) return { kind: "recipient_missing", contactName: name };

  if (input.connectorId) {
    const chosen = await admin.from("channel_connectors").select("id,tenant_id,from_address,status,active,mailbox_class,mailbox_owner_user_id")
      .eq("tenant_id", input.tenantId).eq("id", input.connectorId).eq("channel_type", "email").maybeSingle();
    if (chosen.error) throw new Error("sender_read_failed");
    const c = object(chosen.data);
    if (c.id !== input.connectorId || !senderAllowed(c, input.tenantId, input.actorUserId)) return { kind: "sender_missing", contactName: name, recipient };
    return { kind: "resolved", contactId: input.contactId, contactName: name, recipient, connectorId: input.connectorId, fromAddress: normalizeCommsEmailAddress(c.from_address) };
  }
  const listed = await admin.from("channel_connectors").select("id,tenant_id,provider,from_address,active,status,mailbox_class,mailbox_owner_user_id")
    .eq("tenant_id", input.tenantId).eq("channel_type", "email").eq("active", true).eq("status", "active");
  if (listed.error || !Array.isArray(listed.data)) throw new Error("sender_read_failed");
  const senders = (listed.data as unknown[]).map(object)
    .filter((c) => senderAllowed(c, input.tenantId, input.actorUserId) && typeof c.id === "string" && providers.includes(String(c.provider)) && normalizeCommsEmailAddress(c.from_address))
    .map((c) => ({ connector_id: (c.id as string).toLowerCase(), from_address: normalizeCommsEmailAddress(c.from_address)! }))
    .sort((a, b) => a.from_address.localeCompare(b.from_address) || a.connector_id.localeCompare(b.connector_id));
  if (!senders.length) return { kind: "sender_missing", contactName: name, recipient };
  if (senders.length > 1) return { kind: "sender_choice_required", contactName: name, recipient, senders };
  return { kind: "resolved", contactId: input.contactId, contactName: name, recipient, connectorId: senders[0].connector_id, fromAddress: senders[0].from_address };
}

/**
 * THE read of a tenant email connector's sender facts (§18 one home — comms readiness reads its
 * sender through this). Tenant- and email-filtered; reads only whether a credential REFERENCE
 * exists, never a secret. null = no such connector in this tenant; a read failure throws.
 */
export async function readEmailSenderFacts(admin: CommsEmailAdmin, tenantId: string, connectorId: string, actorUserId?: string | null): Promise<EmailSenderFacts | null> {
  const { data, error } = await admin.from("channel_connectors").select("tenant_id,active,status,provider,from_address,credentials_vault_ref,config,mailbox_class,mailbox_owner_user_id")
    .eq("tenant_id", tenantId).eq("id", connectorId).eq("channel_type", "email").maybeSingle();
  if (error) throw new Error("setup_read_failed");
  if (!data) return null;
  const c = object(data), config = object(c.config);
  if (!senderAllowed(c, tenantId, actorUserId)) return null;
  const facts: EmailSenderFacts = {
    tenantMatches: c.tenant_id === tenantId, active: c.active === true && c.status === "active", provider: String(c.provider ?? ""),
    fromAddress: typeof c.from_address === "string" ? c.from_address : null,
    credentialReferencePresent: typeof c.credentials_vault_ref === "string" && !!c.credentials_vault_ref,
    smtpConfigured: typeof config.host === "string" && Number.isInteger(config.port),
  };
  if (facts.provider === "sendgrid") facts.sendgridSenderVerified = await readSendgridSenderVerified(admin, tenantId, facts.fromAddress);
  return facts;
}

/**
 * Whether THIS business verified the From's domain for PAIGE Email (SendGrid). Mirrors
 * _comms_email_sendgrid_sender_verified (the database re-checks it at prepare and at send). Reads
 * only the verification facts, filtered to the server-derived tenant and the exact domain. Fails
 * closed: a malformed From or a missing row is "not verified"; a read failure throws.
 */
export async function readSendgridSenderVerified(admin: CommsEmailAdmin, tenantId: string, fromAddress: string | null): Promise<boolean> {
  const address = normalizeCommsEmailAddress(fromAddress);
  const parts = address?.split("@") ?? [];
  if (!address || parts.length !== 2 || !parts[1]) return false;
  const { data, error } = await admin.from("tenant_email_domains").select("tenant_id,domain,sendgrid_status,sendgrid_domain_id,sendgrid_verified_at")
    .eq("tenant_id", tenantId).eq("domain", parts[1]).maybeSingle();
  if (error) throw new Error("sender_verification_read_failed");
  const d = object(data);
  return d.tenant_id === tenantId && typeof d.domain === "string" && d.domain.trim().toLowerCase() === parts[1]
    && d.sendgrid_status === "verified" && typeof d.sendgrid_verified_at === "string" && !!d.sendgrid_verified_at
    && typeof d.sendgrid_domain_id === "string" && !!d.sendgrid_domain_id.trim();
}

/** The recipient-specific pre-send check (_shared/pre-send-pipeline.ts `runPreSend`), injected. */
export type CommsEmailPreSendCheck = (
  admin: never,
  input: { tenantId: string; channel: "email"; to: string; contactId: string },
) => Promise<{ proceed: boolean; outcome: string }>;

/** Same reads as invoice delivery readiness: the tenant's connector row, provider environment, then the pre-send check. */
export async function readCommsEmailReadiness(
  admin: CommsEmailAdmin,
  input: { tenantId: string; actorUserId?: string | null; contactId: string; recipient: string | null; connectorId: string | null },
  env: (key: string) => string | undefined,
  preSendCheck: CommsEmailPreSendCheck,
): Promise<CommsEmailReadiness> {
  // Presence checks only: no credential value is read into a fact, logged or returned.
  const facts = { recipient: input.recipient, sender: null as EmailSenderFacts | null, resendConfigured: !!env("RESEND_API_KEY"), googleConfigured: !!env("GOOGLE_OAUTH_CLIENT_ID") && !!env("GOOGLE_OAUTH_CLIENT_SECRET"),
    sendgridConfigured: !!env("SENDGRID_MAIL_SEND_API_KEY") };
  try {
    if (input.connectorId) facts.sender = await readEmailSenderFacts(admin, input.tenantId, input.connectorId, input.actorUserId);
    const setup = commsEmailReadiness(facts);
    if (setup.state === "needs_setup") return setup;
    const preSend = await preSendCheck(admin as never, { tenantId: input.tenantId, channel: "email", to: input.recipient ?? "", contactId: input.contactId });
    return commsEmailReadiness({ ...facts, preSend });
  } catch {
    return { eligible: false, state: "unavailable", reason: "EMAIL_READINESS_UNVERIFIED", provider_execution_verified: false };
  }
}
