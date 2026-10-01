/**
 * E7 — Governed Calendar-link sharing (tenant-brain adapter).
 *
 * Sibling of `calendar-preset-tenant-brain.ts`, for a DIFFERENT act: sharing a
 * PUBLISHED calendar's public booking link (`/book/{slug}`) with a tenant contact.
 * It owns no table, provider, queue, consent model, or Rail — it COMPOSES the
 * existing canonical seams and reports the truth (§13/§18):
 *
 *   • Shareability  → public.calendar_link_shareable (reuses _assert_can_manage_preset;
 *                     mirrors public-booking loadCalendar: enabled=true AND >=1 host).
 *   • Consent/DND/  → runPreSend (the ONE pre-send decision seam) for the eligibility
 *     suppression     preview; the SEND itself goes through send-message, which runs the
 *                     SAME pipeline again — the preview can never be more permissive.
 *   • Email/SMS send→ the send-message edge function (channel adapter registry). E7 adds
 *                     NO field to its contract and is a new CONSUMER of it (§37). It never
 *                     calls a provider directly and never creates a second send path.
 *   • Social        → public.social_account_status enumerates CONNECTED accounts, and E7
 *                     returns COPY-READY post text. There is NO governed social-post
 *                     executor and E7 must not invent an adapter, so social is copy-only
 *                     (owner ruling 2026-09-13). It NEVER claims a post happened.
 *
 * HONEST BOUNDS (§13/§70):
 *   • A non-public calendar (draft/paused/archived/setup-required) refuses truthfully and
 *     NO book_url is emitted.
 *   • A send's success is decided by send-message's `outcome`, NEVER its wire `status`
 *     (a queued/blocked send returns status:"failed" with outcome queued_* or blocked_*; a
 *     scheduled one returns outcome:queued_scheduled). success is reported ONLY when
 *     outcome==="sent"; queued/blocked/failed/needs_config are reported as themselves and
 *     NEVER as success. There is no false success.
 *   • Rail: send-message files the canonical `comms.outbound` Rail event on a real send
 *     (and withholds it for a hold/failure), so E7 files NO second Rail event or receipt —
 *     one home for the outbound record.
 */

import type { SupabaseAdminLike } from "./twilio.ts";
import type { ChannelType } from "./channel-adapters.ts";
import { runPreSend } from "./pre-send-pipeline.ts";
import { primaryContactMethod } from "./contact-methods.ts";

type RpcError = { message?: string } | null;

/** Caller-JWT rpc port: calendar_link_shareable + current_user_tenant_id + social_account_status. */
export type CalendarLinkRpcPort = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;
};

/** The send-message response fields E7 reads. Wire `status` is deliberately NOT trusted for success. */
export type SendMessageResult = {
  httpOk: boolean;
  status?: string | null;
  outcome?: string | null;
  reason?: string | null;
  vendor_message_id?: string | null;
  audit_id?: string | null;
  message_id?: string | null;
  error?: string | null;
};

/** Injected send: POSTs to the send-message edge fn forwarding the caller JWT. */
export type SendMessageFn = (input: {
  channel: ChannelType;
  to: string;
  subject?: string;
  body: string;
  contact_id: string;
}) => Promise<SendMessageResult>;

export type ShareChannel = "email" | "sms";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const stringValue = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Map an rpc error message to a stable, safe code (§13 — no raw leak). */
function shareableRpcCode(error: RpcError): "CALENDAR_NOT_FOUND" | "CALENDAR_FORBIDDEN" | "CALENDAR_SHAREABLE_UNKNOWN" {
  const m = stringValue(error?.message) ?? "";
  // _assert_can_manage_preset raises P0002 (not found) / 42501 (forbidden); PostgREST
  // surfaces the SQLSTATE and the message. Match on the tagged message, robust to prefixing.
  if (m.includes("PRESET_NOT_FOUND") || m.includes("P0002")) return "CALENDAR_NOT_FOUND";
  if (m.includes("PRESET_FORBIDDEN") || m.includes("42501") || m.toLowerCase().includes("permission")) return "CALENDAR_FORBIDDEN";
  return "CALENDAR_SHAREABLE_UNKNOWN";
}

export type ShareabilityFacts =
  | { ok: true; shareable: boolean; reason: string | null; slug: string | null; title: string | null }
  | { ok: false; code: string };

/** Resolve the ONE authoritative shareability answer via the caller-scoped RPC. */
async function readShareability(
  caller: CalendarLinkRpcPort,
  calendarId: string,
): Promise<ShareabilityFacts> {
  let res: { data: unknown; error: RpcError };
  try {
    res = await caller.rpc("calendar_link_shareable", { _cal: calendarId, _tenant: null });
  } catch {
    return { ok: false, code: "CALENDAR_SHAREABLE_UNKNOWN" };
  }
  if (res.error) return { ok: false, code: shareableRpcCode(res.error) };
  // TABLE-returning RPC → an array with exactly one row.
  const row = Array.isArray(res.data) ? (res.data[0] as Record<string, unknown> | undefined) : (res.data as Record<string, unknown> | null);
  if (!row || typeof row.shareable !== "boolean") return { ok: false, code: "CALENDAR_SHAREABLE_INVALID" };
  return {
    ok: true,
    shareable: row.shareable === true,
    reason: stringValue(row.reason),
    slug: stringValue(row.slug),
    title: stringValue(row.title),
  };
}

async function resolveTenant(caller: CalendarLinkRpcPort): Promise<string | null> {
  try {
    const { data, error } = await caller.rpc("current_user_tenant_id", {});
    return error ? null : stringValue(data);
  } catch {
    return null;
  }
}

function bookUrl(publicSiteUrl: string, slug: string): string {
  const base = publicSiteUrl.replace(/\/+$/, "");
  return `${base}/book/${slug}`;
}

/** Escape text for safe embedding in an HTML email body (title + custom message are tenant text). */
function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The default, brand-neutral share copy (§2 coaching-generic, §3 direct voice). */
function defaultBody(channel: ShareChannel, title: string | null, url: string): string {
  const name = title ? `“${htmlEscape(title)}”` : "my booking page";
  if (channel === "sms") return `Book time with me here: ${url}`;
  return `<p>You can book time with me directly here:</p><p><a href="${url}">${name}</a><br>${url}</p>`;
}

/**
 * Compose the send body. send-message renders an EMAIL `body` as HTML (`body_html`) and an SMS
 * `body` as plain text (`body_text`), so the two channels compose differently (§70 — a recipient
 * must get a clickable, well-formed link, not a run-on line with a bare URL):
 *  - email + custom message: escape the tenant text, convert newlines to <br>, and ALWAYS append the
 *    booking link as a clickable <a> (the tool tells the model the link is auto-included, so it need
 *    not embed the raw URL). email + no message: the well-formed default HTML body.
 *  - sms: plain text; append the URL on its own line if the custom message did not already include it.
 */
function composeBody(channel: ShareChannel, title: string | null, url: string, custom: string | null): string {
  if (!custom) return defaultBody(channel, title, url);
  if (channel === "email") {
    return `<p>${htmlEscape(custom).replace(/\n/g, "<br>")}</p><p><a href="${url}">${url}</a></p>`;
  }
  return custom.includes(url) ? custom : `${custom}\n\n${url}`;
}

function defaultSubject(title: string | null): string {
  return title ? `Book time — ${title}` : "Book time with me";
}
function copyReadyText(title: string | null, url: string): string {
  return title ? `Book time with me (${title}): ${url}` : `Book time with me: ${url}`;
}

/* ============================ eligibility preview ============================ */

export type ChannelVerdict = "can_send" | "will_queue" | "blocked" | "ineligible" | "held";

export interface ChannelEligibility {
  address_on_file: boolean;
  verdict: ChannelVerdict;
  reason: string | null;
}

/** Map a runPreSend result (for a present address) to a channel verdict. */
export function verdictFromPreSend(outcome: string, reason: string | null): ChannelEligibility {
  if (outcome === "proceed") return { address_on_file: true, verdict: "can_send", reason: null };
  if (outcome.startsWith("queued")) return { address_on_file: true, verdict: "will_queue", reason };
  if (outcome.startsWith("blocked")) return { address_on_file: true, verdict: "blocked", reason };
  // "error" = a legal gate could not be verified → fail closed (held).
  return { address_on_file: true, verdict: "held", reason };
}

async function channelEligibility(
  admin: SupabaseAdminLike,
  tenantId: string,
  channel: ShareChannel,
  address: string | null,
  contactId: string | null,
): Promise<ChannelEligibility> {
  if (!address) return { address_on_file: false, verdict: "ineligible", reason: `No ${channel === "sms" ? "mobile number" : "email address"} on file for this contact.` };
  const pre = await runPreSend(admin, { tenantId, channel, to: address, contactId });
  return verdictFromPreSend(pre.outcome, pre.reason);
}

export interface ConnectedSocialAccount {
  platform: string | null;
  handle: string | null;
  status: string | null;
  selected: boolean;
}

/** Enumerate CONNECTED social accounts (caller JWT — social_account_status is authenticated-only). */
async function connectedSocial(caller: CalendarLinkRpcPort): Promise<ConnectedSocialAccount[]> {
  let res: { data: unknown; error: RpcError };
  try {
    res = await caller.rpc("social_account_status", {});
  } catch {
    return [];
  }
  if (res.error || !Array.isArray(res.data)) return [];
  return res.data
    .map((r) => r as Record<string, unknown>)
    .filter((r) => stringValue(r.status) === "connected")
    .map((r) => ({
      platform: stringValue(r.platform),
      handle: stringValue(r.handle),
      status: stringValue(r.status),
      selected: r.selected === true,
    }));
}

async function readContactAddresses(
  admin: SupabaseAdminLike,
  tenantId: string,
  contactId: string,
): Promise<{ email: string | null; phone: string | null } | null> {
  try {
    // The contact's PRIMARY email and phone — a contact holds several of each
    // (public.client_contact_methods), and a share goes to the primary of its channel's kind.
    const { data, error } = await admin
      .from("clients")
      .select("id, client_contact_methods(kind, value, is_primary)")
      .eq("id", contactId)
      .eq("tenant_id", tenantId) // §9 defense-in-depth: a cross-tenant id matches no row
      .maybeSingle();
    if (error || !data) return null;
    const methods = (data as Record<string, unknown>).client_contact_methods as Parameters<typeof primaryContactMethod>[0];
    return {
      email: stringValue(primaryContactMethod(methods, "email")),
      phone: stringValue(primaryContactMethod(methods, "phone")),
    };
  } catch {
    return null;
  }
}

export interface PrepareCalendarLinkInput {
  caller: CalendarLinkRpcPort;
  admin: SupabaseAdminLike;
  expectedTenantId: string;
  calendarId: string;
  contactId?: string | null;
  publicSiteUrl: string;
  observedAt?: Date;
}

/**
 * PREPARE (read, no send): shareability + book_url + per-channel eligibility (when a
 * contact is named) + connected social + copy-ready text. Never sends. Honest: when the
 * calendar is not public, no book_url/copy_ready is emitted.
 */
export async function prepareCalendarLinkShare(input: PrepareCalendarLinkInput): Promise<Record<string, unknown>> {
  const observedAt = (input.observedAt ?? new Date()).toISOString();

  if (!input.calendarId || !UUID_RE.test(input.calendarId)) {
    return { ok: false, code: "CALENDAR_ID_INVALID" };
  }
  const tenant = await resolveTenant(input.caller);
  if (!tenant) return { ok: false, code: "TENANT_NOT_RESOLVED" };
  if (tenant !== input.expectedTenantId) return { ok: false, code: "ACTIVE_ACCOUNT_CHANGED" };

  const share = await readShareability(input.caller, input.calendarId);
  if (!share.ok) return { ok: false, code: share.code };

  if (!share.shareable || !share.slug) {
    // No public link exists to share — refuse truthfully, emit no url/copy.
    return {
      ok: true,
      shareable: false,
      calendar: { reason: share.reason, title: share.title },
      note: "This calendar isn't public yet, so there's no booking link to share. Publish it first (only a Live calendar with at least one host can take a booking).",
      observedAt,
    };
  }

  const url = bookUrl(input.publicSiteUrl, share.slug ?? "");
  const contactId = input.contactId && UUID_RE.test(input.contactId) ? input.contactId : null;

  let channels: Record<ShareChannel, ChannelEligibility> | null = null;
  if (contactId) {
    const addrs = await readContactAddresses(input.admin, input.expectedTenantId, contactId);
    // A missing contact row (cross-tenant/forged or deleted) → both channels ineligible, honestly.
    const email = addrs?.email ?? null;
    const phone = addrs?.phone ?? null;
    channels = {
      email: await channelEligibility(input.admin, input.expectedTenantId, "email", email, contactId),
      sms: await channelEligibility(input.admin, input.expectedTenantId, "sms", phone, contactId),
    };
  }

  const social = await connectedSocial(input.caller);
  const anyDeliverable = channels ? (channels.email.verdict === "can_send" || channels.email.verdict === "will_queue" || channels.sms.verdict === "can_send" || channels.sms.verdict === "will_queue") : false;

  return {
    ok: true,
    shareable: true,
    calendar: { slug: share.slug, title: share.title, book_url: url },
    channels,
    social,
    copy_ready: { book_url: url, text: copyReadyText(share.title, url) },
    note: contactId && !anyDeliverable
      ? "No channel can send to this contact right now — here is copy-ready text to share by hand."
      : "Prepared. Nothing was sent. Confirm a channel to send, or use the copy-ready text.",
    observedAt,
  };
}

/* ================================== send ==================================== */

export type SendCapabilityOutcome = "sent" | "queued" | "refused" | "failed" | "outcome_unknown";

export interface MappedSend {
  success: boolean;
  outcome: SendCapabilityOutcome;
  reason: string | null;
  providerMessageId: string | null;
}

/**
 * THE READBACK-TRUTH MAP (the §13 heart of E7). Keys on send-message's `outcome`, NEVER its
 * wire `status`: a queued/blocked send returns status:"failed" with outcome queued_* or blocked_*.
 * success is true ONLY for outcome==="sent". Everything else is reported as itself.
 */
export function mapSendOutcome(res: SendMessageResult): MappedSend {
  if (!res.httpOk) {
    return { success: false, outcome: "outcome_unknown", reason: stringValue(res.reason) ?? stringValue(res.error) ?? "The send could not be confirmed.", providerMessageId: null };
  }
  const outcome = stringValue(res.outcome);
  if (outcome === "sent") {
    return { success: true, outcome: "sent", reason: null, providerMessageId: stringValue(res.vendor_message_id) };
  }
  if (outcome && outcome.startsWith("queued")) {
    return { success: false, outcome: "queued", reason: stringValue(res.reason) ?? "Held to send later.", providerMessageId: null };
  }
  if (outcome && outcome.startsWith("blocked")) {
    return { success: false, outcome: "refused", reason: stringValue(res.reason) ?? "This contact can't be messaged on this channel.", providerMessageId: null };
  }
  if (outcome === "failed") {
    return { success: false, outcome: "failed", reason: stringValue(res.reason) ?? stringValue(res.error) ?? "The send failed.", providerMessageId: null };
  }
  // Missing/unknown outcome → never assume success.
  return { success: false, outcome: "outcome_unknown", reason: stringValue(res.reason) ?? "The send outcome could not be determined.", providerMessageId: null };
}

export interface SendCalendarLinkInput {
  caller: CalendarLinkRpcPort;
  admin: SupabaseAdminLike;
  sendMessage: SendMessageFn;
  expectedTenantId: string;
  calendarId: string;
  contactId: string;
  channel: ShareChannel;
  subject?: string | null;
  message?: string | null;
  publicSiteUrl: string;
}

/**
 * SEND (high, confirm-gated by the Chat handler before this runs). Gates shareability,
 * resolves the contact address in-tenant, composes copy, and routes the send through
 * send-message. Reports the truthful outcome; NEVER a false success.
 */
export async function sendCalendarLink(input: SendCalendarLinkInput): Promise<Record<string, unknown>> {
  if (input.channel !== "email" && input.channel !== "sms") {
    return { success: false, code: "CHANNEL_INVALID" };
  }
  if (!input.calendarId || !UUID_RE.test(input.calendarId)) return { success: false, code: "CALENDAR_ID_INVALID" };
  if (!input.contactId || !UUID_RE.test(input.contactId)) return { success: false, code: "CONTACT_ID_INVALID" };

  // Account-switch guard BEFORE any read/compose/send (§9/§13).
  const tenant = await resolveTenant(input.caller);
  if (!tenant) return { success: false, code: "TENANT_NOT_RESOLVED" };
  if (tenant !== input.expectedTenantId) return { success: false, code: "ACTIVE_ACCOUNT_CHANGED" };

  // Shareability FIRST: a non-public calendar has no link to send.
  const share = await readShareability(input.caller, input.calendarId);
  if (!share.ok) return { success: false, code: share.code };
  if (!share.shareable || !share.slug) {
    return { success: false, code: "CALENDAR_NOT_SHAREABLE", reason: share.reason, note: "This calendar isn't public, so there's no booking link to send. Publish it first." };
  }

  // Resolve the contact's address for this channel (service-role, pinned to tenant §9).
  const addrs = await readContactAddresses(input.admin, input.expectedTenantId, input.contactId);
  const address = input.channel === "sms" ? (addrs?.phone ?? null) : (addrs?.email ?? null);
  if (!address) {
    return { success: false, code: "NO_CHANNEL_ADDRESS", reason: `This contact has no ${input.channel === "sms" ? "mobile number" : "email address"} on file, so it can't be sent by ${input.channel}.` };
  }

  const url = bookUrl(input.publicSiteUrl, share.slug);
  const subject = input.channel === "email" ? (stringValue(input.subject) ?? defaultSubject(share.title)) : undefined;
  // Always include the real book_url (§13 — the link must be present); composeBody is channel-aware.
  const body = composeBody(input.channel, share.title, url, stringValue(input.message));

  let res: SendMessageResult;
  try {
    // Pass the RAW contact address as `to`: send-message re-derives the contact's canonical address
    // and its identity check does NOT +tag-fold, so pre-folding here would make a plus-addressed email
    // fail recipient_contact_mismatch. send-message + runPreSend normalize internally.
    res = await input.sendMessage({ channel: input.channel, to: address, subject, body, contact_id: input.contactId });
  } catch (e) {
    return { success: false, outcome: "outcome_unknown", reason: e instanceof Error ? e.message : "The send could not be completed.", code: "SEND_INVOKE_FAILED" };
  }

  const mapped = mapSendOutcome(res);
  return {
    success: mapped.success,
    outcome: mapped.outcome,
    reason: mapped.reason,
    channel: input.channel,
    provider_message_id: mapped.providerMessageId,
    book_url: url,
    // Rail: the canonical comms.outbound event is filed by send-message on a real send; E7 files none.
    note: mapped.success
      ? "The booking link was handed to the messaging provider (delivery is confirmed asynchronously). Nothing was posted to social, and no second message was sent."
      : mapped.outcome === "queued"
        ? "The message is held and will send automatically at the allowed time; it has NOT been sent yet."
        : "The link was NOT sent. Reported the exact reason; do not claim it was delivered.",
  };
}

/* ============================== social copy ================================= */

export interface CalendarLinkSocialCopyInput {
  caller: CalendarLinkRpcPort;
  expectedTenantId: string;
  calendarId: string;
  publicSiteUrl: string;
}

/**
 * SOCIAL COPY (read): enumerate connected social channels and return COPY-READY post text.
 * There is NO governed social-post executor; this NEVER posts and NEVER claims it did.
 */
export async function calendarLinkSocialCopy(input: CalendarLinkSocialCopyInput): Promise<Record<string, unknown>> {
  if (!input.calendarId || !UUID_RE.test(input.calendarId)) return { ok: false, code: "CALENDAR_ID_INVALID" };
  const tenant = await resolveTenant(input.caller);
  if (!tenant) return { ok: false, code: "TENANT_NOT_RESOLVED" };
  if (tenant !== input.expectedTenantId) return { ok: false, code: "ACTIVE_ACCOUNT_CHANGED" };

  const share = await readShareability(input.caller, input.calendarId);
  if (!share.ok) return { ok: false, code: share.code };
  if (!share.shareable || !share.slug) {
    return { ok: true, shareable: false, posted: false, sent: false, reason: share.reason, note: "This calendar isn't public yet, so there's no booking link to post. Publish it first." };
  }

  const url = bookUrl(input.publicSiteUrl, share.slug);
  const social = await connectedSocial(input.caller);

  return {
    ok: true,
    shareable: true,
    posted: false, // there is no governed social-post executor — nothing was posted
    sent: false,
    connected_accounts: social,
    copy_ready: {
      book_url: url,
      text: share.title
        ? `Book time with me for ${share.title}: ${url}`
        : `Booking is open — grab a time with me: ${url}`,
    },
    note: social.length
      ? "Prepared copy-ready post text for your connected channels. Paige can't post to social on your behalf yet, so copy this and post it — nothing was posted."
      : "Prepared copy-ready post text. No social channels are connected, and Paige doesn't post to social on your behalf yet — copy this to post it by hand. Nothing was posted.",
  };
}
