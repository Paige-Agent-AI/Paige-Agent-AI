// =============================================================================
// Comms Slice C-1 — channel adapter contract (the ONE shape every channel maps to)
// =============================================================================
// NormalizedMessage is the canonical row shape for public.messages: every channel
// (email now; sms/whatsapp/instagram/facebook/voice in C-2..C-5) normalizes its
// provider payload INTO this on inbound, and renders FROM this on outbound. The
// jsonb sender/recipients/attachments/meta generalize across channels where a
// flat email "to_address" would not (SMS/voice "to" is a phone; IG is a handle).
//
// §18: this is the single home for the channel abstraction — inbound adapters
// (handle-inbound-email etc.) and the outbound dispatcher (send-message) both
// reason over this contract; no per-channel bespoke shape.
// §32: the C-1 email path routes THROUGH this registry so the abstraction is
// exercised live, not merely compiled.
// =============================================================================

export type ChannelType =
  | "email"
  | "sms"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "voice";

export type MessageDirection = "inbound" | "outbound";

export type MessageStatus =
  | "draft"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "received"
  | "read";

/** One party on a message — an email address, a phone number, or a channel handle. */
export interface MessageParty {
  address: string;
  display_name?: string;
}

export interface MessageAttachment {
  url: string;
  mime?: string;
  name?: string;
}

/**
 * The canonical unified-inbox message. Maps 1:1 to public.messages columns.
 * tenant_id is intentionally omitted from the adapter contract — it is SERVER
 * DERIVED by the set_message_tenant() trigger from the connector/contact (§9),
 * never carried in from a provider payload.
 */
export interface NormalizedMessage {
  thread_key: string;
  channel_type: ChannelType;
  direction: MessageDirection;
  status?: MessageStatus;
  contact_id?: string | null;
  connector_id?: string | null;
  sender?: MessageParty | null;
  recipients?: MessageParty[];
  subject?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  attachments?: MessageAttachment[];
  provider_message_id?: string | null;
  in_reply_to_provider_id?: string | null;
  action_id?: string | null;
  meta?: Record<string, unknown>;
  sent_at?: string | null;
}

/**
 * Minimal service-role client shape an outbound adapter may need (e.g. the SMS
 * adapter's per-tenant Twilio creds / number / A2P lookups). Structurally
 * compatible with twilio.ts's SupabaseAdminLike, so a real service-role client
 * assigns without a cast — kept here dependency-free (§18 one home).
 */
export type OutboundAdminClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

/** The result of an outbound send through a provider. */
export interface Delivery {
  ok: boolean;
  provider_message_id?: string | null;
  status: MessageStatus;
  error?: string | null;
  // ── C-2 additive (§13 honest degrade). Email never sets these (non-breaking). ──
  /** true = not a send FAILURE but an unwired/unprovisioned state (no subaccount / no number). */
  needs_config?: boolean;
  /** machine reason code surfaced into the send-message response `reason` (e.g. 'a2p_not_approved'). */
  reason?: string | null;
  /** adapter-resolved side data the dispatcher records (e.g. { from_number } for the audit row). */
  meta?: Record<string, unknown>;
}

/**
 * Per-channel send constraints the composer/Send button reasons over (§36).
 * Channels with session windows / quiet hours / template rules (WhatsApp, SMS)
 * fill these; email has none, so its adapter returns null.
 */
export interface SendConstraints {
  mustUseTemplate: boolean;
  windowClosesAt: string | null; // ISO — after this, a fresh outbound needs a template/opt-in
  requiresHumanEdit: boolean;
  quietHoursTz: string | null;
  maxLength: number | null;
}

/** A thread context enough to compute constraints (last inbound time, channel, connector). */
export interface ThreadContext {
  channel_type: ChannelType;
  connector_id?: string | null;
  last_inbound_at?: string | null;
  config?: Record<string, unknown>;
}

/** Inbound: a raw provider webhook event -> a NormalizedMessage (direction 'inbound'). */
export interface InboundChannelAdapter {
  channel_type: ChannelType;
  onEvent(raw: unknown): NormalizedMessage;
}

/** Outbound: a NormalizedMessage -> a provider send. `send` performs the provider call. */
export interface OutboundChannelAdapter {
  channel_type: ChannelType;
  send(msg: NormalizedMessage, ctx: OutboundSendContext): Promise<Delivery>;
  /** null = no constraints (email). Non-null for windowed/limited channels. */
  getSendConstraints(thread: ThreadContext): SendConstraints | null;
}

/** What the dispatcher hands an outbound adapter to actually perform the send. */
export interface OutboundSendContext {
  from: MessageParty;          // resolved tenant sender identity (§38 tenant-owned)
  to: string;                  // primary recipient address/phone/handle
  replyTo?: string | null;
  providerApiKey?: string | null;
  vaultCredentials?: Record<string, string> | null; // per-tenant creds (SMS subaccount, etc.)
  connectorConfig?: Record<string, unknown> | null;
  // ── C-2 additive: what the SMS adapter needs to resolve creds/number/A2P server-side (§9).
  //    Email ignores all three (non-breaking). ──
  /** Service-role client. The SMS adapter uses it for resolveTwilioCreds + tenant number/A2P reads. */
  admin?: OutboundAdminClient | null;
  /** Server-derived tenant (never from the request body, §9). Required for SMS; ignored by email. */
  tenantId?: string | null;
  // ── #141b additive (Gmail-vs-Resend dispatch INSIDE the email path). The email
  //    registry key 'email' is Resend's, so a Gmail send is NOT a second 'email' adapter —
  //    instead the dispatcher threads the connector's provider + Vault ref here and the
  //    email adapter routes to _shared/gmail.ts when provider==='gmail'. SMS ignores both. ──
  /** The connector's provider ('gmail' routes email through the Gmail seam; else Resend). */
  provider?: string | null;
  /** channel_connectors.credentials_vault_ref — the Vault secret NAME the Gmail seam reads. */
  credentialsVaultRef?: string | null;
  /** Per-message DLR StatusCallback URL Twilio POSTs delivery events to. Honest-null when unset. */
  statusCallbackUrl?: string | null;
  // ── C-2s-C additive (email List-Unsubscribe). SMS ignores both (non-breaking). ──
  /**
   * RFC 8058 one-click unsubscribe target — a per-recipient TOKENIZED URL pointing at
   * the tenant unsubscribe handler (comms-email-unsubscribe). The email adapter advertises
   * it via List-Unsubscribe / List-Unsubscribe-Post. Honest-null when the send has no
   * opt-out surface (e.g. a 1:1 human reply, or the token could not be minted, §13) — the
   * adapter then attaches NO opt-out header rather than a broken one. Set by the dispatcher
   * from the minted token, NEVER from a provider payload or request body.
   */
  listUnsubscribeUrl?: string | null;
  /**
   * Fixed PLATFORM mailbox for the mailto: arm of List-Unsubscribe (§2 — a platform address,
   * never a tenant address). Defaults inside buildListUnsubscribeHeaders() when omitted.
   */
  listUnsubscribeMailto?: string | null;
  /** A stable send identity forwarded to providers that de-duplicate on it (Resend Idempotency-Key). */
  idempotencyKey?: string | null;
}

/**
 * RFC 2369 + RFC 8058 List-Unsubscribe header block for OUTBOUND tenant email.
 *
 * §18 one home: this is the single place the List-Unsubscribe header shape is authored for the
 * tenant send path — mirroring the block already in send-transactional-email/index.ts so the two
 * paths never drift. The email OutboundChannelAdapter (registered in send-message) merges this
 * into its Resend `headers` when the dispatcher supplies a one-click URL.
 *
 * - `oneClickUrl`  the tokenized comms-email-unsubscribe endpoint (verify_jwt=false so Gmail's
 *                  JWT-less one-click POST reaches it). Per-recipient; carries the opt-out token.
 * - `mailto`       a FIXED platform mailbox (§2 — never a tenant address).
 *
 * Returns `{}` when there is no one-click URL to advertise (§13 honest — never fabricate an
 * opt-out surface for a message that has none).
 */
export function buildListUnsubscribeHeaders(
  oneClickUrl: string | null | undefined,
  mailto = "unsubscribe@mail.paigeagent.ai",
): Record<string, string> {
  if (!oneClickUrl) return {};
  return {
    "List-Unsubscribe": `<${oneClickUrl}>, <mailto:${mailto}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// -----------------------------------------------------------------------------
// Registries — the one place channel adapters are looked up (§18 one home).
// C-1 registers only email; C-2..C-5 add their adapters here, no new dispatcher.
// -----------------------------------------------------------------------------
const INBOUND = new Map<ChannelType, InboundChannelAdapter>();
const OUTBOUND = new Map<ChannelType, OutboundChannelAdapter>();

export function registerInboundAdapter(a: InboundChannelAdapter): void {
  INBOUND.set(a.channel_type, a);
}
export function registerOutboundAdapter(a: OutboundChannelAdapter): void {
  OUTBOUND.set(a.channel_type, a);
}
export function getInboundAdapter(ch: ChannelType): InboundChannelAdapter | undefined {
  return INBOUND.get(ch);
}
export function getOutboundAdapter(ch: ChannelType): OutboundChannelAdapter | undefined {
  return OUTBOUND.get(ch);
}

/** Compute constraints for a thread via its channel's outbound adapter (null if none / unknown). */
export function getSendConstraints(thread: ThreadContext): SendConstraints | null {
  return OUTBOUND.get(thread.channel_type)?.getSendConstraints(thread) ?? null;
}
