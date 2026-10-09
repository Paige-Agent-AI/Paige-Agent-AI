import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../_shared/comms-provider-boundary.ts";
import {collectInvoiceLedger} from '../_shared/sales-invoice-ledger.ts';
import {renderSalesInvoiceDocument} from '../_shared/sales-invoice-document.ts';
import {renderDocumentPdf} from '../_shared/document-pdf.ts';
import {pdfEmailAttachment} from '../_shared/email-attachments.ts';
import { readInvoiceDeliveryReadiness, type InvoiceReadinessAdmin } from "../_shared/sales-invoice-delivery/readiness-reader.ts";
import { PAIGE_APP_ORIGIN } from "../_shared/canonical-app-url.ts";
// Unified send dispatcher — routes email via Resend, SMS via Twilio.
// SMS is a tenant-configurable channel: it sends only when the tenant's Twilio
// A2P registration is approved (config.twilio_a2p_status). Email is the default.
// Writes every send to paige_messages_audit and mirrors outbound to paige_conversations.
//
// Comms C-1 (§18/§32): email now routes THROUGH the shared channel-adapter registry
// (_shared/channel-adapters.ts) — an email OutboundChannelAdapter is registered here
// and invoked via getOutboundAdapter("email"), so the abstraction is exercised live,
// not merely compiled. On a successful send this also writes/patches the tenant-isolated
// public.messages row (the NormalizedMessage unified-inbox substrate) to status='sent'
// + provider_message_id — INSERT a fresh outbound row for a direct send, or UPDATE the
// existing draft row when an approved draft (message_id) is being sent. Idempotent on
// provider_message_id. The legacy paige_messages_audit write + paige_conversations
// mirror + JWT gate + SMS path are all preserved unchanged (§37 additive-only).
import { stampedWebhookUrls } from "../_shared/twilio-webhook-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildListUnsubscribeHeaders,
  getOutboundAdapter,
  registerOutboundAdapter,
  type NormalizedMessage,
  type OutboundChannelAdapter,
  type OutboundSendContext,
} from "../_shared/channel-adapters.ts";
// C-2a: the per-tenant Twilio seam (subaccount creds + send) and the LOCKED pre-send
// compliance pipeline (SEND-MESSAGE-CONTRACT §3 steps 1–5). SMS routes THROUGH the
// registry adapter below (no inline master-cred path); every send passes runPreSend first.
import { resolveTwilioCreds, sendSms, type SupabaseAdminLike } from "../_shared/twilio.ts";
// #141b — the ONE authenticated Gmail seam (resolve access token from a connector's
// Vault ref + send RFC 822). The email adapter dispatches to it when provider==='gmail'.
import { resolveGmailAccessToken, gmailSend } from "../_shared/gmail.ts";
// #141c — the ONE generic-SMTP seam (resolve {user,pass} from a connector's Vault ref +
// send through the tenant's OWN SMTP host, SSRF-guarded). The SAME email adapter dispatches
// to it when provider==='smtp' (§18 — not a second 'email' registry entry).
import { resolveSmtpCreds, smtpSend } from "../_shared/smtp.ts";
import { runPreSend } from "../_shared/pre-send-pipeline.ts";
import { CLIENT_CONTACT_METHODS_EMBED, clientAddresses } from "../_shared/contact-methods.ts";
import { parseDeliveryBinding, renderTransientInvoiceLink, renderTransientInvoiceText, type DeliveryBinding } from "../_shared/sales-invoice-delivery/binding.ts";
import { mintSignerToken, sha256Hex } from "../_shared/agreements/token.ts";
import { providerExecutionBlocked, QA_BOUNDARY_REFUSAL_NOTE, QA_NO_PROVIDER_EXECUTION_CODE } from "../_shared/inbox-intelligence/provider-boundary.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendBody {
  invoice_delivery_operation_id?: string;
  channel: "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  contact_id?: string;
  conversation_id?: string;
  in_reply_to?: string;
  approval_id?: string;
  // ── Comms C-1 additive fields (all optional; legacy callers omit them) ──
  // When present, patch this existing draft messages row to 'sent' instead of
  // inserting a fresh outbound row (the one-click Approve → send flow).
  message_id?: string;
  // Unified-inbox linkage for a fresh outbound row (tenant is still server-derived
  // by the messages trigger from connector_id/contact_id — never from the body, §9).
  connector_id?: string;
  thread_key?: string;
  // C-2a: explicit staff override of a CLIENT-level do-not-disturb hold (pre-send step 1
  // ONLY). Never overrides suppression/consent (steps 2–3). Audited via the terminal row.
  override_client_dnd?: boolean;
  // C-1.5 additive: attachments persisted on the messages row (object paths in the private
  // comms-attachments bucket), and scheduled_for to queue-for-later / undo-send.
  attachments?: { url: string; mime?: string; name?: string; size?: number }[];
  scheduled_for?: string;
  // ── Marketing email (E1, owner rulings 2026-10-04) — additive; every other caller omits both. ──
  // marketing=true makes the one-click unsubscribe MANDATORY: the send is refused (outcome
  // blocked_unsubscribe_unavailable) unless a token is minted and the body carries {{unsubscribe_url}},
  // which is replaced per recipient. List-Unsubscribe headers go out on every provider route.
  marketing?: boolean;
  // A stable per-recipient send identity (the campaign worker passes its recipient id). Forwarded to
  // the provider as Idempotency-Key where the provider supports one (Resend).
  idempotency_key?: string;
  // ── INT-328 comms.email_send (additive; only comms-email-command sends these, service role). ──
  // The governed one-recipient business email. The prepared messages row carries
  // meta.comms_email_binding; this path re-reads it, sends exactly that, and finalizes it.
  comms_email_operation_id?: string;
  // true = re-enter an 'unknown'/stale-'dispatching' Resend operation under the SAME
  // provider idempotency key (the claim RPC decides whether that is allowed).
  comms_email_reconcile?: boolean;
}

// ── INT-328 comms.email_send helpers. Every one is used ONLY on the comms_email path. ──
const COMMS_EMAIL_PROVIDER_TIMEOUT_MS = 20_000;
const COMMS_EMAIL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface CommsEmailBinding {
  operation_id: string; tenant_id: string; contact_id: string; connector_id: string;
  recipient: string; from_address: string; provider: "resend" | "gmail" | "smtp";
  subject: string; body_html: string; state: string;
}
type CommsEmailOutcome = "provider_accepted" | "failed" | "refused" | "unknown";
type OutboundDelivery = Awaited<ReturnType<OutboundChannelAdapter["send"]>>;
// The Resend branch of the email adapter honours this signal; Gmail/SMTP seams take none, so the
// deadline below also races them. Never set on any other path.
type CommsEmailSendContext = OutboundSendContext & { abortSignal?: AbortSignal | null };

// read_comms_email_send_binding returns the binding (flat, like the invoice read) plus the
// message's tenant. A nested `comms_email_binding` object is accepted too. Anything malformed,
// or a tenant that is not the message row's own, is no binding at all.
function parseCommsEmailBinding(value: unknown, messageTenantId: string | null): CommsEmailBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as Record<string, unknown>;
  const v = (outer.comms_email_binding && typeof outer.comms_email_binding === "object"
    ? { ...(outer.comms_email_binding as Record<string, unknown>), message_tenant_id: outer.message_tenant_id ?? outer.tenant_id }
    : outer) as Record<string, unknown>;
  for (const key of ["operation_id", "tenant_id", "contact_id", "connector_id"]) {
    if (typeof v[key] !== "string" || !COMMS_EMAIL_UUID.test(v[key] as string)) return null;
  }
  if (!messageTenantId || v.tenant_id !== messageTenantId) return null;
  if (typeof v.message_tenant_id === "string" && v.message_tenant_id !== messageTenantId) return null;
  if (typeof v.recipient !== "string" || !/^\S+@\S+\.\S+$/.test(v.recipient) || v.recipient.length > 320) return null;
  if (typeof v.from_address !== "string" || !/^\S+@\S+\.\S+$/.test(v.from_address)) return null;
  if (v.provider !== "resend" && v.provider !== "gmail" && v.provider !== "smtp") return null;
  if (typeof v.subject !== "string" || !v.subject.trim() || v.subject.length > 200 || /[\r\n]/.test(v.subject)) return null;
  if (typeof v.body_html !== "string" || !v.body_html) return null;
  if (typeof v.state !== "string") return null;
  return {
    operation_id: v.operation_id as string, tenant_id: v.tenant_id as string,
    contact_id: v.contact_id as string, connector_id: v.connector_id as string,
    recipient: v.recipient, from_address: v.from_address, provider: v.provider,
    subject: v.subject, body_html: v.body_html, state: v.state,
  };
}

// Classify a comms_email provider attempt. `failed` is ONLY for an outcome where the provider
// provably did not take the message (never attempted, credentials unusable before any network
// send, or a definitive 4xx rejection). Anything that MIGHT have been accepted is `unknown`,
// because `failed` invites a fresh send and `unknown` forbids one.
function commsEmailDeliveryOutcome(
  attempted: boolean, delivery: OutboundDelivery | null, providerMessageId: string | null,
): { outcome: CommsEmailOutcome; reason: string | null } {
  if (!attempted) return { outcome: "failed", reason: "PROVIDER_NOT_ATTEMPTED" };
  if (!delivery) return { outcome: "unknown", reason: "PROVIDER_RESULT_UNCONFIRMED" }; // threw / deadline
  if (delivery.ok) {
    return providerMessageId
      ? { outcome: "provider_accepted", reason: null }
      : { outcome: "unknown", reason: "PROVIDER_RECEIPT_MISSING" };
  }
  const notSent = new Set([
    "gmail_requires_admin", "gmail_oauth_not_configured", "gmail_token_failed",
    "smtp_requires_admin", "smtp_not_configured", "smtp_creds_failed",
  ]);
  if (delivery.reason && notSent.has(delivery.reason)) return { outcome: "failed", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  if (!delivery.reason && delivery.error === "RESEND_API_KEY missing") return { outcome: "failed", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  // An SMTP exception may land after DATA was accepted; only the pre-socket host guard is definitive.
  if (delivery.reason === "smtp_send_failed") {
    return String(delivery.error ?? "").startsWith("smtp_send_failed:")
      ? { outcome: "unknown", reason: "PROVIDER_RESULT_UNCONFIRMED" }
      : { outcome: "failed", reason: "PROVIDER_REJECTED" };
  }
  const httpStatus = Number((delivery.meta as { http_status?: unknown } | undefined)?.http_status);
  if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 409 && httpStatus !== 429) {
    return { outcome: "failed", reason: "PROVIDER_REJECTED" };
  }
  return { outcome: "unknown", reason: "PROVIDER_RESULT_UNCONFIRMED" };
}

async function sendWithinCommsEmailDeadline(
  send: () => Promise<OutboundDelivery>, controller: AbortController,
): Promise<OutboundDelivery> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      send(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("comms_email_provider_deadline"));
        }, COMMS_EMAIL_PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const MAX_COMMS_ATTACHMENTS = 10;
const MAX_COMMS_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function normalizeRecipient(channel: SendBody["channel"], value: string | null | undefined): string {
  if (!value) return "";
  if (channel === "email") return value.trim().toLowerCase();
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

function attachmentValidationError(
  attachments: SendBody["attachments"],
  tenantId: string | null,
): string | null {
  if (!attachments) return null;
  if (!tenantId) return "attachment_tenant_unresolved";
  if (!Array.isArray(attachments) || attachments.length > MAX_COMMS_ATTACHMENTS) return "invalid_attachments";
  const prefix = `${tenantId}/`;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") return "invalid_attachment";
    if (typeof attachment.url !== "string" || !attachment.url.startsWith(prefix) ||
        attachment.url.length <= prefix.length || attachment.url.includes("..") ||
        attachment.url.includes("\\") || /^https?:\/\//i.test(attachment.url)) {
      return "attachment_not_tenant_owned";
    }
    if (attachment.name !== undefined && (typeof attachment.name !== "string" || attachment.name.length > 255)) return "invalid_attachment_name";
    if (attachment.mime !== undefined && (typeof attachment.mime !== "string" || attachment.mime.length > 255)) return "invalid_attachment_mime";
    if (attachment.size !== undefined &&
        (!Number.isFinite(attachment.size) || attachment.size < 0 || attachment.size > MAX_COMMS_ATTACHMENT_BYTES)) {
      return "invalid_attachment_size";
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// §32 — register the EMAIL outbound adapter (Resend) into the shared registry, then
// send THROUGH it. C-2..C-5 register sms/whatsapp/etc. against the same contract.
// -----------------------------------------------------------------------------
const emailOutboundAdapter: OutboundChannelAdapter = {
  channel_type: "email",
  // Email has no session window / template / quiet-hours constraints.
  getSendConstraints() {
    return null;
  },
  async send(msg: NormalizedMessage, ctx: OutboundSendContext) {
    // ── #141b: Gmail-vs-Resend dispatch INSIDE the email path (§18 — NOT a second
    //    'email' registry entry). When the connector's provider is 'gmail', send through
    //    the Gmail seam using the token resolved from its Vault ref; otherwise Resend. ──
    if (ctx.provider === "gmail") {
      // ctx.admin (OutboundAdminClient) is structurally { from, rpc } — identical to the
      // Gmail seam's SupabaseAdminLike (imported from twilio.ts, same shape), so it assigns.
      const admin = ctx.admin as unknown as SupabaseAdminLike | null | undefined;
      if (!admin) {
        return {
          ok: false, status: "failed" as const, needs_config: true, reason: "gmail_requires_admin",
          error: "gmail_requires_admin: no service-role client in context",
        };
      }
      const tok = await resolveGmailAccessToken(admin, ctx.credentialsVaultRef ?? null);
      if (!tok.ok || !tok.data) {
        return {
          ok: false, status: "failed" as const,
          needs_config: tok.needs_config === true,
          reason: tok.needs_config ? "gmail_oauth_not_configured" : "gmail_token_failed",
          error: tok.error ?? "gmail_token_failed",
        };
      }
      const sent = await gmailSend(tok.data.accessToken, {
        from: ctx.from.address,
        fromName: ctx.from.display_name ?? null,
        to: ctx.to,
        subject: msg.subject || "(no subject)",
        html: msg.body_html ?? null,
        text: msg.body_text ?? null,
        inReplyTo: msg.in_reply_to_provider_id ?? null,
        headers: buildListUnsubscribeHeaders(ctx.listUnsubscribeUrl),
        attachments: ctx.serverAttachments,
      });
      if (!sent.ok || !sent.data) {
        return {
          ok: false, status: "failed" as const,
          needs_config: sent.needs_config === true,
          reason: sent.needs_config ? "gmail_oauth_not_configured" : "gmail_send_failed",
          error: sent.error ?? "gmail_send_failed",
          // INT-328: the HTTP status (0 = no response) lets the comms_email path tell a definitive
          // rejection from an uncertain one. Additive; no other caller reads delivery.meta for email.
          meta: { http_status: sent.status },
        };
      }
      return { ok: true, status: "sent" as const, provider_message_id: sent.data.id };
    }

    // ── #141c: generic-SMTP dispatch INSIDE the email path (§18 — NOT a second 'email'
    //    registry entry). provider==='smtp' resolves {user,pass} from the connector's Vault
    //    ref and sends through the tenant's OWN SMTP host (host/port/secure from
    //    ctx.connectorConfig). SSRF host/port guard lives inside smtpSend. ──
    if (ctx.provider === "smtp") {
      const admin = ctx.admin as unknown as SupabaseAdminLike | null | undefined;
      if (!admin) {
        return {
          ok: false, status: "failed" as const, needs_config: true, reason: "smtp_requires_admin",
          error: "smtp_requires_admin: no service-role client in context",
        };
      }
      const creds = await resolveSmtpCreds(admin, ctx.credentialsVaultRef ?? null);
      if (!creds.ok || !creds.data) {
        return {
          ok: false, status: "failed" as const,
          needs_config: creds.needs_config === true,
          reason: creds.needs_config ? "smtp_not_configured" : "smtp_creds_failed",
          error: creds.error ?? "smtp_creds_failed",
        };
      }
      const cfg = (ctx.connectorConfig ?? {}) as { host?: unknown; port?: unknown; secure?: unknown };
      const host = typeof cfg.host === "string" ? cfg.host : "";
      const port = typeof cfg.port === "number" ? cfg.port : Number(cfg.port);
      const secure = typeof cfg.secure === "boolean" ? cfg.secure : undefined;
      if (!host || !Number.isFinite(port)) {
        return {
          ok: false, status: "failed" as const, needs_config: true, reason: "smtp_not_configured",
          error: "smtp_not_configured: connector config missing host/port",
        };
      }
      const sent = await smtpSend({
        host, port, secure: secure ?? null,
        user: creds.data.user, pass: creds.data.pass,
        from: ctx.from.address,
        fromName: ctx.from.display_name ?? null,
        to: ctx.to,
        subject: msg.subject || "(no subject)",
        html: msg.body_html ?? null,
        text: msg.body_text ?? null,
        inReplyTo: msg.in_reply_to_provider_id ?? null,
        headers: buildListUnsubscribeHeaders(ctx.listUnsubscribeUrl),
        attachments: ctx.serverAttachments,
      });
      if (!sent.ok) {
        return {
          ok: false, status: "failed" as const,
          needs_config: sent.needs_config === true,
          reason: sent.needs_config ? "smtp_not_configured" : "smtp_send_failed",
          error: sent.error ?? "smtp_send_failed",
        };
      }
      // §13: SMTP submission returns no durable id (data.messageId is honestly null); record
      // the send with a null provider_message_id rather than fabricating one.
      return { ok: true, status: "sent" as const, provider_message_id: sent.data?.messageId ?? null };
    }

    const resendKey = ctx.providerApiKey;
    if (!resendKey) {
      return { ok: false, status: "failed" as const, error: "RESEND_API_KEY missing" };
    }
    const name = ctx.from.display_name?.replace(/[<>",\r\n]/g, " ").replace(/\s+/g, " ").trim();
    const fromHeader = name ? `${name} <${ctx.from.address}>` : ctx.from.address;

    // List-Unsubscribe / List-Unsubscribe-Post (RFC 8058) whenever the dispatcher minted a one-click URL.
    const headers: Record<string, string> = { ...buildListUnsubscribeHeaders(ctx.listUnsubscribeUrl) };
    if (msg.in_reply_to_provider_id) headers["In-Reply-To"] = msg.in_reply_to_provider_id;

    // INT-328: only the comms_email path sets abortSignal; every other send's request is unchanged.
    const abortSignal = (ctx as CommsEmailSendContext).abortSignal ?? null;
    const res = await fetch("https://api.resend.com/emails", {
      ...(abortSignal ? { signal: abortSignal } : {}),
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        // A retried request with the same key is not sent twice by Resend.
        ...(ctx.idempotencyKey ? { "Idempotency-Key": ctx.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [ctx.to],
        reply_to: ctx.replyTo || undefined,
        subject: msg.subject || "(no subject)",
        html: msg.body_html || msg.body_text || "",
        headers: Object.keys(headers).length ? headers : undefined,
        attachments: ctx.serverAttachments?.map(a=>({filename:a.filename,content:a.content,content_type:a.contentType})),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: "failed" as const,
        error: `resend_${res.status}: ${JSON.stringify(json).slice(0, 300)}`,
        meta: { http_status: res.status }, // INT-328 additive (see the Gmail branch above)
      };
    }
    return { ok: true, status: "sent" as const, provider_message_id: json?.id ?? null };
  },
};
registerOutboundAdapter(emailOutboundAdapter);

// -----------------------------------------------------------------------------
// C-2a §18/§32 — register the SMS outbound adapter (per-tenant Twilio SUBaccount) into
// the SAME shared registry, then send THROUGH it. Replaces the inline Twilio branch that
// used platform master creds + paige_config.default_from_sms_number. This adapter:
//   • resolves the tenant's SUBaccount creds via the ONE authenticated seam
//     (resolveTwilioCreds → read_channel_secret on auth_token_vault_ref),
//   • requires the tenant's A2P registration to be 'approved' (NEVER a silent send),
//   • picks the tenant's OWN from-number from tenant_phone_numbers, scoped to the
//     caller's server-derived tenant (§9 RLS + the .eq('tenant_id', …) below are the
//     ONLY isolation — a number living under a tenant IS that tenant's to send from,
//     including the Super Admin's imported +1 470 200 3444, which is a legitimate
//     tenant_phone_numbers row (source='imported') on the master account, not a
//     reserved platform number (D2, C-2s-A). §13 NOTE: isolation is complete, but an
//     ACTUAL send from a source='imported' master-account number additionally requires
//     the tenant's tenant_twilio_subaccounts creds to map to the account that OWNS the
//     number (the master account for +1 470) — a LIVE setup step, not wired by C-2s-A,
//   • sends via sendSms with a per-message StatusCallback (DLR) URL,
//   • returns honest structured degrades (needs_config) — never a faked success (§13).
// -----------------------------------------------------------------------------
const SMS_MAX_LEN = 1600; // Twilio concatenated-segment ceiling (composer UX only).

interface TenantNumberRow {
  phone_number: string | null;
  status: string | null;
  is_primary: boolean | null;
  capabilities: Record<string, unknown> | null;
}
interface A2pRow {
  status: string | null;
  messaging_service_sid: string | null;
}

const smsOutboundAdapter: OutboundChannelAdapter = {
  channel_type: "sms",

  // Composer/Send-button constraints (§36). SMS has a length ceiling; quiet-hours +
  // consent are enforced server-side by the pre-send pipeline (steps 1–5), NOT here.
  getSendConstraints(thread) {
    return {
      mustUseTemplate: false,
      windowClosesAt: null,
      requiresHumanEdit: false,
      quietHoursTz: (thread.config?.quiet_hours_tz as string | undefined) ?? null,
      maxLength: SMS_MAX_LEN,
    };
  },

  async send(msg: NormalizedMessage, ctx: OutboundSendContext) {
    const admin = ctx.admin as SupabaseAdminLike | null | undefined;
    const tenantId = ctx.tenantId ?? null;

    // Guard: SMS is a tenant-owned rail (§9/§38). No admin client or no resolved tenant
    // => cannot resolve creds/number/A2P. Honest degrade, never a blind master-account send.
    if (!admin || !tenantId) {
      return {
        ok: false, status: "failed" as const, needs_config: true,
        reason: "sms_requires_tenant",
        error: "sms_requires_tenant: no service-role client / server-derived tenant in context",
      };
    }

    // 1) SUBaccount creds via the ONE authenticated seam (Vault-bridged auth token).
    const creds = await resolveTwilioCreds(admin, tenantId);
    if (!creds.ok || !creds.data) {
      return {
        ok: false, status: "failed" as const,
        needs_config: creds.needs_config === true,
        reason: creds.needs_config ? "twilio_subaccount_not_provisioned" : "twilio_creds_lookup_failed",
        error: creds.error ?? "twilio_subaccount_not_provisioned",
      };
    }
    // C-2a: apiKeySid (SK…) is the Basic-auth USERNAME under API-Key auth; subToken is the
    // API-Key SECRET (password). resolveTwilioCreds returns needs_config if api_key_sid is
    // null, so on this path apiKeySid is always present.
    const { accountSid: subaccountSid, authToken: subToken, apiKeySid: subApiKeySid } = creds.data;

    // 2) A2P 10DLC must be APPROVED for this tenant — else a specific failure, never a send.
    const { data: a2pData, error: a2pErr } = await admin
      .from("tenant_a2p_registrations")
      .select("status, messaging_service_sid")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (a2pErr) {
      return {
        ok: false, status: "failed" as const, reason: "a2p_lookup_failed",
        error: `a2p_lookup_failed: ${String((a2pErr as { message?: string })?.message ?? a2pErr).slice(0, 300)}`,
      };
    }
    const a2p = (a2pData ?? null) as A2pRow | null;
    if (!a2p || a2p.status !== "approved") {
      return {
        ok: false, status: "failed" as const, reason: "a2p_not_approved",
        error: `a2p_not_approved: tenant A2P registration status is '${a2p?.status ?? "none"}'`,
      };
    }
    const messagingServiceSid = a2p.messaging_service_sid || undefined;

    // 3) The tenant's OWN from-number. Isolation is the .eq('tenant_id', …) below +
    //    §9 RLS — the only from-numbers this tenant can send from are the ones that live
    //    under its own tenant_id. The Super Admin's imported +1 470 200 3444 is one such
    //    tenant_phone_numbers row (source='imported', on the master account), so it is a
    //    legitimate from-number candidate here, not an excluded reserved number (D2).
    //    §13: resolving it as a candidate is isolation-complete, but SENDING from a
    //    master-account imported number needs resolveTwilioCreds to yield creds that own
    //    it (the master account) — a LIVE setup step for the +1 470, gated in the plan.
    const { data: numData, error: numErr } = await admin
      .from("tenant_phone_numbers")
      .select("phone_number, status, is_primary, capabilities")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .order("purchased_at", { ascending: false, nullsFirst: false });
    if (numErr) {
      return {
        ok: false, status: "failed" as const, reason: "sms_number_lookup_failed",
        error: `sms_number_lookup_failed: ${String((numErr as { message?: string })?.message ?? numErr).slice(0, 300)}`,
      };
    }
    const rows = (numData ?? []) as TenantNumberRow[];
    const smsCapable = rows.filter(
      (r) =>
        r.phone_number &&
        (r.capabilities?.sms === undefined || r.capabilities?.sms === true),
    );
    const fromNumber = smsCapable[0]?.phone_number ?? null;
    if (!fromNumber) {
      return {
        ok: false, status: "failed" as const, needs_config: true, reason: "no_sms_number",
        error: "no_sms_number: tenant has no active SMS-capable phone number",
      };
    }

    // 4) Send via the ONE authenticated seam. Body is plain text for SMS.
    const bodyText = msg.body_text ?? msg.body_html ?? "";
    const result = await sendSms(subaccountSid, subToken, {
      from: fromNumber,
      to: ctx.to,
      body: bodyText,
      statusCallback: ctx.statusCallbackUrl ?? undefined,
      messagingServiceSid, // A2P Messaging Service takes precedence over From when present.
    }, subApiKeySid); // C-2a: SK… as the Basic-auth username (API-Key auth)
    if (!result.ok || !result.data) {
      return {
        ok: false, status: "failed" as const, reason: "twilio_send_failed",
        error: result.error ?? "twilio_send_failed", meta: { from_number: fromNumber },
      };
    }
    const sid = (result.data as { sid?: string }).sid ?? null;
    return {
      ok: true, status: "sent" as const, provider_message_id: sid,
      meta: { from_number: fromNumber, messaging_service_sid: messagingServiceSid ?? null },
    };
  },
};
registerOutboundAdapter(smsOutboundAdapter);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Caller identity from JWT (verify_jwt=true on this fn).
  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  // ── C-1.5: internal-caller branch. The scheduled-send drainer re-enters this fn under a
  //    service-role bearer to RELEASE a queued row (contract §4). A service-role bearer must
  //    skip the getUser + admin gate (there is no human user) AND the §9 caller-tenant
  //    gate (the queued row's own server-derived tenant_id is authoritative). Any OTHER caller
  //    still goes through the full JWT + role gate unchanged (§37 — legacy callers unaffected).
  const internalBearer = auth.replace(/^Bearer\s+/i, "").trim();
  const isInternal = internalBearer.length > 0 && internalBearer === serviceKey;

  let user: { id: string } | null = null;
  if (!isInternal) {
    const { data: { user: u } } = await userClient.auth.getUser();
    if (!u) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    user = u;
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: u.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let body: SendBody;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // ── INT-328 comms.email_send: a governed one-recipient business email is an immediate, single,
  //    attachment-free email of a PREPARED row, sent only by comms-email-command under the service
  //    role. It never rides marketing, the invoice binding, or the scheduler.
  const commsEmailRequested = body?.comms_email_operation_id !== undefined || body?.comms_email_reconcile !== undefined;
  if (commsEmailRequested) {
    if (typeof body.comms_email_operation_id !== "string" || !COMMS_EMAIL_UUID.test(body.comms_email_operation_id) ||
        (body.comms_email_reconcile !== undefined && typeof body.comms_email_reconcile !== "boolean") ||
        body.channel !== "email" || body.marketing !== undefined || body.scheduled_for !== undefined ||
        body.attachments !== undefined || body.invoice_delivery_operation_id !== undefined) {
      return new Response(JSON.stringify({ error: "comms_email_send_shape_invalid" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isInternal || typeof body.message_id !== "string" || !body.message_id) {
      return new Response(JSON.stringify({ error: "comms_email_binding_required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  // A marketing email is a fresh, immediate email send: never a scheduled row, never a release of a
  // stored draft (the generic drain re-sends those without the marketing guarantees below).
  if (body.marketing === true && (body.channel !== "email" || body.scheduled_for || body.message_id || body.invoice_delivery_operation_id)) {
    return new Response(JSON.stringify({ error: "marketing_send_shape_invalid" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body?.channel || !body?.to || !body?.body) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: config } = await admin.from("paige_config").select("*").eq("id", 1).maybeSingle();

  let pipe_used: "resend" | "twilio" = "resend";
  let vendor_message_id: string | null = null;
  let status: "sent" | "failed" = "failed";
  let errorText: string | null = null;
  let fromAddress: string | null = null;
  // ── C-2a additive (§37 / SEND-MESSAGE-CONTRACT §5) — the 6-way disposition lives in
  //    `outcome`; wire `status` stays sent|failed. The pre-send seam (below) early-returns
  //    for every block/queue case, so this send path only ever resolves sent|failed here. ──
  let outcome:
    | "sent" | "failed"
    | "blocked_client_dnd" | "blocked_suppressed" | "blocked_no_consent"
    | "queued_tenant_dnd" | "queued_quiet_hours" | "queued_scheduled" = "failed";
  let reason: string | null = null;

  // ── Resolve the tenant + connector + sender identity (§9/§38) BEFORE the send ──
  // Tenant is derived from known, tenant-scoped rows in priority order:
  //   1. the existing draft messages row (message_id), 2. the contact (contact_id),
  //   3. the connector (connector_id). Never from the request body directly.
  // Sender identity: tenant_sender_identity() RPC is PRIMARY (§38 tenant-owned);
  // the channel_connectors row (from_address/from_name/reply_to) is the fallback;
  // the platform default sender is the last resort. This never forks §38.
  let tenantId: string | null = null;
  let draftRow: { status?: string | null; connector_id?: string | null; contact_id?: string | null; thread_key?: string | null; channel_type?: string | null; meta?: Record<string, unknown> | null } | null = null;
  // The contact's workspace and every address it holds (its contact methods).
  let contactRow: { tenant_id?: string | null; emails: string[]; phones: string[] } | null = null;
  let connectorRow:
    | {
        tenant_id?: string | null; from_address?: string | null; from_name?: string | null;
        reply_to?: string | null; channel_type?: string | null; status?: string | null; active?: boolean | null;
        // #141b: provider decides Gmail-vs-Resend; credentials_vault_ref feeds the Gmail seam.
        provider?: string | null; credentials_vault_ref?: string | null; external_account_id?: string | null;
        // #141c: non-secret SMTP transport config (host/port/secure) for the provider==='smtp' path.
        config?: Record<string, unknown> | null;
      }
    | null = null;
  let replyTo: string | null = null;

  if (body.message_id) {
    const { data, error: messageError } = await admin
      .from("messages")
      .select("tenant_id, status, connector_id, contact_id, thread_key, channel_type, meta")
      .eq("id", body.message_id)
      .maybeSingle();
    if (messageError) {
      return new Response(JSON.stringify({ error: "message_lookup_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data) {
      return new Response(JSON.stringify({ error: "message_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (isInternal && !body.invoice_delivery_operation_id && !commsEmailRequested && data.status !== "queued") {
      return new Response(JSON.stringify({ error: "scheduled_message_not_releasable" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    draftRow = data;
    tenantId = data.tenant_id ?? null;
  }
  const terminalizeScheduledRelease = async (failure: string): Promise<Response> => {
    if (!isInternal || !body.message_id || !tenantId || draftRow?.status !== "queued") {
      return new Response(JSON.stringify({ error: failure }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: terminalized, error: terminalError } = await admin.from("messages")
      .update({ status: "failed", scheduled_for: null, error: failure })
      .eq("id", body.message_id)
      .eq("tenant_id", tenantId)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (terminalError) {
      return new Response(JSON.stringify({ error: "scheduled_release_terminalization_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      error: terminalized?.id ? failure : "scheduled_message_not_releasable",
      status: "failed",
      outcome: "failed",
      reason: "The scheduled message needs review before it can be sent.",
    }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  };
  if (draftRow?.contact_id && body.contact_id && body.contact_id !== draftRow.contact_id) {
    return new Response(JSON.stringify({ error: "contact_override_forbidden" }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (draftRow?.thread_key && body.thread_key && body.thread_key !== draftRow.thread_key) {
    return new Response(JSON.stringify({ error: "thread_override_forbidden" }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const effectiveContactId = draftRow?.contact_id ?? body.contact_id ?? null;
  const effectiveConnectorId = body.connector_id ?? draftRow?.connector_id ?? null;
  let invoiceBinding: DeliveryBinding | null = null;
  let invoiceDispatchClaimed = false;
  let invoiceProviderAttempted = false;
  const finalizeInvoice = async (result: "provider_accepted" | "unknown" | "failed", providerId: string | null = null) => {
    if (!invoiceBinding) return null;
    const { data, error } = await admin.rpc("finalize_sales_invoice_delivery", { _message_id: invoiceBinding.message_id, _operation_id: invoiceBinding.operation_id, _outcome: result, _provider_message_id: providerId, _reason: null });
    return !error && data && typeof data === "object" ? data : null;
  };
  // Invoice messages cannot be sent as ordinary editable drafts or released by a scheduler.
  if (body.invoice_delivery_operation_id || draftRow?.meta?.sales_invoice_binding) {
    if (!isInternal || !body.message_id || !body.invoice_delivery_operation_id || body.scheduled_for || !["email","sms"].includes(body.channel)) return new Response(JSON.stringify({ error: "invoice_delivery_binding_required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data, error } = await admin.rpc("read_sales_invoice_delivery_binding", { _message_id: body.message_id });
    invoiceBinding = !error ? parseDeliveryBinding(data, tenantId ?? "", body.message_id) : null;
    if (!invoiceBinding || invoiceBinding.operation_id !== body.invoice_delivery_operation_id || (invoiceBinding.channel ?? "email") !== body.channel || effectiveContactId !== invoiceBinding.client_id || effectiveConnectorId !== invoiceBinding.connector_id || body.to !== invoiceBinding.recipient || body.subject !== invoiceBinding.subject || body.body !== invoiceBinding.body_html) return new Response(JSON.stringify({ error: "invoice_delivery_binding_invalid" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (invoiceBinding) {
    const { data: invoiceFacts, error: factsError } = await admin.rpc("_sales_invoice_read", { _tenant: tenantId, _invoice: invoiceBinding.invoice_id });
    const readiness = !factsError ? await readInvoiceDeliveryReadiness(admin as unknown as InvoiceReadinessAdmin, { tenantId: tenantId!, invoice: invoiceFacts, channel: body.channel === "sms" ? "sms" : "email", connectorId: effectiveConnectorId }, key => Deno.env.get(key)) : null;
    if (!readiness?.eligible) return new Response(JSON.stringify({ok:false,outcome:"prepared",code:readiness?.reason ?? "DELIVERY_READINESS_UNVERIFIED"}), {status:422,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
  // ── INT-328 comms.email_send binding. A prepared governed email is never an ordinary editable
  //    draft: it is sent only with its operation id, and only exactly as prepared.
  let commsBinding: CommsEmailBinding | null = null;
  const commsReconcile = body.comms_email_reconcile === true;
  let commsDispatchClaimed = false;
  // The attempt number THIS request's claim returned. finalize_comms_email_send accepts a
  // 'dispatching' outcome only from the attempt holding the claim; null = this request never claimed.
  let commsClaimedAttempt: number | null = null;
  let commsProviderAttempted = false;
  let commsDelivery: OutboundDelivery | null = null;
  let commsBindingEligible = false;
  if (commsEmailRequested || draftRow?.meta?.comms_email_binding) {
    if (!commsEmailRequested || !isInternal || !body.message_id) {
      return new Response(JSON.stringify({ error: "comms_email_binding_required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data, error } = await admin.rpc("read_comms_email_send_binding", { _message_id: body.message_id });
    const parsed = !error ? parseCommsEmailBinding(data, tenantId) : null;
    if (!parsed || parsed.operation_id !== body.comms_email_operation_id || draftRow?.channel_type !== "email" ||
        body.channel !== "email" || effectiveContactId !== parsed.contact_id || effectiveConnectorId !== parsed.connector_id ||
        draftRow?.contact_id !== parsed.contact_id || draftRow?.connector_id !== parsed.connector_id ||
        body.to !== parsed.recipient || body.subject !== parsed.subject || body.body !== parsed.body_html) {
      return new Response(JSON.stringify({ error: "comms_email_binding_invalid" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    commsBinding = parsed;
    // The read RPC's own whole-row check (message, connector, contact method all still as prepared).
    commsBindingEligible = (data as { eligible?: unknown }).eligible === true;
  }
  // The single comms_email response shape. Provider ids, error text, keys and headers never appear.
  const commsEmailResponse = (outcome: CommsEmailOutcome | "outcome_unknown", reason: string | null, extra: Record<string, unknown> = {}, httpStatus = 200): Response =>
    new Response(JSON.stringify({
      ok: outcome === "provider_accepted", outcome, ...(reason ? { reason } : {}),
      message_id: body.message_id ?? null, delivery_confirmed: false, ...extra,
    }), { status: httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const finalizeCommsEmail = async (outcome: CommsEmailOutcome, providerId: string | null, reason: string | null) => {
    if (!commsBinding) return null;
    const { data, error } = await admin.rpc("finalize_comms_email_send", {
      _message_id: body.message_id, _operation_id: commsBinding.operation_id,
      // The binding keeps only lowercase code-shaped reasons (finalize_comms_email_send).
      _outcome: outcome, _provider_message_id: providerId, _reason: reason ? reason.toLowerCase() : null,
      _claimed_attempt: commsClaimedAttempt,
    });
    return !error && data && typeof data === "object" ? data : null;
  };
  // Refuse BEFORE any claim: finalize 'refused' from 'prepared'. A reconcile is re-entering an
  // operation that may already have gone out — it is never re-finalized as refused; it stays
  // unknown for a human, and nothing is sent.
  // An unclaimed request may only finalize an operation still 'prepared'. One another attempt is
  // dispatching (or that already has an outcome) belongs to that attempt: this request reports
  // outcome_unknown and writes nothing — it never turns a possibly-sent email into "Not sent".
  // finalize_comms_email_send enforces the same rule in the database (the read is only a snapshot).
  const unclaimedMayFinalize = (): boolean => commsClaimedAttempt === null && commsBinding?.state === "prepared";
  const refuseCommsEmail = async (reason: string): Promise<Response> => {
    if (commsReconcile) {
      return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" }, 409);
    }
    if (!unclaimedMayFinalize()) return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_NOT_CLAIMABLE" }, 409);
    const receipt = await finalizeCommsEmail("refused", null, reason);
    return commsEmailResponse(receipt ? "refused" : "outcome_unknown", reason);
  };
  // INT-328: a governed email row that is no longer a draft has a recorded outcome (or one in
  // flight); it is never re-sent here and never answered with the generic "deduped: sent".
  if (commsBinding && draftRow?.status !== "draft") {
    return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_NOT_CLAIMABLE" }, 409);
  }
  const scheduledBinding = draftRow?.meta?.scheduled_binding as Record<string, unknown> | undefined;
  if (isInternal && draftRow?.status === "queued") {
    if (!scheduledBinding || (typeof scheduledBinding.contact_id !== "string" && typeof scheduledBinding.connector_id !== "string")) {
      return await terminalizeScheduledRelease("scheduled_binding_unavailable");
    }
    if (typeof scheduledBinding?.contact_id === "string" && !effectiveContactId) {
      return await terminalizeScheduledRelease("scheduled_contact_unavailable");
    }
    if (typeof scheduledBinding?.contact_id === "string" && effectiveContactId !== scheduledBinding.contact_id) {
      return await terminalizeScheduledRelease("scheduled_contact_changed");
    }
    if (typeof scheduledBinding?.connector_id === "string" && !effectiveConnectorId) {
      return await terminalizeScheduledRelease("scheduled_connector_unavailable");
    }
    if (typeof scheduledBinding?.connector_id === "string" && effectiveConnectorId !== scheduledBinding.connector_id) {
      return await terminalizeScheduledRelease("scheduled_connector_changed");
    }
  }

  if (effectiveContactId) {
    const { data, error: contactError } = await admin
      .from("clients")
      .select(`tenant_id, ${CLIENT_CONTACT_METHODS_EMBED}`)
      .eq("id", effectiveContactId)
      .maybeSingle();
    if (contactError) {
      return new Response(JSON.stringify({ error: "contact_lookup_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    contactRow = data
      ? { tenant_id: (data as { tenant_id?: string | null }).tenant_id ?? null, ...clientAddresses(data) }
      : null;
    if (!contactRow) {
      if (isInternal && draftRow?.status === "queued") return await terminalizeScheduledRelease("scheduled_contact_unavailable");
      return new Response(JSON.stringify({ error: "contact_not_found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tenantId && contactRow.tenant_id !== tenantId) {
      return new Response(JSON.stringify({ error: "forbidden_cross_tenant_contact" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    tenantId = contactRow.tenant_id ?? null;
  }
  // §49 one-thread-per-contact: when both the contact and tenant are known, the canonical key is
  // per-CONTACT so every channel's messages coalesce into ONE thread. The `${channel}:${to}` /
  // `email:${to}` / `sms:${to}` tails below remain only for a genuinely contactless raw-`to` send.
  // INVARIANT: this is computed AFTER the contact→tenant resolution above (L471-477), so whenever
  // effectiveContactId is set, tenantId is non-null and the per-contact key is well-formed. Keep this
  // line below that block if it is ever reordered.
  const perContactKey = effectiveContactId && tenantId ? `contact:${tenantId}:${effectiveContactId}` : null;
  if (effectiveConnectorId) {
    const { data, error: connectorError } = await admin
      .from("channel_connectors")
      // #141b: widened to carry provider + credentials_vault_ref + external_account_id so the
      // email path can route a Gmail connector through the Gmail seam (else Resend).
      // #141c: + config (jsonb host/port/secure) so the provider==='smtp' path can send through
      // the tenant's own SMTP host. Additive (§37) — Resend/Gmail callers ignore the extra column.
      .select("tenant_id, from_address, from_name, reply_to, channel_type, status, active, provider, credentials_vault_ref, external_account_id, config")
      .eq("id", effectiveConnectorId)
      .maybeSingle();
    if (connectorError) {
      return new Response(JSON.stringify({ error: "connector_lookup_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    connectorRow = data ?? null;
    if (!connectorRow) {
      if (isInternal && draftRow?.status === "queued") return await terminalizeScheduledRelease("scheduled_connector_unavailable");
      return new Response(JSON.stringify({ error: "connector_not_found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (connectorRow.active !== true || connectorRow.status !== "active") {
      if (isInternal && draftRow?.status === "queued") return await terminalizeScheduledRelease("scheduled_connector_unavailable");
      return new Response(JSON.stringify({ error: "connector_not_active" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (connectorRow.channel_type !== body.channel) {
      if (isInternal && draftRow?.status === "queued") return await terminalizeScheduledRelease("scheduled_connector_changed");
      return new Response(JSON.stringify({ error: "connector_channel_mismatch" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body.message_id && body.connector_id && draftRow?.connector_id && body.connector_id !== draftRow.connector_id) {
      return new Response(JSON.stringify({ error: "connector_override_forbidden" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!tenantId) tenantId = connectorRow.tenant_id ?? null;
  }

  // ── §9 caller-tenant gate — BEFORE any send ──────────────────────────────────
  // tenantId above is resolved from body-referenced rows via the SERVICE-ROLE client
  // (RLS bypassed), and has_role (L116-118) is GLOBAL — so without this bind a
  // tenant-A admin could pass a tenant-B message_id / contact_id / connector_id
  // and send UNDER TENANT B's verified sender identity (tenant_sender_identity below)
  // and write into B's inbox. Require the resolved tenant to equal the caller's own
  // (JWT-scoped current_user_tenant_id); the platform owner (God) may act cross-tenant
  // (§17). This is the same gate the comms.outbound rail block already applies — hoisted
  // to cover the actual SEND, not just telemetry.
  // The internal drainer (isInternal) is exempt: callerTenant/isOwner resolve to null/false
  // under a service-role bearer, and the queued row's own server-derived tenant_id (from
  // message_id) is authoritative. Every OTHER caller keeps the full §9 bind unchanged.
  const { data: callerTenant } = isInternal ? { data: null } : await userClient.rpc("current_user_tenant_id");
  const { data: isOwner } = isInternal ? { data: false } : await userClient.rpc("is_platform_owner");
  if (!isInternal && tenantId && !isOwner && tenantId !== callerTenant) {
    return new Response(JSON.stringify({ error: "forbidden_cross_tenant" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Pin a context-free send (no tenant-bearing ref) to the caller's own tenant so its
  // sender identity is the caller's — never a blank that widens. A platform owner with
  // no active tenant keeps null → platform default sender. (Internal drain: tenant stays
  // the queued row's own.)
  if (!isInternal && !tenantId && !isOwner) tenantId = callerTenant ?? null;

  // Server-owned execution floor applies independently of approvals, active connectors,
  // sender fallback and the service-role queue/retry caller. No provider or schedule admission.
  if (!await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: user?.id ?? null })) {
    if (commsBinding) return await refuseCommsEmail(COMMS_PROVIDER_EXECUTION_DISABLED);
    if (isInternal && draftRow?.status === "queued") return await terminalizeScheduledRelease(COMMS_PROVIDER_EXECUTION_DISABLED);
    if (body.message_id && tenantId) {
      const { error } = await admin.from("messages").update({ status: "blocked", scheduled_for: null }).eq("id", body.message_id).eq("tenant_id", tenantId);
      if (error) return new Response(JSON.stringify({ status: "failed", outcome: "outcome_unknown", error: "boundary_readback_failed" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ status: "blocked", outcome: "refused", error: COMMS_PROVIDER_EXECUTION_DISABLED }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── §9 (#141b): bind the CONNECTOR to the resolved tenant ────────────────────
  // connectorRow was fetched via the SERVICE-ROLE admin client (RLS bypassed) keyed by
  // effectiveConnectorId — which can come straight from body.connector_id (L408). The
  // caller-tenant gate above only binds the RESOLVED tenantId (from message_id/contact_id),
  // and that never moves to the connector's own tenant. Without this bind, a tenant-A
  // caller could pass their A-owned contact_id + a tenant-B connector_id and, for a Gmail
  // connector, make send-message read tenant B's Vault REFRESH TOKEN and email AS tenant B's
  // authenticated Gmail identity (L641 force-sets senderEmail = connectorRow.from_address).
  // Require the connector to belong to the resolved tenant; the platform owner (§17) may act
  // cross-tenant. Internal drain: isOwner=false, tenantId is the queued row's own, and a
  // legit queued row's connector shares that tenant — so a mismatch is correctly rejected.
  if (connectorRow && tenantId && connectorRow.tenant_id !== tenantId) {
    return new Response(JSON.stringify({ error: "forbidden_cross_tenant_connector" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── QA #1832: the synthetic-workspace no-provider-execution boundary ──────────
  // Server-side, fail-closed at the marker (tenants.features.qa_no_provider_execution):
  // a synthetic QA workspace cannot cause a real provider effect through ANY path that
  // enters this ONE rail — direct sends, the governed comms-email executor, marketing
  // dispatch, the scheduled drainer's queued releases, and every retry that re-enters.
  // A queued synthetic row TERMINALIZES (failed) instead of requeueing forever. An
  // existing draft/provisioned connector does not bypass: the refusal precedes every
  // provider call below. Ordinary tenants answer false and are unchanged.
  if (tenantId && await providerExecutionBlocked(admin as never, tenantId)) {
    if (isInternal && body.message_id && draftRow?.status === "queued") {
      return await terminalizeScheduledRelease(QA_NO_PROVIDER_EXECUTION_CODE);
    }
    if (body.message_id && draftRow && draftRow.status !== "failed") {
      await admin.from("messages").update({ status: "failed", error: QA_NO_PROVIDER_EXECUTION_CODE })
        .eq("id", body.message_id).eq("tenant_id", tenantId);
    }
    return new Response(JSON.stringify({ error: QA_NO_PROVIDER_EXECUTION_CODE, note: QA_BOUNDARY_REFUSAL_NOTE }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // INT-328: the approved sender is the prepared one. A connector whose address or provider moved
  // after approval is a different sender — refuse rather than send as someone else.
  if (commsBinding && (!connectorRow?.from_address ||
      connectorRow.from_address.trim().toLowerCase() !== commsBinding.from_address.trim().toLowerCase() ||
      connectorRow.provider !== commsBinding.provider)) {
    return await refuseCommsEmail("SENDER_CHANGED");
  }

  if (effectiveContactId) {
    // The recipient must be one of the contact's own addresses for this channel — any of them,
    // not only the primary: a person reached at their second address is still that person.
    const contactAddresses = (body.channel === "email" ? contactRow?.emails : contactRow?.phones) ?? [];
    const recipient = normalizeRecipient(body.channel, body.to);
    const recipientBelongsToContact = recipient !== "" &&
      contactAddresses.some((address) => normalizeRecipient(body.channel, address) === recipient);
    if (!recipientBelongsToContact && commsBinding) return await refuseCommsEmail("RECIPIENT_CHANGED");
    if (!recipientBelongsToContact && !invoiceBinding) {
      if (isInternal && body.message_id && tenantId) {
        // A scheduled row keeps the exact recipient approved when it was queued. If the
        // canonical People address changes before release, never retarget silently and never
        // leave the row queued for endless retries: surface one terminal failure for review.
        return await terminalizeScheduledRelease("recipient_contact_mismatch");
      }
      return new Response(JSON.stringify({ error: "recipient_contact_mismatch" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  const attachmentError = attachmentValidationError(body.attachments, tenantId);
  if (attachmentError) {
    return new Response(JSON.stringify({ error: attachmentError }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── §5 double-submit guard ───────────────────────────────────────────────────
  // Approving an already sent/queued draft (second tab, stale realtime, network retry)
  // must NOT re-fire the provider — each provider send mints a fresh provider_message_id
  // so the unique index cannot dedupe a true double-delivery. Short-circuit idempotently.
  // C-1.5: a `queued` row is only a double-submit for a NON-internal re-approve; the internal
  // drainer (isInternal) is RELEASING that queued row and must proceed to the pipeline+send.
  // A genuinely `sent` row always dedupes (no double-delivery), internal or not.
  if (body.message_id && body.scheduled_for && !isInternal && draftRow?.status !== "draft") {
    return new Response(JSON.stringify({
      error: "scheduled_message_not_replaceable",
      status: "failed",
      outcome: "failed",
      reason: "The canceled draft changed before it could be queued. Review it and send again.",
      message_id: null,
      scheduled_for: null,
    }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (body.message_id && draftRow &&
      (draftRow.status === "sent" ||
       (draftRow.status === "queued" && !isInternal && !body.scheduled_for))) {
    return new Response(
      JSON.stringify({ status: "sent", message_id: body.message_id, deduped: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // INT-328: anything else the read RPC found changed since approval (e.g. the contact method was
  // removed) — the canonical claim would refuse it anyway; refuse it here so the row is finalized.
  if (commsBinding && !commsBindingEligible) return await refuseCommsEmail("SEND_NO_LONGER_ELIGIBLE");
  // INT-328: no exact workspace = no send. tenantId is re-derived above from the contact and connector
  // rows; the pre-send (suppression / DND) read below must run against the binding's own workspace and
  // nothing else, so any disagreement refuses before claim or provider admission.
  if (commsBinding && tenantId !== commsBinding.tenant_id) return await refuseCommsEmail("WORKSPACE_CHANGED");

  // ── >>> PRE-SEND PIPELINE SEAM <<< (SEND-MESSAGE-CONTRACT §3 steps 1–5) ──────────
  // Runs the LOCKED compliance order after §9 tenant derivation + the §5 dedupe guard,
  // BEFORE any provider call. A block/queue disposition writes the messages row in its
  // TERMINAL state (blocked|queued) with meta.pre_send and RETURNS 200 (provider never
  // called). 'proceed' falls through to the existing try{} send. 'error' fails CLOSED.
  {
    // ── C-1.5 scheduled-send (the "6th gate flavor", contract §4) — runs BEFORE steps 1–5.
    //    A FRESH future schedule (non-internal) writes the row status='queued' + scheduled_for
    //    and returns WITHOUT calling the provider. The drainer re-enters with scheduled_for
    //    OMITTED, so this branch is skipped on release and the full pipeline runs. Legacy
    //    callers never send scheduled_for, so they never see this (§37).
    if (!isInternal && body.scheduled_for) {
      const whenMs = Date.parse(body.scheduled_for);
      if (Number.isFinite(whenMs) && whenMs > Date.now()) {
        const schedIso = new Date(whenMs).toISOString();
        const schedMeta = {
          source: "send-message",
          pre_send: { step: "scheduled", outcome: "queued_scheduled" },
          scheduled_binding: { contact_id: effectiveContactId, connector_id: effectiveConnectorId },
        };
        let schedRowId: string | null = null;
        try {
          if (body.message_id) {
            // An Undo converts the queued row back to a draft. Requeueing that draft must
            // atomically replace the complete delivery payload; changing only its timer would
            // let the drainer release the canceled, pre-edit content. The guarded transition
            // also makes concurrent/stale requeues lose instead of acknowledging a false queue.
            const { data: patched, error: patchError } = await admin.from("messages").update({
              thread_key: body.thread_key || draftRow?.thread_key || perContactKey || `${body.channel}:${body.to}`,
              contact_id: effectiveContactId,
              connector_id: effectiveConnectorId,
              channel_type: body.channel,
              direction: "outbound",
              status: "queued",
              scheduled_for: schedIso,
              recipients: [{ address: body.to }],
              subject: body.subject ?? null,
              body_html: body.channel === "email" ? body.body : null,
              body_text: body.channel === "email" ? null : body.body,
              attachments: body.attachments ?? [],
              provider_message_id: null,
              sent_at: null,
              meta: schedMeta,
              error: null,
            })
              .eq("id", body.message_id)
              .eq("tenant_id", tenantId)
              .eq("status", "draft")
              .is("scheduled_for", null)
              .select("id")
              .maybeSingle();
            if (patchError) throw patchError;
            if (!patched?.id) {
              return new Response(JSON.stringify({
                error: "scheduled_message_not_replaceable",
                status: "failed",
                outcome: "failed",
                reason: "The canceled draft changed before it could be queued. Review it and send again.",
                message_id: null,
                scheduled_for: null,
              }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            schedRowId = patched.id;
          } else if (effectiveContactId || effectiveConnectorId) {
            const { data: inserted, error: insertError } = await admin.from("messages").insert({
              thread_key: body.thread_key || draftRow?.thread_key || perContactKey || `${body.channel}:${body.to}`,
              contact_id: effectiveContactId, connector_id: effectiveConnectorId,
              channel_type: body.channel, direction: "outbound",
              status: "queued", scheduled_for: schedIso,
              recipients: [{ address: body.to }], subject: body.subject ?? null,
              body_html: body.channel === "email" ? body.body : null,
              body_text: body.channel === "email" ? null : body.body,
              attachments: body.attachments ?? [],
              meta: schedMeta,
            }).select("id").maybeSingle();
            if (insertError) throw insertError;
            schedRowId = inserted?.id ?? null;
          }
        } catch (e) {
          console.warn("[send-message] scheduled row write failed:", (e as Error)?.message);
          return new Response(JSON.stringify({
            error: "scheduled_message_write_failed",
            status: "failed",
            outcome: "failed",
            reason: "The message could not be queued. Review it and try again.",
            message_id: null,
            scheduled_for: null,
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (!schedRowId) {
          return new Response(JSON.stringify({
            error: "scheduled_message_not_persisted",
            status: "failed",
            outcome: "failed",
            reason: "The message could not be queued. Review it and try again.",
            message_id: null,
            scheduled_for: null,
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          audit_id: null, vendor_message_id: null,
          pipe_used: body.channel === "sms" ? "twilio" : "resend",
          status: "sent",          // §37: accepted, no hard error; true disposition in `outcome`
          error: null, message_id: schedRowId,
          outcome: "queued_scheduled", reason: null, scheduled_for: schedIso,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const preSend = await runPreSend(admin, {
      tenantId,
      channel: body.channel,
      to: body.to,
      contactId: effectiveContactId,
      overrideClientDnd: body.override_client_dnd === true,
    });

    if (!preSend.proceed) {
      // A marketing email the pre-send checks would QUEUE (quiet hours, a hold) is not queued: a queued
      // row is later released by the generic drain without the unsubscribe link, idempotency key or
      // daily ceiling. Nothing is written; the caller defers the recipient until `scheduled_for`.
      if (body.marketing === true && preSend.outcome !== "error" && !preSend.outcome.startsWith("blocked")) {
        return new Response(JSON.stringify({
          status: "failed", error: null, message_id: null,
          outcome: preSend.outcome, reason: preSend.reason, scheduled_for: preSend.queueUntil ?? null, deferred: true,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // INT-328: a governed email is never queued or scheduled. A block AND a queue disposition both
      // finalize 'refused' with the pre-send outcome as the reason; a fail-closed check error is a
      // not-attempted failure. Nothing is written to the row here — finalize owns it.
      if (commsBinding) {
        if (preSend.outcome === "error") {
          if (commsReconcile) return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" }, 409);
          if (!unclaimedMayFinalize()) return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_NOT_CLAIMABLE" }, 409);
          const receipt = await finalizeCommsEmail("failed", null, "PRE_SEND_UNVERIFIED");
          return commsEmailResponse(receipt ? "failed" : "outcome_unknown", "PRE_SEND_UNVERIFIED");
        }
        return await refuseCommsEmail(preSend.outcome);
      }
      if (invoiceBinding) {
        const receipt = await finalizeInvoice("failed");
        return new Response(JSON.stringify({ status: "failed", outcome: receipt ? "failed" : "outcome_unknown", error: "invoice_delivery_held", reason: "Invoice delivery cannot be queued. Review message preferences and try an explicitly approved operation later.", message_id: invoiceBinding.message_id, scheduled_for: null }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const gatedPipe: "resend" | "twilio" = body.channel === "sms" ? "twilio" : "resend";

      // 'error' = a LEGAL gate (suppression/consent) DB read failed → §13 fail closed.
      // Recorded as a genuine failure (status:'failed', error set), NOT a policy hold.
      if (preSend.outcome === "error") {
        if (body.message_id) {
          await admin.from("messages")
            .update({ status: "failed", error: preSend.reason })
            .eq("id", body.message_id);
        }
        const { data: eAudit } = await admin.from("paige_messages_audit").insert({
          channel: body.channel, pipe_used: gatedPipe, to_address: body.to,
          from_address: null, subject: body.subject, body: body.body,
          status: "failed", vendor_message_id: null, error: preSend.reason,
          contact_id: body.contact_id ?? null,
          conversation_id: body.conversation_id ?? null, sent_at: null,
        }).select("id").maybeSingle();
        return new Response(JSON.stringify({
          audit_id: eAudit?.id, vendor_message_id: null, pipe_used: gatedPipe,
          status: "failed", error: preSend.reason, message_id: body.message_id ?? null,
          outcome: "failed", reason: preSend.reason, scheduled_for: null,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // blocked_* → terminal 'blocked'; queued_* → terminal 'queued' + scheduled_for.
      const terminalStatus = preSend.outcome.startsWith("blocked") ? "blocked" : "queued";
      const preSendMeta = {
        source: "send-message",
        pre_send: { step: preSend.outcome, reason: preSend.reason },
        scheduled_binding: scheduledBinding ?? { contact_id: effectiveContactId, connector_id: effectiveConnectorId },
      };

      // Terminal messages row. tenant_id is derived by set_message_tenant() from
      // connector_id → contact_id (§9). A contactless raw-`to` send (neither present)
      // cannot derive a tenant through the service-role client, so we skip the inbox row
      // for that rare case (the disposition is still in paige_messages_audit + response).
      let preMessageRowId: string | null = null;
      try {
        if (body.message_id) {
          const { data: patched, error: patchError } = await admin.from("messages").update({
            status: terminalStatus, scheduled_for: preSend.queueUntil,
            meta: preSendMeta, error: null,
          }).eq("id", body.message_id).select("id").maybeSingle();
          if (patchError) throw patchError;
          if (!patched?.id) throw new Error("pre_send_message_not_persisted");
          preMessageRowId = patched.id;
        } else if (effectiveContactId || effectiveConnectorId) {
          const { data: inserted, error: insertError } = await admin.from("messages").insert({
            thread_key: body.thread_key || draftRow?.thread_key || perContactKey || `${body.channel}:${body.to}`,
            contact_id: effectiveContactId, connector_id: effectiveConnectorId,
            channel_type: body.channel, direction: "outbound",
            status: terminalStatus, scheduled_for: preSend.queueUntil,
            recipients: [{ address: body.to }], subject: body.subject ?? null,
            body_html: body.channel === "email" ? body.body : null,
            body_text: body.channel === "email" ? null : body.body,
            meta: preSendMeta,
          }).select("id").maybeSingle();
          if (insertError) throw insertError;
          if (!inserted?.id) throw new Error("pre_send_message_not_persisted");
          preMessageRowId = inserted?.id ?? null;
        }
      } catch (e) {
        console.warn("[send-message] pre-send terminal row write failed:", (e as Error)?.message);
        return new Response(JSON.stringify({
          error: "pre_send_state_write_failed",
          status: "failed",
          outcome: "failed",
          reason: "The message state could not be saved. Review it and try again.",
          message_id: null,
          scheduled_for: null,
        }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Legacy audit: a non-send is 'failed' in paige_messages_audit's enum (predates the
      // 6-way outcome). error stays NULL for a policy hold (not a failure); reason carries it.
      const { data: gAudit } = await admin.from("paige_messages_audit").insert({
        channel: body.channel, pipe_used: gatedPipe, to_address: body.to,
        from_address: null, subject: body.subject, body: body.body,
        status: "failed", vendor_message_id: null, error: null,
        contact_id: body.contact_id ?? null,
        conversation_id: body.conversation_id ?? null, sent_at: null,
      }).select("id").maybeSingle();

      return new Response(JSON.stringify({
        audit_id: gAudit?.id, vendor_message_id: null, pipe_used: gatedPipe,
        status: "failed",           // §37: never a new status value; disposition is in `outcome`
        error: null, message_id: preMessageRowId,
        outcome: preSend.outcome, reason: preSend.reason,
        scheduled_for: preSend.queueUntil,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  try {
    if (body.channel === "email") {
      // #141b: a Gmail connector sends via the Gmail seam (its own OAuth creds), so it does
      // NOT need RESEND_API_KEY. #141c: an SMTP connector sends via the tenant's own SMTP host,
      // also NOT needing RESEND_API_KEY. Only the Resend path requires it.
      const isGmail = connectorRow?.provider === "gmail";
      const isSmtp = connectorRow?.provider === "smtp";
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey && !isGmail && !isSmtp) throw new Error("RESEND_API_KEY missing");

      // §38 PRIMARY: tenant-owned sender identity via the shared RPC (service role =>
      // auth.uid() NULL => trusted cross-tenant resolve of the passed tenant).
      let senderName: string | null = null;
      let senderEmail: string | null = null;
      const { data: ident } = await admin.rpc("tenant_sender_identity", { _tenant_id: tenantId });
      const identRow = (ident ?? null) as
        | { from_name?: string | null; from_address?: string | null; reply_to?: string | null }
        | null;
      if (identRow) {
        senderName = identRow.from_name ?? null;
        senderEmail = identRow.from_address ?? null;
        replyTo = identRow.reply_to ?? null;
      }
      // An explicitly selected, active, tenant-bound connector is authoritative for
      // every provider (managed/custom Resend, Gmail, and SMTP). The shared identity
      // remains the fallback only for legacy connectorless sends.
      if (connectorRow?.from_address) {
        senderEmail = connectorRow.from_address;
        senderName = connectorRow.from_name || senderName;
        replyTo = connectorRow.reply_to || replyTo;
      }
      senderName = senderName || config?.default_from_name || "Paige Agent";
      // Last-resort fallback on the verified shared sending subdomain.
      const resolvedSenderEmail = senderEmail || config?.default_from_email || "no-reply@mail.paigeagent.ai";
      senderEmail = resolvedSenderEmail;
      fromAddress = senderName ? `${senderName} <${resolvedSenderEmail}>` : resolvedSenderEmail;

      // §32 — build the NormalizedMessage and send THROUGH the registry adapter.
      const adapter = getOutboundAdapter("email");
      if (!adapter) throw new Error("no_email_adapter_registered");
      const outMsg: NormalizedMessage = {
        thread_key: body.thread_key || draftRow?.thread_key || perContactKey || `email:${body.to}`,
        channel_type: "email",
        direction: "outbound",
        status: "queued",
        contact_id: effectiveContactId,
        connector_id: effectiveConnectorId,
        sender: { address: resolvedSenderEmail, display_name: senderName ?? undefined },
        recipients: [{ address: body.to }],
        subject: body.subject ?? null,
        body_html: body.body,
        in_reply_to_provider_id: body.in_reply_to ?? null,
      };
      // C-2s-C: mint a per-recipient one-click unsubscribe token so this email carries a
      // List-Unsubscribe / List-Unsubscribe-Post header (RFC 8058, CAN-SPAM). The email
      // adapter builds the header from ctx.oneClickUrl (buildListUnsubscribeHeaders, §18 one
      // home). Best-effort: a mint failure must NEVER block the send — the email just ships
      // without the header (the status quo before this slice), logged honestly (§13).
      let oneClickUrl: string | undefined;
      try {
        // Reuse this recipient's unused token so links in earlier emails keep working (the handler
        // looks tokens up by hash, so minting a new one on every send broke every older link). A
        // token already used, or none yet, mints a fresh one exactly as before.
        if (tenantId) {
          const { data: existingTok } = await admin
            .from("email_unsubscribe_tokens")
            .select("token")
            .eq("tenant_id", tenantId)
            .eq("email", body.to)
            .is("used_at", null)
            .not("token", "is", null)
            .maybeSingle();
          const reuse = (existingTok as { token?: string | null } | null)?.token;
          if (reuse) oneClickUrl = `${supabaseUrl}/functions/v1/comms-email-unsubscribe?token=${reuse}`;
        }
      } catch (e) {
        console.warn("send-message: unsubscribe token lookup failed; minting a new one:", (e as Error)?.message);
      }
      if (!oneClickUrl) try {
        const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
        const tokenHash = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        // Upsert on the tenant-scoped (tenant_id, email) unique (C-2s-C migration): one active
        // token per recipient per tenant. effectiveContactId lets the unsubscribe handler write
        // a contact-scoped suppression; tenant_id makes a contactless opt-out resolvable (§9).
        const { error: mintErr } = await admin
          .from("email_unsubscribe_tokens")
          .upsert({
            token: rawToken,
            token_hash: tokenHash,
            email: body.to,
            contact_id: effectiveContactId ?? null,
            tenant_id: tenantId,
            used_at: null,
          }, { onConflict: "tenant_id,email" });
        if (mintErr) {
          console.warn("send-message: unsubscribe token mint failed; sending without List-Unsubscribe:", mintErr.message);
        } else {
          oneClickUrl = `${supabaseUrl}/functions/v1/comms-email-unsubscribe?token=${rawToken}`;
        }
      } catch (e) {
        console.warn("send-message: unsubscribe token mint threw; sending without List-Unsubscribe:", (e as Error)?.message);
      }

      // Marketing email fails CLOSED on the unsubscribe (owner ruling 7): no working one-click link,
      // or no {{unsubscribe_url}} in the body for the visible link, means nothing is sent.
      if (body.marketing === true) {
        const reason = !tenantId || !oneClickUrl
          ? "unsubscribe_unavailable"
          : !String(body.body ?? "").includes("{{unsubscribe_url}}") ? "unsubscribe_link_missing" : null;
        if (reason) {
          return new Response(JSON.stringify({
            status: "failed", error: null, outcome: "blocked_unsubscribe_unavailable", reason,
            message_id: null, scheduled_for: null,
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        outMsg.body_html = String(body.body).split("{{unsubscribe_url}}").join(oneClickUrl!);
      }

      const ctx: OutboundSendContext = {
        from: { address: resolvedSenderEmail, display_name: senderName ?? undefined },
        to: body.to,
        replyTo,
        providerApiKey: resendKey,
        // #141c: thread the connector's non-secret SMTP transport config (host/port/secure) so
        // the provider==='smtp' branch can send through the tenant's own host. null for Resend/Gmail.
        connectorConfig: isSmtp ? (connectorRow?.config ?? null) : null,
        // OutboundSendContext field is listUnsubscribeUrl (the adapter reads it → buildListUnsubscribeHeaders).
        // Only a marketing send advertises List-Unsubscribe: on a 1:1 reply, a thread or an invoice a
        // one-click "Unsubscribe" would write a channel-wide suppression (channel-adapters.ts doc).
        listUnsubscribeUrl: body.marketing === true ? (oneClickUrl ?? null) : null,
        // INT-328: a governed email's provider key is ALWAYS its operation's — never a caller's — so a
        // reconcile re-enters Resend under the very key the first attempt used.
        idempotencyKey: commsBinding
          ? `comms-email:${commsBinding.operation_id}`
          : typeof body.idempotency_key === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(body.idempotency_key)
            ? body.idempotency_key : null,
        // #141b: Gmail dispatch INSIDE the email adapter (§18 — not a second 'email' entry).
        // provider!=='gmail' leaves the Resend path byte-for-byte unchanged.
        provider: connectorRow?.provider ?? null,
        credentialsVaultRef: connectorRow?.credentials_vault_ref ?? null,
        admin,                     // service-role client the Gmail seam uses to read the Vault ref
      };
      if (invoiceBinding) {
        // A separate delivery grant is minted at the one atomic provider-admission point.
        // body.body stays token-free for every existing persistence/audit/preview path.
        const token = mintSignerToken();
        const transientHtml = renderTransientInvoiceLink(invoiceBinding, PAIGE_APP_ORIGIN, token);
        const { data: claimed, error: claimError } = await admin.rpc("claim_sales_invoice_delivery", { _message_id: invoiceBinding.message_id, _operation_id: invoiceBinding.operation_id, _grant_id: crypto.randomUUID(), _token_hash: await sha256Hex(token), _expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
        // A losing/concurrent/uncertain claim must not finalize another attempt's operation.
        if (claimError || !claimed || claimed.state !== "dispatching") return new Response(JSON.stringify({ ok: false, outcome: "outcome_unknown", error: "invoice_dispatch_claim_unconfirmed", message_id: invoiceBinding.message_id }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        invoiceDispatchClaimed = true;
        const projection=await collectInvoiceLedger(admin as unknown as Parameters<typeof collectInvoiceLedger>[0],'read_public_sales_invoice_payment_ledger',{_token_hash:await sha256Hex(token)});
        const facts=projection as Record<string,unknown>|null;
        if(!facts||facts.invoice_id!==invoiceBinding.invoice_id||facts.document_input_digest!==invoiceBinding.document_digest||facts.version!==invoiceBinding.expected_lifecycle_version)throw Error('INVOICE_ATTACHMENT_UNAVAILABLE');
        const invoiceHtml=renderSalesInvoiceDocument(projection);if(!invoiceHtml)throw Error('INVOICE_ATTACHMENT_UNAVAILABLE');
        ctx.serverAttachments=[pdfEmailAttachment(await renderDocumentPdf(invoiceHtml),String(facts.current_invoice_number??'document'))];
        const current=await admin.rpc('_sales_invoice_read',{_tenant:tenantId,_invoice:invoiceBinding.invoice_id});
        if(current.error||!current.data||current.data.version!==facts.version||current.data.status!=='issued')throw Error('INVOICE_CHANGED_DURING_PDF');
        outMsg.body_html = transientHtml;
        invoiceProviderAttempted = true;
      }
      let commsAbort: AbortController | null = null;
      if (commsBinding) {
        // The one atomic provider-admission point (mirrors the invoice claim above). A losing,
        // concurrent or uncertain claim never calls the provider and never finalizes: the
        // operation belongs to whichever attempt holds it.
        const { data: claimed, error: claimError } = await admin.rpc("claim_comms_email_send", {
          _message_id: body.message_id, _operation_id: commsBinding.operation_id, _reconcile: commsReconcile,
        });
        const claimedAttempt = (claimed as { attempts?: unknown } | null)?.attempts;
        // `admitted` is set true ONLY by the call that performed the prepared→dispatching update. A
        // caller that lost a race re-reads a row already 'dispatching' with the winner's attempt
        // number; without this flag it would be indistinguishable and send the email a second time.
        if (claimError || !claimed || (claimed as { admitted?: unknown }).admitted !== true ||
            (claimed as { state?: unknown }).state !== "dispatching" ||
            typeof claimedAttempt !== "number" || !Number.isInteger(claimedAttempt) || claimedAttempt < 1) {
          return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_NOT_CLAIMABLE" }, 409);
        }
        commsDispatchClaimed = true;
        commsClaimedAttempt = claimedAttempt;
        commsAbort = new AbortController();
        (ctx as CommsEmailSendContext).abortSignal = commsAbort.signal;
        commsProviderAttempted = true;
      }
      const delivery = commsAbort
        ? await sendWithinCommsEmailDeadline(() => adapter.send(outMsg, ctx), commsAbort)
        : await adapter.send(outMsg, ctx);
      if (commsBinding) commsDelivery = delivery;
      // #141b/#141c HONEST NOTE (§13): the paige_messages_audit.pipe_used CHECK is
      // ('resend','twilio','ghl_fallback') — 'gmail'/'smtp' are not yet legal values, so widening
      // it is a tracked follow-up (an enum migration carries its own §37 producer inventory). The
      // Gmail/SMTP send is recorded here as the email pipe; the TRUE transport is recoverable from
      // the connector row (connector_id → provider='gmail'|'smtp'), so no information is lost.
      pipe_used = "resend";
      if (!delivery.ok) {
        throw new Error(
          invoiceBinding ? "invoice_provider_result_unconfirmed" : commsBinding ? "comms_email_provider_not_accepted" : delivery.error || (isGmail ? "gmail_send_failed" : isSmtp ? "smtp_send_failed" : "resend_send_failed"),
        );
      }
      vendor_message_id = delivery.provider_message_id ?? null;
      status = "sent";
    } else {
      // SMS — route THROUGH the per-tenant Twilio OutboundChannelAdapter (§18/§32).
      // Replaces the old platform-master-creds + paige_config.default_from_sms_number path
      // (the §9/§38 correction): A2P is per-tenant, creds are the tenant's subaccount, and
      // the from-number is the tenant's own — resolved from tenant_phone_numbers, isolated
      // by §9 RLS (D2: no reserved-number exclusion; an imported number is a real from-number).
      const adapter = getOutboundAdapter("sms");
      if (!adapter) throw new Error("no_sms_adapter_registered");

      // Per-message DLR StatusCallback endpoint.
      //
      // MUST carry the tenant's stamped secret. `twilio-status-callback` now fails
      // CLOSED, and this per-message URL OVERRIDES the number-level one stamped at
      // purchase — so an unstamped URL here means every delivery receipt for every
      // tenant is refused with 401 and the row never leaves 'sent'.
      const stampSecret = tenantId
        ? ((await admin.from("tenant_twilio_subaccounts")
              .select("inbound_webhook_secret").eq("tenant_id", tenantId).maybeSingle())
            .data?.inbound_webhook_secret ?? null)
        : null;
      const statusCallbackUrl = stampSecret
        ? (Deno.env.get("TWILIO_STATUS_CALLBACK_URL")
            ? `${Deno.env.get("TWILIO_STATUS_CALLBACK_URL")}?t=${encodeURIComponent(stampSecret)}`
            : supabaseUrl
              ? stampedWebhookUrls(supabaseUrl, stampSecret).statusCallback
              : null)
        // No secret ⇒ emit NO callback rather than one that will be refused. The row
        // stays at its send-time status, which is honest, instead of accruing 401s.
        : null;

      const outMsg: NormalizedMessage = {
        thread_key: body.thread_key || draftRow?.thread_key || perContactKey || `sms:${body.to}`,
        channel_type: "sms",
        direction: "outbound",
        status: "queued",
        contact_id: effectiveContactId,
        connector_id: effectiveConnectorId,
        recipients: [{ address: body.to }],
        body_text: body.body, // SMS body is plain text
      };
      const ctx: OutboundSendContext = {
        from: { address: "" },     // real from-number is resolved INSIDE the adapter (§9)
        to: body.to,
        admin,                     // service-role client for creds/number/A2P reads
        tenantId,                  // server-derived (§9), never from body
        statusCallbackUrl,
      };
      if (invoiceBinding) {
        const token = mintSignerToken();
        const transientText = renderTransientInvoiceText(invoiceBinding, PAIGE_APP_ORIGIN, token);
        const { data: claimed, error: claimError } = await admin.rpc("claim_sales_invoice_delivery", { _message_id: invoiceBinding.message_id, _operation_id: invoiceBinding.operation_id, _grant_id: crypto.randomUUID(), _token_hash: await sha256Hex(token), _expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
        if (claimError || !claimed || claimed.state !== "dispatching") return new Response(JSON.stringify({ ok:false, outcome:"outcome_unknown", error:"invoice_dispatch_claim_unconfirmed" }), {status:409,headers:{...corsHeaders,"Content-Type":"application/json"}});
        invoiceDispatchClaimed = true;
        outMsg.body_text = transientText;
        invoiceProviderAttempted = true;
      }
      const delivery = await adapter.send(outMsg, ctx);
      pipe_used = "twilio";

      // Record the tenant number the adapter actually used (audit + messages row).
      const fromUsed = (delivery.meta?.from_number as string | undefined) ?? null;
      if (fromUsed) fromAddress = fromUsed;

      if (!delivery.ok) {
        // Honest failure surface (§13): reason/needs_config preserved; status stays 'failed'
        // (§37). The thrown message lands in errorText for the audit row.
        reason = delivery.reason ?? (delivery.needs_config ? "needs_config" : null);
        throw new Error(invoiceBinding ? "invoice_provider_result_unconfirmed" : delivery.error || delivery.reason || "sms_send_failed");
      }
      vendor_message_id = delivery.provider_message_id ?? null;
      status = "sent";
    }
  } catch (e) {
    // INT-328: a governed email's durable audit text is a code, never the provider's words.
    errorText = invoiceBinding ? "invoice_delivery_requires_review"
      : commsBinding ? "comms_email_requires_review"
      : (e as Error).message.slice(0, 500);
    status = "failed";
  }

  const { data: auditRow } = await admin
    .from("paige_messages_audit")
    .insert({
      channel: body.channel,
      pipe_used,
      to_address: body.to,
      from_address: fromAddress,
      subject: body.subject,
      body: body.body,
      status,
      vendor_message_id,
      error: errorText,
      contact_id: body.contact_id ?? null,
      conversation_id: body.conversation_id ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  // ── Comms C-1 (§10) — write/patch the tenant-isolated public.messages row so the
  // unified inbox reflects the send. On success: UPDATE the draft (message_id) → sent,
  // or INSERT a fresh outbound sent row (tenant server-derived by the messages trigger
  // from connector_id/contact_id — the body is never trusted, §9). Idempotent on
  // provider_message_id. On failure with a known draft, mark it failed so the queue
  // (§36) surfaces the miss. Telemetry-safe: wrapped so a messages-write hiccup can
  // NEVER change the { status, error } payload this function returns to existing callers.
  let messageRowId: string | null = null;
  try {
    if (commsBinding) {
      // INT-328: finalize_comms_email_send owns the prepared row (sent + receipt, failed/blocked, or
      // untouched for unknown). The generic patch would claim 'failed' for an unknown attempt.
      messageRowId = body.message_id ?? null;
    } else if (status === "sent") {
      if (body.message_id) {
        const { data: updated } = await admin
          .from("messages")
          .update({
            status: "sent",
            provider_message_id: vendor_message_id,
            in_reply_to_provider_id: body.in_reply_to ?? undefined,
            error: null,
            sent_at: new Date().toISOString(),
          })
          .eq("id", body.message_id)
          .select("id")
          .maybeSingle();
        messageRowId = updated?.id ?? body.message_id;
      } else if (effectiveContactId || effectiveConnectorId) {
        // Idempotency guard: a retried send with the same provider id must not double-insert.
        let existingId: string | null = null;
        if (vendor_message_id) {
          const { data: existing } = await admin
            .from("messages")
            .select("id")
            .eq("provider_message_id", vendor_message_id)
            .maybeSingle();
          existingId = existing?.id ?? null;
        }
        if (existingId) {
          messageRowId = existingId;
        } else {
          const { data: inserted } = await admin
            .from("messages")
            .insert({
              // tenant_id intentionally OMITTED — set_message_tenant() derives it from
              // connector_id → contact_id (§9). Requires one of them to be present,
              // which the branch condition guarantees.
              thread_key: body.thread_key || perContactKey || `${body.channel}:${body.to}`,
              contact_id: effectiveContactId,
              connector_id: effectiveConnectorId,
              channel_type: body.channel,
              direction: "outbound",
              status: "sent",
              sender: fromAddress
                ? { address: (fromAddress.match(/<([^>]+)>/)?.[1] ?? fromAddress) }
                : null,
              recipients: [{ address: body.to }],
              subject: body.subject ?? null,
              body_html: body.channel === "email" ? body.body : null,
              body_text: body.channel === "email" ? null : body.body,
              provider_message_id: vendor_message_id,
              in_reply_to_provider_id: body.in_reply_to ?? null,
              attachments: body.attachments ?? [],   // C-1.5: persist for the inbox row
              sent_at: new Date().toISOString(),
              meta: { source: "send-message", pipe_used },
            })
            .select("id")
            .maybeSingle();
          messageRowId = inserted?.id ?? null;
        }
      }
    } else if (body.message_id) {
      const { data: failed } = await admin
        .from("messages")
        .update({ status: "failed", error: errorText })
        .eq("id", body.message_id)
        .select("id")
        .maybeSingle();
      messageRowId = failed?.id ?? body.message_id;
    }
  } catch (e) {
    console.warn("[send-message] messages row write skipped:", (e as Error)?.message);
  }

  if (status === "sent" && body.conversation_id) {
    await admin.from("paige_conversations").insert({
      channel: body.channel,
      // The outbound mirror carried no tenant either (C-7). `tenantId` here is the
      // server-derived one this send was already authorised against — never a
      // value from the request body.
      tenant_id: tenantId,
      contact_id: body.contact_id ?? null,
      direction: "outbound",
      subject: body.subject,
      body: body.body,
      source_message_id: vendor_message_id,
      status: "replied",
      metadata: { audit_id: auditRow?.id, in_reply_to: body.conversation_id },
    });
    // §9 — scope the update to the send's OWN tenant.
    //
    // `admin` is service-role, so RLS does not apply here, and
    // `body.conversation_id` arrives from the request and is validated nowhere.
    // The caller gate above requires only a GLOBAL `admin` app_role, and
    // `user_roles` has no tenant column (§59) — so without this predicate a
    // tenant-A admin who performs any successful send could pass tenant B's
    // conversation id and flip that row. An unguessable UUID is not access
    // control.
    //
    // Left unscoped when `tenantId` is null: that is the platform-owner path,
    // which legitimately reaches across tenants. Adding `.eq("tenant_id", null)`
    // there would match nothing and silently break the operator instead.
    //
    // OBSERVABLE, because a scoped update can now match ZERO rows where it used to
    // match one — and a silent no-op is a regression that looks like success. The
    // `.select("id")` makes the match count readable and a 0-row result is logged
    // loudly rather than swallowed. It is NOT treated as a send failure: the
    // message really did go out, and failing here would be a worse lie.
    {
      const convoUpdate = admin.from("paige_conversations")
        .update({ status: "replied" })
        .eq("id", body.conversation_id);
      const { data: convoRows, error: convoErr } = await (
        tenantId ? convoUpdate.eq("tenant_id", tenantId) : convoUpdate
      ).select("id");
      if (convoErr) {
        console.error("[send-message] conversation status update failed:", convoErr.code, convoErr.message);
      } else if (!convoRows?.length) {
        console.error(
          `[send-message] conversation ${body.conversation_id} matched 0 rows for tenant ${tenantId ?? "(none)"} — status NOT advanced. The message was sent.`,
        );
      }
    }
  }

  if (body.approval_id) {
    // Same §9 reasoning as the conversation update above, and a larger blast
    // radius: this marks an approval APPROVED and stamps who reviewed it. An
    // unvalidated id here let one tenant's caller approve another tenant's
    // pending action.
    const approvalUpdate = admin.from("paige_pending_approvals")
      .update({
        status: status === "sent" ? "approved" : "pending",
        reviewed_by_user_id: user?.id ?? null,
        reviewed_at: new Date().toISOString(),
        sent_at: status === "sent" ? new Date().toISOString() : null,
        sent_message_audit_id: auditRow?.id ?? null,
      })
      .eq("id", body.approval_id);
    const { data: apprRows, error: apprErr } = await (
      tenantId ? approvalUpdate.eq("tenant_id", tenantId) : approvalUpdate
    ).select("id");
    if (apprErr) {
      console.error("[send-message] approval update failed:", apprErr.code, apprErr.message);
    } else if (!apprRows?.length) {
      // A 0-row match leaves the approval `pending` with `claimed_at` set, so every
      // retry reports already-in-progress. Recoverable only if someone can see it —
      // hence error level.
      //
      // The consequence DEPENDS ON WHETHER THE SEND HAPPENED, and this block is not
      // gated on that: unlike the conversation update above, it runs for a failed
      // send too (`status` initialises to "failed", and the update itself writes
      // "pending" for exactly that case). An earlier version of this line asserted
      // "the message was sent" unconditionally — stating as fact, in the one record
      // a human would read while diagnosing, something that may not have happened.
      // That is the same class of defect as a fabricated delivery status, and it
      // was introduced by the very commit that added this logging.
      console.error(
        status === "sent"
          ? `[send-message] approval ${body.approval_id} matched 0 rows for tenant ${tenantId ?? "(none)"} — it stays pending though the message WAS sent. If this fires, the approval row's tenant does not match the send's.`
          : `[send-message] approval ${body.approval_id} matched 0 rows for tenant ${tenantId ?? "(none)"} — the send did not succeed (status ${status}) and the approval could not be reset to pending. If this fires, the approval row's tenant does not match the send's.`,
      );
    }
  }

  // ── Paige Context Rail — COMMS emitter: file 'comms.outbound' after a message
  // actually SENDS to a client, so the OWNER rail AND the client's OWN live feed
  // both reflect the two-way conversation in real time (§7/§8). comms.outbound is a
  // client_visible kind → record_rail_event reaches both the client feed and the
  // owner rail. Truthful (§13): gated on status === "sent" only — a fire is not a
  // delivery, and a failed send never files a comms event. Telemetry ONLY: the whole
  // block is wrapped so a rail failure can NEVER affect message delivery or the
  // structured { status, error } payload this function returns. Contact resolution:
  // an explicit body.contact_id wins; otherwise we resolve the to-address WITHIN THE
  // CALLER'S TENANT via the JWT-scoped resolver (userClient carries the caller's JWT,
  // so auth.uid() is set and resolve_contact_id scopes to current_user_tenant_id() —
  // no cross-tenant match, §9). If no contact resolves we SKIP rather than fabricate
  // one (§13). We then read that contact's tenant to pass p_tenant_id on the
  // service-role record_rail_event call (auth.uid() is NULL there).
  if (status === "sent") {
    try {
      // Resolve the caller's own tenant once (JWT-scoped). An explicitly-supplied
      // body.contact_id is only trusted if it belongs to THIS tenant — otherwise a
      // caller in tenant A could pass tenant B's contact id and file comms.outbound
      // onto B's owner rail AND B's client-visible feed (§9). The resolver-fallback
      // path below is already scoped to the caller via userClient's JWT, so it can
      // only ever return an in-tenant contact. (callerTenant is resolved once above,
      // at the pre-send §9 gate, and reused here.)
      let railContactId: string | null = body.contact_id ?? null;
      if (!railContactId) {
        const { data: resolved } = await userClient.rpc("resolve_contact_id", {
          p_tenant: null,
          p_phone: body.channel === "sms" ? body.to : null,
          p_email: body.channel === "email" ? body.to : null,
          p_user_id: null,
        });
        railContactId = (typeof resolved === "string" && resolved) ? resolved : null;
      }
      if (railContactId) {
        const { data: contactRow } = await admin
          .from("clients")
          .select("tenant_id")
          .eq("id", railContactId)
          .maybeSingle();
        const tenantId = contactRow?.tenant_id ?? null;
        // §9 gate: the contact's tenant must match the caller's own tenant. This
        // catches a foreign explicit body.contact_id; the resolver path trivially
        // passes (same tenant). Skip (don't mis-file) on mismatch or unknown caller.
        if (tenantId && callerTenant && tenantId === callerTenant) {
          // Build a clean, jargon-free preview for BOTH channels: email bodies are
          // HTML, so strip tags (prefer the subject) before truncating so no markup
          // leaks into the feed summary (§3); SMS bodies are already plain text.
          const rawPreview = body.channel === "email" ? (body.subject || body.body) : body.body;
          const text = (rawPreview || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          const preview = text.length > 140 ? text.slice(0, 137) + "…" : text;
          await admin.rpc("record_rail_event", {
            p_contact_id: railContactId,
            p_event_kind: "comms.outbound",
            p_surface: "client_portal",
            p_actor_type: "paige_agent",
            p_title: "Message sent",
            p_summary: preview || null,
            p_ref_table: "paige_messages_audit",
            p_ref_id: auditRow?.id ?? null,
            p_from_department: "client_experience",
            p_tenant_id: tenantId,
          });
        }
      }
    } catch (e) {
      console.warn("[send-message] comms.outbound rail emit skipped:", (e as Error)?.message);
    }
  }

  // Send-path disposition (§37 / contract §5): every block/queue case already early-returned
  // from the pre-send seam, so here `outcome` only ever mirrors the wire `status` (sent|failed).
  // reason: prefer the SMS reason code the branch set, else the raw error text on failure.
  outcome = status; // 'sent' | 'failed'
  if (status === "failed" && !reason) reason = errorText;
  if (commsBinding) {
    // A throw before the claim (e.g. no Resend key) never reached a provider. A reconcile that did not
    // win its claim cannot finalize an operation that is not 'prepared' — it stays for review.
    if (!commsDispatchClaimed && commsReconcile) {
      return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" }, 409);
    }
    if (!commsDispatchClaimed && !unclaimedMayFinalize()) {
      return commsEmailResponse("outcome_unknown", null, { code: "COMMS_EMAIL_NOT_CLAIMABLE" }, 409);
    }
    const classified = commsEmailDeliveryOutcome(commsProviderAttempted, commsDelivery, status === "sent" ? vendor_message_id : null);
    const receipt = await finalizeCommsEmail(classified.outcome, classified.outcome === "provider_accepted" ? vendor_message_id : null, classified.reason);
    return commsEmailResponse(receipt ? classified.outcome : "outcome_unknown", classified.reason);
  }
  if (invoiceBinding) {
    // A confirmed claim followed by a local PDF failure never called a provider.
    // Uncertain claims returned earlier; attempted provider sends remain unknown on failure.
    const invoiceOutcome = invoiceProviderAttempted
      ? status === "sent" && vendor_message_id ? "provider_accepted" : "unknown"
      : "failed";
    const receipt = await finalizeInvoice(invoiceOutcome, vendor_message_id);
    return new Response(JSON.stringify({ ok: !!receipt && invoiceOutcome === "provider_accepted", outcome: receipt ? invoiceOutcome : "outcome_unknown", message_id: invoiceBinding.message_id, delivery_confirmed: false, error: invoiceOutcome === "provider_accepted" && receipt ? null : "invoice_delivery_requires_review" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(
    JSON.stringify({
      audit_id: auditRow?.id,
      vendor_message_id,
      pipe_used,
      status,
      error: errorText,
      // Additive (§37): the unified-inbox messages row id, when one was written/patched.
      message_id: messageRowId,
      // ── C-2a additive (§37 / contract §5) ──
      outcome,                      // sent|failed here; blocked_*/queued_* from the pre-send seam
      reason,                       // 'a2p_not_approved' | 'needs_config' | error text | null
      scheduled_for: null,          // C-1.5 owns non-null echo; null on the send path
    }),
    {
      // Always 200 so the client surfaces our structured { status, error } payload
      // instead of getting a generic "Edge Function returned non-2xx" error.
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
