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
import { EMAIL_ADDRESS, normalizeCommsEmailAddress } from "./contract.ts";

export interface EmailSenderFacts {
  tenantMatches: boolean;
  active: boolean;
  provider: string;
  fromAddress: string | null;
  credentialReferencePresent: boolean;
  smtpConfigured?: boolean;
}
export interface EmailProviderEnvironment { resendConfigured: boolean; googleConfigured: boolean }
export type EmailSenderSetupReason = "TENANT_EMAIL_SENDER_MISSING" | "EMAIL_PROVIDER_NOT_CONFIGURED" | "EMAIL_RECONNECT_REQUIRED";

/** null = the sender is usable; otherwise the setup step that is missing. */
export function emailSenderReadiness(
  s: EmailSenderFacts | null | undefined,
  env: EmailProviderEnvironment,
): null | { state: "needs_setup"; reason: EmailSenderSetupReason } {
  const needs = (reason: EmailSenderSetupReason) => ({ state: "needs_setup" as const, reason });
  if (!s || !s.tenantMatches || !s.active || !s.fromAddress || !EMAIL_ADDRESS.test(s.fromAddress) || !["resend", "gmail", "smtp"].includes(s.provider)) {
    return needs("TENANT_EMAIL_SENDER_MISSING");
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
  input: { tenantId: string; contactId: string; connectorId: string | null },
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
    const chosen = await admin.from("channel_connectors").select("id,tenant_id,from_address")
      .eq("tenant_id", input.tenantId).eq("id", input.connectorId).eq("channel_type", "email").maybeSingle();
    if (chosen.error) throw new Error("sender_read_failed");
    const c = object(chosen.data);
    if (c.id !== input.connectorId || c.tenant_id !== input.tenantId) return { kind: "sender_missing", contactName: name, recipient };
    return { kind: "resolved", contactId: input.contactId, contactName: name, recipient, connectorId: input.connectorId, fromAddress: normalizeCommsEmailAddress(c.from_address) };
  }
  const listed = await admin.from("channel_connectors").select("id,tenant_id,provider,from_address,active,status")
    .eq("tenant_id", input.tenantId).eq("channel_type", "email").eq("active", true).eq("status", "active");
  if (listed.error || !Array.isArray(listed.data)) throw new Error("sender_read_failed");
  const senders = (listed.data as unknown[]).map(object)
    .filter((c) => c.tenant_id === input.tenantId && typeof c.id === "string" && ["resend", "gmail", "smtp"].includes(String(c.provider)) && normalizeCommsEmailAddress(c.from_address))
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
export async function readEmailSenderFacts(admin: CommsEmailAdmin, tenantId: string, connectorId: string): Promise<EmailSenderFacts | null> {
  const { data, error } = await admin.from("channel_connectors").select("tenant_id,active,status,provider,from_address,credentials_vault_ref,config")
    .eq("tenant_id", tenantId).eq("id", connectorId).eq("channel_type", "email").maybeSingle();
  if (error) throw new Error("setup_read_failed");
  if (!data) return null;
  const c = object(data), config = object(c.config);
  return {
    tenantMatches: c.tenant_id === tenantId, active: c.active === true && c.status === "active", provider: String(c.provider ?? ""),
    fromAddress: typeof c.from_address === "string" ? c.from_address : null,
    credentialReferencePresent: typeof c.credentials_vault_ref === "string" && !!c.credentials_vault_ref,
    smtpConfigured: typeof config.host === "string" && Number.isInteger(config.port),
  };
}

/** The recipient-specific pre-send check (_shared/pre-send-pipeline.ts `runPreSend`), injected. */
export type CommsEmailPreSendCheck = (
  admin: never,
  input: { tenantId: string; channel: "email"; to: string; contactId: string },
) => Promise<{ proceed: boolean; outcome: string }>;

/** Same reads as invoice delivery readiness: the tenant's connector row, provider environment, then the pre-send check. */
export async function readCommsEmailReadiness(
  admin: CommsEmailAdmin,
  input: { tenantId: string; contactId: string; recipient: string | null; connectorId: string | null },
  env: (key: string) => string | undefined,
  preSendCheck: CommsEmailPreSendCheck,
): Promise<CommsEmailReadiness> {
  const facts = { recipient: input.recipient, sender: null as EmailSenderFacts | null, resendConfigured: !!env("RESEND_API_KEY"), googleConfigured: !!env("GOOGLE_OAUTH_CLIENT_ID") && !!env("GOOGLE_OAUTH_CLIENT_SECRET") };
  try {
    if (input.connectorId) facts.sender = await readEmailSenderFacts(admin, input.tenantId, input.connectorId);
    const setup = commsEmailReadiness(facts);
    if (setup.state === "needs_setup") return setup;
    const preSend = await preSendCheck(admin as never, { tenantId: input.tenantId, channel: "email", to: input.recipient ?? "", contactId: input.contactId });
    return commsEmailReadiness({ ...facts, preSend });
  } catch {
    return { eligible: false, state: "unavailable", reason: "EMAIL_READINESS_UNVERIFIED", provider_execution_verified: false };
  }
}
