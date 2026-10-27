// Inbound email receiver — Comms Slice C-1 (unified inbox). Two provider arms, one home (§18):
//   * SendGrid Inbound Parse (multipart/form-data) — the live path since Resend's retirement
//     (owner, 2026-10-26). See "SendGrid Inbound Parse arm" below; it reuses steps 3–7.
//   * Resend (Svix-signed JSON) — the original arm, behaviour unchanged; receives nothing now
//     that nothing sends through Resend.
//
// Resend flow (doctrine-annotated):
//   1. Svix HMAC verification (unchanged) — fail closed if RESEND_WEBHOOK_SECRET missing.
//   2. Normalize the raw Resend payload THROUGH the channel-adapters registry
//      (§32: getInboundAdapter("email").onEvent(raw) — the abstraction is exercised
//      live, not merely compiled).
//   3. Resolve the TENANT from the recipient address/domain -> channel_connectors
//      (inbound_address then inbound_domain). §9: tenant is NEVER read from the body.
//      No connector => skip + log (never guess a tenant).
//   4. Upsert the contact in public.clients with tenant_id = connector.tenant_id (§9).
//   5. Insert the inbound public.messages row (tenant_id OMITTED — set_message_tenant()
//      derives it from connector_id). Idempotent on provider_message_id.
//   6. File a comms-draft-reply paige_action via service role (§8 action bus). The
//      existing paige-action-worker drainer + email-composer sub-agent + the
//      trg_comms_file_outbound_draft trigger take it from there.
//   7. Legacy paige_conversations dual-write + customer_support_intake bridge — GUARDED
//      and NON-BLOCKING for one release so n8n CS-Triage consumers keep their feed (§37).
//      Retires as a follow-up once those consumers move to the messages inbox.
//
// §13 honesty: C-1 ships INERT — no real Resend inbound domain / channel_connectors
// row is wired yet. With no connector matching the recipient, every event is skipped
// (logged). This function is correct and live, but processes nothing until a tenant
// provisions an inbound email connector.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
import {
  findClientIdByAddress,
  insertClientWithAddresses,
  lookupClientIdByAddress,
} from "../_shared/contact-methods.ts";
import { classifyAndRecordMessage, type ClassifyAdmin } from "../_shared/inbox-intelligence/classify-message.ts";
import { sha256Hex, verifySvix } from "../_shared/webhookSig.ts";
import {
  getInboundAdapter,
  registerInboundAdapter,
  type InboundChannelAdapter,
  type MessageAttachment,
  type MessageParty,
  type NormalizedMessage,
} from "../_shared/channel-adapters.ts";
import {
  SENDGRID_INBOUND_MAX_BYTES,
  SENDGRID_INBOUND_PARSE_SECRET_NAME,
  authenticateInboundParse,
  fallbackIdentityInput,
  sendgridFieldsFromForm,
  sendgridInboundAdapter,
} from "./sendgrid-inbound.ts";

type Admin = SupabaseClient;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

// Legacy paige_conversations dual-write + n8n bridge stays on for one release (§37).
// Set COMMS_LEGACY_DUAL_WRITE="false" to retire it; default is on.
const LEGACY_DUAL_WRITE = (Deno.env.get("COMMS_LEGACY_DUAL_WRITE") ?? "true") !== "false";

// -----------------------------------------------------------------------------
// Email inbound adapter (§18: the email channel's inbound normalizer lives here,
// registered into the ONE channel-adapters registry). onEvent() is a PURE mapping
// from the raw Resend payload to a NormalizedMessage — it knows only what the
// provider payload carries. tenant_id / connector_id / contact_id / the final
// thread_key are resolved by the handler against the DB (the adapter can't do IO).
// -----------------------------------------------------------------------------
function normEmail(v: unknown): string {
  return (v ?? "").toString().trim().toLowerCase();
}

/** Extract one party {address, display_name} from Resend's varied shapes. */
function toParty(v: unknown): MessageParty | null {
  if (!v) return null;
  if (typeof v === "string") {
    const addr = normEmail(v);
    return addr ? { address: addr } : null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const addr = normEmail(o.email ?? o.address);
    if (!addr) return null;
    const name = (o.name ?? o.display_name ?? "").toString().trim();
    return name ? { address: addr, display_name: name } : { address: addr };
  }
  return null;
}

/** Normalize Resend's `to`/`recipients` (string | object | array) to parties. */
function toParties(v: unknown): MessageParty[] {
  if (Array.isArray(v)) {
    return v.map(toParty).filter((p): p is MessageParty => !!p);
  }
  const one = toParty(v);
  return one ? [one] : [];
}

const emailInboundAdapter: InboundChannelAdapter = {
  channel_type: "email",
  onEvent(raw: unknown): NormalizedMessage {
    const evt = (raw ?? {}) as Record<string, unknown>;
    const data = ((evt.data as Record<string, unknown>) ?? evt) as Record<string, unknown>;

    const sender = toParty(data.from) ?? { address: "" };
    const recipients = toParties(data.to ?? data.recipients);

    const subject = (data.subject ?? "").toString();
    const bodyText = (data.text ?? data.body ?? "").toString();
    const bodyHtml = (data.html ?? "").toString();
    // NO synthetic fallback here: a crypto.randomUUID() would break retry dedup
    // (each redelivery mints a fresh id) and replay protection. When the payload
    // carries no provider id the HANDLER derives a deterministic identity from
    // the signed webhook envelope (constant across Svix retries of one event).
    const providerMessageId = (data.message_id ?? data.id ?? evt.id ?? null) !== null
      ? (data.message_id ?? data.id ?? evt.id ?? "").toString()
      : null;

    // In-reply-to (threading) — best-effort across payload/header shapes.
    const headers = (data.headers ?? {}) as Record<string, unknown>;
    const inReplyTo =
      (data.in_reply_to ?? headers["in-reply-to"] ?? headers["In-Reply-To"] ?? null);

    // Attachments — only map ones carrying a resolvable URL; base64-inline content
    // is NOT stored as a url (§13 honesty). Count-all preserved in meta.
    const rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
    const attachments: MessageAttachment[] = rawAttachments
      .map((a): MessageAttachment | null => {
        const o = (a ?? {}) as Record<string, unknown>;
        const url = (o.url ?? o.content_url ?? o.download_url ?? "").toString();
        if (!url) return null;
        return {
          url,
          mime: (o.content_type ?? o.mime ?? undefined) as string | undefined,
          name: (o.filename ?? o.name ?? undefined) as string | undefined,
        };
      })
      .filter((a): a is MessageAttachment => !!a);

    const receivedAt = (data.created_at ?? data.date ?? evt.created_at ?? null) as
      | string
      | null;

    // Provisional thread_key = counterparty (sender) address; the handler prefixes
    // it with tenant+channel once the tenant is resolved (§9).
    const counterparty = sender.address;

    return {
      thread_key: counterparty,
      channel_type: "email",
      direction: "inbound",
      status: "received",
      sender,
      recipients,
      subject: subject || null,
      body_text: bodyText || null,
      body_html: bodyHtml || null,
      attachments,
      provider_message_id: providerMessageId,
      in_reply_to_provider_id: inReplyTo ? inReplyTo.toString() : null,
      meta: {
        provider: "resend",
        raw_attachment_count: rawAttachments.length,
        to: recipients.map((r) => r.address),
      },
      sent_at: receivedAt,
    };
  },
};
registerInboundAdapter(emailInboundAdapter);
// SendGrid Inbound Parse: the same channel, qualified by provider (pure mapping in ./sendgrid-inbound.ts).
registerInboundAdapter(sendgridInboundAdapter);

// -----------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // SendGrid Inbound Parse posts multipart/form-data; Resend posts Svix-signed JSON.
  // The content type selects the arm before either reads the body.
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return await handleSendgridInboundParse(req, admin);
  }

  // -- 1. Svix HMAC verification. Fail closed if no secret resolves. ------------
  // Secret precedence: function env FIRST, then the platform-operator-managed
  // settings row (admin_app_settings key resend_webhook_secret, service-role read
  // — the same operator-manageable pattern the §200 resolver established). The
  // fallback exists because the Management API's function-secrets routes are not
  // available on every gateway, which would otherwise leave the secret
  // uninstallable outside the dashboard; a settings row rotates it in one write.
  // Secrets are a LIST: the account may run several webhooks (each signs with its
  // own secret) and any one match verifies. Sources: env + settings rows (single
  // `resend_webhook_secret` and array `resend_webhook_secrets`), deduped.
  const rawBody = await req.text();
  const secrets: string[] = [];
  const envSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (envSecret) secrets.push(envSecret);
  {
    const { data: rows } = await admin
      .from("admin_app_settings")
      .select("key, value")
      .in("key", ["resend_webhook_secret", "resend_webhook_secrets"]);
    for (const r of (rows ?? []) as Array<{ key: string; value: unknown }>) {
      if (r.key === "resend_webhook_secret" && typeof r.value === "string" && r.value.startsWith("whsec_")) secrets.push(r.value);
      if (r.key === "resend_webhook_secrets" && Array.isArray(r.value)) {
        for (const v of r.value) if (typeof v === "string" && v.startsWith("whsec_")) secrets.push(v);
      }
    }
  }
  const secretList = [...new Set(secrets)];
  if (!secretList.length) {
    console.error("[handle-inbound-email] no webhook secret configured (env or settings)");
    return new Response("webhook_not_configured", { status: 500 });
  }
  // Canonical Svix verification (shared with handle-resend-webhook): constant-time
  // v1 comparison, any-one-secret pass, and a timestamp tolerance window so an
  // old validly-signed event cannot be replayed forever (env-tunable; 300s is the
  // Svix receiver convention).
  const svixId = req.headers.get("svix-id") ?? "";
  const toleranceSeconds = Number(Deno.env.get("SVIX_TOLERANCE_SECONDS") ?? "") || 300;
  const verdict = await verifySvix({
    secrets: secretList,
    svixId,
    svixTimestamp: req.headers.get("svix-timestamp"),
    svixSignature: req.headers.get("svix-signature"),
    body: rawBody,
    toleranceSeconds,
  });
  if (!verdict.ok) {
    console.warn("[handle-inbound-email] svix_rejected", verdict.reason);
    return new Response("invalid_signature", { status: 401 });
  }

  let evt: unknown;
  try { evt = JSON.parse(rawBody); } catch {
    return new Response("invalid_json", { status: 400 });
  }

  // -- 2. Normalize THROUGH the registry (§32 — exercise the abstraction live). ----
  const adapter = getInboundAdapter("email");
  if (!adapter) {
    console.error("[handle-inbound-email] no_email_inbound_adapter_registered");
    return new Response(JSON.stringify({ ok: false, reason: "no_adapter" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const msg = adapter.onEvent(evt);

  // Deterministic retry identity when the provider payload carried no message id:
  // Svix redelivers one event with the SAME svix-id and body, so this hash is
  // stable across retries (dedup via uq_messages_provider_message_id) and distinct
  // across genuinely different events. Truthfully flagged in meta.
  let providerMessageId: string | null = msg.provider_message_id ?? null;
  let derivedProviderId = false;
  if (!providerMessageId) {
    providerMessageId = `resend-derived:${await sha256Hex(`${svixId}.${rawBody}`)}`;
    derivedProviderId = true;
  }
  const resendProviderMessageId: string = providerMessageId;

  return await persistResendInbound(admin, msg, resendProviderMessageId, derivedProviderId);
});

// -----------------------------------------------------------------------------
// SendGrid Inbound Parse arm (multipart/form-data). Replies to PAIGE's managed
// `<slug>@mail.paigeagent.ai` senders: the owner points SendGrid → Settings →
// Inbound Parse (host mail.paigeagent.ai) at this function's URL carrying the
// SENDGRID_INBOUND_PARSE_SECRET (basic-auth password or `?t=`). Steps:
//   1. Shared-secret gate — 503 when the secret is unset (nothing processed),
//      401 when the proof is missing or wrong. Constant-time compare.
//   2. Body bounded at SENDGRID_INBOUND_MAX_BYTES (413 above it), parsed as form.
//   3. Normalized THROUGH the registry (getInboundAdapter("email", "sendgrid")).
//   4. Routed on the SMTP envelope `to` only — no envelope, no routing (skip 200).
//      EVERY recipient is resolved (exact inbound_address; inbound_domain only for
//      non-PAIGE domains); each business gets its own row with only its own
//      recipient addresses (persistSendgridForTenant).
//   5. The same step helpers as the Resend arm, strictly: a connector or contact
//      read error, a failed insert or a failed draft-reply insert is a 503 so
//      SendGrid retries (a redelivery dedups and re-files a missing draft); an
//      unauthenticated From (no aligned SPF/DKIM pass) is kept but not linked to a
//      contact, not auto-drafted and not mirrored.
// Idempotency: provider_message_id = `sendgrid-inbound:<tenant>:<Message-ID>`.
// uq_messages_provider_message_id is GLOBAL, so the key is scoped to the resolved
// tenant — otherwise one business receiving a copy of an email (or a sender
// forging a Message-ID) would make another business's copy a "duplicate" and
// drop it. No Message-ID header → `derived:<sha256(from\nto\nsubject\ndate\ntext)>`
// (stable across SendGrid's retries of one email), flagged in meta.
// -----------------------------------------------------------------------------
async function readBodyWithLimit(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function jsonReply(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleSendgridInboundParse(req: Request, admin: Admin): Promise<Response> {
  const auth = authenticateInboundParse(req, Deno.env.get(SENDGRID_INBOUND_PARSE_SECRET_NAME));
  if (!auth.ok) {
    // The reason only — never the offered value or the configured one.
    console.warn("[handle-inbound-email] sendgrid_inbound_rejected", auth.reason);
    return jsonReply({ ok: false, reason: auth.reason }, auth.status);
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > SENDGRID_INBOUND_MAX_BYTES) {
    console.warn("[handle-inbound-email] sendgrid_inbound_too_large", { declared });
    return jsonReply({ ok: false, reason: "payload_too_large" }, 413);
  }
  const bytes = await readBodyWithLimit(req, SENDGRID_INBOUND_MAX_BYTES);
  if (!bytes) {
    console.warn("[handle-inbound-email] sendgrid_inbound_too_large", { streamed: true });
    return jsonReply({ ok: false, reason: "payload_too_large" }, 413);
  }
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return jsonReply({ ok: false, reason: "invalid_form" }, 400);
  }

  const adapter = getInboundAdapter("email", "sendgrid");
  if (!adapter) {
    console.error("[handle-inbound-email] no_sendgrid_inbound_adapter_registered");
    return jsonReply({ ok: false, reason: "no_adapter" }, 500);
  }
  const fields = sendgridFieldsFromForm(form);
  const msg = adapter.onEvent(fields);

  if (!(msg.recipients ?? []).length) {
    // Routing is on the SMTP envelope only; a header To is whatever the sender wrote (§9).
    console.warn("[handle-inbound-email] sendgrid_inbound_no_envelope_recipient");
    return jsonReply({ ok: false, reason: "no_envelope_recipient" }, 200);
  }

  const rfcMessageId = msg.provider_message_id ?? null;
  const identity = rfcMessageId ?? `derived:${await sha256Hex(fallbackIdentityInput(fields))}`;
  return await persistSendgridInbound(admin, msg, identity, !rfcMessageId);
}

/** PostgREST `ilike` treats `%`, `_` (SQL) and `*` (PostgREST) as wildcards; an address must match exactly. */
function ilikeExact(value: string): string | null {
  if (value.includes("*")) return null;
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * PAIGE's own sending domains. No business owns them, so mail there routes ONLY on an exact
 * inbound_address: a workspace admin can write `inbound_domain` on their own connector, and a
 * fallback on `mail.paigeagent.ai` would hand them every reply to an unknown or retired slug.
 */
function isPaigeDomain(domain: string): boolean {
  return /(^|\.)paigeagent\.ai$/i.test(domain);
}

type Connector = {
  id: string;
  tenant_id: string;
  from_address: string | null;
  from_name: string | null;
  reply_to: string | null;
};

const CONNECTOR_COLUMNS = "id, tenant_id, from_address, from_name, reply_to";

/** Strict (SendGrid) resolution of ONE envelope recipient. `failed` = a read error, retry-worthy. */
async function resolveConnectorStrict(admin: Admin, addr: string): Promise<{ connector: Connector | null; failed: boolean }> {
  const pattern = ilikeExact(addr);
  if (pattern === null) return { connector: null, failed: false };
  const { data: byAddr, error: byAddrErr } = await admin
    .from("channel_connectors")
    .select(CONNECTOR_COLUMNS)
    .eq("channel_type", "email")
    .eq("active", true)
    .ilike("inbound_address", pattern)
    .limit(1)
    .maybeSingle();
  if (byAddrErr) {
    console.error("[handle-inbound-email] connector_lookup_failed", byAddrErr.code ?? byAddrErr.message);
    return { connector: null, failed: true };
  }
  if (byAddr?.tenant_id) return { connector: byAddr as Connector, failed: false };
  const dom = addr.split("@")[1] ?? "";
  const domPattern = dom && !isPaigeDomain(dom) ? ilikeExact(dom) : null;
  if (domPattern === null) return { connector: null, failed: false };
  const { data: byDom, error: byDomErr } = await admin
    .from("channel_connectors")
    .select(CONNECTOR_COLUMNS)
    .eq("channel_type", "email")
    .eq("active", true)
    .ilike("inbound_domain", domPattern)
    .limit(1)
    .maybeSingle();
  if (byDomErr) {
    console.error("[handle-inbound-email] connector_lookup_failed", byDomErr.code ?? byDomErr.message);
    return { connector: null, failed: true };
  }
  return { connector: byDom?.tenant_id ? (byDom as Connector) : null, failed: false };
}

/** clients.created_by is NOT NULL: the tenant's owner, else the platform owner user. */
async function contactCreatedBy(admin: Admin, tenantId: string): Promise<string | null> {
  const { data: tenantRow } = await admin
    .from("tenants")
    .select("owner_user_id")
    .eq("id", tenantId)
    .maybeSingle();
  let createdBy: string | null = tenantRow?.owner_user_id ?? null;
  if (!createdBy) {
    const { data: owner } = await admin
      .from("app_settings_owner")
      .select("owner_email")
      .maybeSingle();
    if (owner?.owner_email) {
      const { data: ownerUsers } = await admin.auth.admin.listUsers();
      const match = ownerUsers?.users?.find(
        (u) => (u.email ?? "").toLowerCase() === owner.owner_email.toLowerCase(),
      );
      createdBy = match?.id ?? null;
    }
  }
  return createdBy;
}

/** A new contact for an unknown sender. A failed create is logged by the helper and writes nothing. */
async function createInboundContact(admin: Admin, tenantId: string, msg: NormalizedMessage, fromEmail: string): Promise<string | null> {
  const createdBy = await contactCreatedBy(admin, tenantId);
  if (!createdBy) {
    console.warn("[handle-inbound-email] no_created_by_for_tenant", { tenantId });
    return null;
  }
  const localPart = fromEmail.split("@")[0];
  const firstName = msg.sender?.display_name?.trim() || localPart || "Inbound";
  // The sender's address becomes the new contact's first (primary) email.
  const { data: created } = await insertClientWithAddresses(
    admin,
    {
      tenant_id: tenantId, // §9 — explicit; never inferred cross-tenant.
      created_by: createdBy,
      first_name: firstName,
      last_name: "",
      lifecycle_stage: "new_lead", // #172: 'lead' violates clients_lifecycle_stage_chk (23514)
      source: "inbound_email",
      status: "active",
      created_by_channel_type: "email", // #10 channel-of-origin
    },
    { email: fromEmail },
    "handle-inbound-email",
  );
  return created?.id ?? null;
}

/** §49 one-thread-per-contact; the per-address key only when no contact resolved (§13 honest tail). */
function inboundThreadKey(tenantId: string, contactId: string | null, fromEmail: string): string {
  return contactId
    ? `contact:${tenantId}:${contactId}`
    : `email:${tenantId}:${fromEmail}`;
}

type InsertResult = { kind: "inserted"; id: string } | { kind: "deduped" } | { kind: "error"; message: string; code: string | null };

/** Step 5: the inbound public.messages row (tenant_id omitted → set_message_tenant()). */
async function insertInboundMessage(
  admin: Admin,
  row: {
    msg: NormalizedMessage;
    threadKey: string;
    contactId: string | null;
    connectorId: string;
    providerMessageId: string;
    meta: Record<string, unknown>;
  },
): Promise<InsertResult> {
  const { msg } = row;
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      // tenant_id intentionally OMITTED — set_message_tenant() derives it from connector_id.
      thread_key: row.threadKey,
      contact_id: row.contactId,
      connector_id: row.connectorId,
      channel_type: "email",
      direction: "inbound",
      status: "received",
      sender: msg.sender ?? null,
      recipients: msg.recipients ?? [],
      subject: msg.subject ?? null,
      body_text: msg.body_text ?? null,
      body_html: msg.body_html ?? null,
      attachments: msg.attachments ?? [],
      provider_message_id: row.providerMessageId,
      in_reply_to_provider_id: msg.in_reply_to_provider_id ?? null,
      meta: row.meta,
      sent_at: msg.sent_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertErr) {
    // Unique violation on provider_message_id = webhook retry already processed.
    if (insertErr.code === "23505") return { kind: "deduped" };
    console.error("[handle-inbound-email] messages_insert_error", insertErr);
    return { kind: "error", message: insertErr.message, code: insertErr.code ?? null };
  }
  return { kind: "inserted", id: inserted!.id as string };
}

/**
 * Step 5b: the ONE shared inbound-intelligence engine (#1140 two-mailbox pilot) + classification.
 * Both are best-effort and NON-BLOCKING: a failure must never drop or delay the inbound row that
 * already landed — the next sync tick re-runs the classification side of the engine.
 */
async function runInboxIntelligence(admin: Admin, messageId: string, connectorId: string, msg: NormalizedMessage): Promise<void> {
  try {
    await admin.rpc("record_inbound_message_intelligence", { _message_id: messageId });
  } catch (intelErr) {
    console.warn("[handle-inbound-email] intelligence_engine_deferred", (intelErr as Error)?.message);
  }
  try {
    const { data: connectorRow } = await admin.from("channel_connectors")
      .select("mailbox_class").eq("id", connectorId).maybeSingle();
    if (connectorRow?.mailbox_class) {
      await classifyAndRecordMessage({
        admin: admin as unknown as ClassifyAdmin,
        messageId,
        mailboxClass: connectorRow.mailbox_class === "personal" ? "personal" : "shared_support",
        subject: (msg.subject as string | null) ?? null,
        fromAddress: (msg.sender?.address as string | null) ?? null,
        snippet: ((msg.body_text as string | null) ?? "").slice(0, 4000),
      });
    }
  } catch (classifyErr) {
    console.warn("[handle-inbound-email] classification_deferred", (classifyErr as Error)?.message);
  }
}

/**
 * Step 6: file the comms-draft-reply action (§8 action bus). Returns false when it was not filed.
 * tenant_id is set EXPLICITLY — paige_actions has NO tenant-deriving trigger and its column is
 * NOT NULL. Client Experience files -> Owner Ops drafts -> coach approves (autonomy 'confirm').
 */
async function fileDraftReplyAction(
  admin: Admin,
  a: {
    tenantId: string;
    connector: Connector;
    contactId: string | null;
    threadKey: string;
    messageId: string;
    msg: NormalizedMessage;
    fromEmail: string;
  },
): Promise<boolean> {
  const { tenantId, connector, contactId, threadKey, messageId, msg, fromEmail } = a;
  try {
    // §38 sender identity: tenant_sender_identity() is PRIMARY; the connector's own
    // from_address is the fallback/override. This precedence MUST match send-message
    // exactly (identity primary → connector fallback) — the value we store here is what
    // the coach reviews on the draft, and send-message recomputes the actual from on
    // approval. If the two orderings disagree, the coach approves one sender and the
    // client receives another (silent swap). Kept identical so reviewed == sent.
    const { data: senderIdentity } = await admin.rpc("tenant_sender_identity", {
      _tenant_id: tenantId,
    });
    const identity = (senderIdentity ?? {}) as Record<string, unknown>;
    const replyFromAddress =
      (identity.from_address as string | undefined) ||
      connector.from_address ||
      connector.reply_to ||
      null;

    // Recent thread context for the drafter (last few messages, tenant-scoped).
    const { data: recent } = await admin
      .from("messages")
      .select("direction, sender, recipients, subject, body_text, sent_at")
      .eq("tenant_id", tenantId)
      .eq("thread_key", threadKey)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(10);
    const lastMessages = (recent ?? []).slice().reverse();

    const { error: actionErr } = await admin.from("paige_actions").insert({
      tenant_id: tenantId, // §9 — explicit; NOT NULL, no trigger.
      action_kind: "comms-draft-reply",
      from_department: "client_experience",
      to_department: "owner_ops",
      status: "filed",
      autonomy_lane: "confirm",
      contact_id: contactId,
      title: "Draft reply to inbound message",
      summary: msg.subject ? `Re: ${msg.subject}` : "Inbound email reply",
      created_by_agent: "handle-inbound-email",
      payload: {
        channel_type: "email",
        connector_id: connector.id,
        thread_key: threadKey,
        message_id: messageId,
        inbound_provider_message_id: msg.provider_message_id,
        reply_from_address: replyFromAddress,
        reply_to_address: fromEmail,
        subject: msg.subject,
        last_messages: lastMessages,
      },
    });
    if (actionErr) {
      // Non-fatal: the inbound message is safely persisted; the action can be
      // re-filed. Report honestly, do not fake success (§13).
      console.error("[handle-inbound-email] action_insert_error", actionErr);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[handle-inbound-email] action_file_exception", (e as Error).message);
    return false;
  }
}

/**
 * Step 7: legacy paige_conversations dual-write + n8n bridge (GUARDED, §37). Kept for ONE release
 * so existing n8n CS-Triage consumers keep their feed. Fully NON-BLOCKING.
 */
async function mirrorLegacyConversation(
  admin: Admin,
  m: {
    tenantId: string;
    contactId: string | null;
    msg: NormalizedMessage;
    fromEmail: string;
    recipientAddresses: string[];
    sourceMessageId: string | null | undefined;
  },
): Promise<void> {
  if (!LEGACY_DUAL_WRITE) return;
  const { tenantId, contactId, msg, fromEmail, recipientAddresses } = m;
  try {
    const legacyBody = msg.body_text || msg.body_html || "";
    const { data: convo, error: legacyErr } = await admin
      .from("paige_conversations")
      .insert({
        channel: "email",
        // Same defect as the SMS mirror (C-7): the tenant was written into
        // `metadata` but not onto the column RLS scopes by, so the row was
        // untenanted and reachable by the admin of every other tenant.
        tenant_id: tenantId,
        contact_id: contactId,
        direction: "inbound",
        subject: msg.subject ?? "",
        body: legacyBody,
        source_message_id: m.sourceMessageId,
        status: "new",
        metadata: { from: fromEmail, to: recipientAddresses, tenant_id: tenantId },
      })
      .select("id")
      .single();
    if (legacyErr) {
      // 23505 = already mirrored; anything else logged non-fatally.
      if (legacyErr.code !== "23505") {
        console.warn("[handle-inbound-email] legacy_convo_insert_warn", legacyErr.message);
      }
    } else if (convo?.id) {
      fireAndForgetBridge("customer_support_intake", {
        conversation_id: convo.id,
        contact_email: fromEmail,
        channel: "email",
        subject: msg.subject ?? "",
        body: legacyBody,
      });
    }
  } catch (e) {
    console.warn("[handle-inbound-email] legacy_dual_write_exception", (e as Error).message);
  }
}

// -----------------------------------------------------------------------------
// Resend arm, steps 3–7, in their original order and with their original
// responses: raw ilike, a lookup error reads as "no connector", the first
// matching recipient wins, a failed action insert is logged and the reply is 200.
// -----------------------------------------------------------------------------
async function persistResendInbound(
  admin: Admin,
  msg: NormalizedMessage,
  providerMessageId: string,
  derivedProviderId: boolean,
): Promise<Response> {
  const fromEmail = msg.sender?.address ?? "";
  if (!fromEmail || (!msg.body_text && !msg.body_html)) {
    return new Response(JSON.stringify({ ok: false, reason: "missing_fields" }), { status: 200 });
  }

  // -- 3. Resolve TENANT from the recipient -> channel_connectors (§9). -----------
  // The routing key is the address the mail ARRIVED at (a recipient), NEVER the body.
  const recipientAddresses = (msg.recipients ?? []).map((r) => r.address).filter(Boolean);
  let connector: Connector | null = null;

  // 3a. Try each recipient as an exact inbound_address (case-insensitive).
  for (const addr of recipientAddresses) {
    const { data: byAddr } = await admin
      .from("channel_connectors")
      .select(CONNECTOR_COLUMNS)
      .eq("channel_type", "email")
      .eq("active", true)
      .ilike("inbound_address", addr)
      .limit(1)
      .maybeSingle();
    if (byAddr?.tenant_id) { connector = byAddr as Connector; break; }
  }

  // 3b. Fall back to matching the recipient's DOMAIN against inbound_domain.
  if (!connector) {
    const domains = Array.from(
      new Set(recipientAddresses.map((a) => a.split("@")[1]).filter(Boolean)),
    );
    for (const dom of domains) {
      const { data: byDom } = await admin
        .from("channel_connectors")
        .select(CONNECTOR_COLUMNS)
        .eq("channel_type", "email")
        .eq("active", true)
        .ilike("inbound_domain", dom)
        .limit(1)
        .maybeSingle();
      if (byDom?.tenant_id) { connector = byDom as Connector; break; }
    }
  }

  // No connector => we cannot know the tenant. NEVER guess (§9). Skip + log.
  if (!connector) {
    console.warn("[handle-inbound-email] no_connector_for_recipient", {
      recipients: recipientAddresses,
      provider_message_id: msg.provider_message_id,
    });
    return new Response(
      JSON.stringify({ ok: false, reason: "no_connector", recipients: recipientAddresses }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const tenantId = connector.tenant_id;

  // -- 4. Upsert the contact in public.clients, tenant-scoped (§9). ---------------
  // A sender writing from ANY of a contact's addresses is that contact.
  let contactId: string | null = await findClientIdByAddress(admin, tenantId, "email", fromEmail, "handle-inbound-email");
  if (!contactId) contactId = await createInboundContact(admin, tenantId, msg, fromEmail);

  // -- 5. Insert the inbound public.messages row. ---------------------------------
  const threadKey = inboundThreadKey(tenantId, contactId, fromEmail);
  const inserted = await insertInboundMessage(admin, {
    msg,
    threadKey,
    contactId,
    connectorId: connector.id,
    providerMessageId,
    meta: derivedProviderId
      ? { ...(msg.meta ?? {}), provider_message_id_derived: true }
      : (msg.meta ?? {}),
  });
  if (inserted.kind === "deduped") {
    return new Response(JSON.stringify({ ok: true, deduped: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (inserted.kind === "error") {
    return new Response(JSON.stringify({ ok: false, error: inserted.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const messageId = inserted.id;

  // -- 5b. Inbound intelligence + classification (best-effort). -------------------
  await runInboxIntelligence(admin, messageId, connector.id, msg);

  // -- 6. File the comms-draft-reply action (a failure is logged, non-fatal). -----
  await fileDraftReplyAction(admin, { tenantId, connector, contactId, threadKey, messageId, msg, fromEmail });

  // -- 7. Legacy paige_conversations dual-write + n8n bridge. ---------------------
  await mirrorLegacyConversation(admin, {
    tenantId, contactId, msg, fromEmail, recipientAddresses, sourceMessageId: msg.provider_message_id,
  });

  return new Response(JSON.stringify({ ok: true, message_id: messageId, tenant_id: tenantId }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// SendGrid arm, per business. One email can be addressed (To/Cc/Bcc) to several
// businesses' managed addresses; each resolved business gets its own row holding
// ONLY its own recipient addresses (a Bcc to another business is never revealed),
// keyed `sendgrid-inbound:<tenant>:<identity>`, and stands or falls on its own.
// -----------------------------------------------------------------------------
type TenantOutcome =
  | { tenant_id: string; outcome: "persisted"; message_id: string }
  | { tenant_id: string; outcome: "deduped"; message_id: string | null }
  | { tenant_id: string; outcome: "transient_failure"; reason: string }
  | { tenant_id: string; outcome: "rejected"; reason: string };

/**
 * On a redelivery (23505): if the first attempt landed the message but never filed its draft
 * reply (crash, or the action insert failed and we answered 503), file it now. A check-then-insert:
 * SendGrid redelivers one post at a time, so two concurrent re-files are not expected (§13 — not a
 * database-enforced guarantee).
 */
async function ensureDraftReplyFiled(
  admin: Admin,
  tenantId: string,
  connector: Connector,
  providerMessageId: string,
  msg: NormalizedMessage,
  fromEmail: string,
): Promise<{ ok: boolean; messageId: string | null }> {
  const { data: existing, error: readErr } = await admin
    .from("messages")
    .select("id, contact_id, thread_key")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (readErr || !existing?.id) {
    if (readErr) console.error("[handle-inbound-email] dedup_message_read_failed", readErr.code ?? readErr.message);
    return { ok: !readErr, messageId: null };
  }
  const messageId = existing.id as string;
  const { data: filed, error: actionReadErr } = await admin
    .from("paige_actions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("action_kind", "comms-draft-reply")
    .eq("payload->>message_id", messageId)
    .limit(1)
    .maybeSingle();
  if (actionReadErr) {
    console.error("[handle-inbound-email] dedup_action_read_failed", actionReadErr.code ?? actionReadErr.message);
    return { ok: false, messageId };
  }
  if (filed?.id) return { ok: true, messageId };
  const ok = await fileDraftReplyAction(admin, {
    tenantId,
    connector,
    contactId: (existing.contact_id as string | null) ?? null,
    threadKey: existing.thread_key as string,
    messageId,
    msg,
    fromEmail,
  });
  return { ok, messageId };
}

async function persistSendgridForTenant(
  admin: Admin,
  msg: NormalizedMessage,
  g: { connector: Connector; addresses: string[]; identity: string; derived: boolean },
): Promise<TenantOutcome> {
  const tenantId = g.connector.tenant_id;
  const fromEmail = msg.sender?.address ?? "";
  const providerMessageId = `sendgrid-inbound:${tenantId}:${g.identity}`;
  const unauthenticated = (msg.meta ?? {}).sender_unauthenticated === true;
  // This business's view of the message: its own recipient addresses only.
  const own: NormalizedMessage = {
    ...msg,
    recipients: g.addresses.map((address) => ({ address })),
  };
  const meta: Record<string, unknown> = {
    ...(msg.meta ?? {}),
    to: g.addresses,
    ...(g.derived ? { provider_message_id_derived: true } : {}),
  };

  // -- 4. Contact. An unauthenticated From (no aligned SPF or DKIM pass) is never linked to,
  //    or minted as, a contact by its claimed address, and gets no auto-drafted reply: a
  //    forged From must not land in a real client's thread. The message is still kept.
  let contactId: string | null = null;
  if (!unauthenticated) {
    const found = await lookupClientIdByAddress(admin, tenantId, "email", fromEmail, "handle-inbound-email");
    if (found.error) return { tenant_id: tenantId, outcome: "transient_failure", reason: "contact_lookup_failed" };
    contactId = found.id ?? await createInboundContact(admin, tenantId, msg, fromEmail);
  }
  const threadKey = unauthenticated
    ? `email-unverified:${tenantId}:${fromEmail}`
    : inboundThreadKey(tenantId, contactId, fromEmail);

  // -- 5. The message row.
  const inserted = await insertInboundMessage(admin, {
    msg: own,
    threadKey,
    contactId,
    connectorId: g.connector.id,
    providerMessageId,
    meta,
  });
  if (inserted.kind === "error") {
    // A data or integrity violation (SQLSTATE class 22/23; 23505 is the dedup above) will fail the
    // same way on every redelivery, so retrying it would only make SendGrid redeliver the whole post
    // to every business for days. It is logged and acknowledged; anything else is retried.
    if (inserted.code && /^2[23]/.test(inserted.code)) {
      return { tenant_id: tenantId, outcome: "rejected", reason: `message_insert_rejected_${inserted.code}` };
    }
    return { tenant_id: tenantId, outcome: "transient_failure", reason: "message_insert_failed" };
  }
  if (inserted.kind === "deduped") {
    if (unauthenticated) return { tenant_id: tenantId, outcome: "deduped", message_id: null };
    const refiled = await ensureDraftReplyFiled(admin, tenantId, g.connector, providerMessageId, own, fromEmail);
    return refiled.ok
      ? { tenant_id: tenantId, outcome: "deduped", message_id: refiled.messageId }
      : { tenant_id: tenantId, outcome: "transient_failure", reason: "draft_reply_refile_failed" };
  }
  const messageId = inserted.id;

  // -- 6. The draft reply BEFORE the best-effort work, so a crash in classification cannot
  //    lose it; a failed insert is a 5xx, and the redelivery dedups and re-files it.
  if (!unauthenticated) {
    const filed = await fileDraftReplyAction(admin, {
      tenantId, connector: g.connector, contactId, threadKey, messageId, msg: own, fromEmail,
    });
    if (!filed) return { tenant_id: tenantId, outcome: "transient_failure", reason: "draft_reply_file_failed" };
  }

  // -- 5b. Intelligence + classification (best-effort).
  await runInboxIntelligence(admin, messageId, g.connector.id, own);

  // -- 7. Legacy mirror, keyed on the SAME business-scoped id (source_message_id is globally
  //    unique too), and not for an unauthenticated sender: the n8n intake must not act on a
  //    forged From.
  if (!unauthenticated) {
    await mirrorLegacyConversation(admin, {
      tenantId, contactId, msg: own, fromEmail, recipientAddresses: g.addresses, sourceMessageId: providerMessageId,
    });
  }
  return { tenant_id: tenantId, outcome: "persisted", message_id: messageId };
}

async function persistSendgridInbound(
  admin: Admin,
  msg: NormalizedMessage,
  identity: string,
  derived: boolean,
): Promise<Response> {
  const fromEmail = msg.sender?.address ?? "";
  const rawAttachments = Number((msg.meta ?? {}).raw_attachment_count ?? 0);
  if (!fromEmail || (!msg.body_text && !msg.body_html && !(rawAttachments > 0))) {
    console.warn("[handle-inbound-email] sendgrid_inbound_missing_fields");
    return jsonReply({ ok: false, reason: "missing_fields" }, 200);
  }

  // -- 3. Resolve EVERY envelope recipient (§9), grouped by business.
  const recipientAddresses = Array.from(new Set((msg.recipients ?? []).map((r) => r.address).filter(Boolean)));
  const groups = new Map<string, { connector: Connector; addresses: string[] }>();
  let lookupFailed = false;
  const unresolved: string[] = [];
  for (const addr of recipientAddresses) {
    const r = await resolveConnectorStrict(admin, addr);
    if (r.failed) { lookupFailed = true; continue; }
    if (!r.connector) { unresolved.push(addr); continue; }
    const g = groups.get(r.connector.tenant_id);
    if (g) g.addresses.push(addr);
    else groups.set(r.connector.tenant_id, { connector: r.connector, addresses: [addr] });
  }

  if (!groups.size) {
    if (lookupFailed) return jsonReply({ ok: false, reason: "connector_lookup_failed" }, 503);
    console.warn("[handle-inbound-email] no_connector_for_recipient", { recipients: recipientAddresses });
    return jsonReply({ ok: false, reason: "no_connector" }, 200);
  }

  const results: TenantOutcome[] = [];
  for (const g of groups.values()) {
    results.push(await persistSendgridForTenant(admin, msg, { ...g, identity, derived }));
  }
  if (unresolved.length) console.warn("[handle-inbound-email] sendgrid_inbound_unresolved_recipients", { count: unresolved.length });

  // Any transient failure → 503 so SendGrid redelivers; the businesses that landed dedup.
  const transient = lookupFailed || results.some((r) => r.outcome === "transient_failure");
  return jsonReply(
    { ok: !transient, ...(transient ? { reason: lookupFailed ? "connector_lookup_failed" : "transient_failure" } : {}), results },
    transient ? 503 : 200,
  );
}
