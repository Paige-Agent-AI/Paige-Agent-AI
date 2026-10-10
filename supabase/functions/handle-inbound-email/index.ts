// Resend inbound email webhook receiver — Comms Slice C-1 (unified inbox).
//
// Flow (doctrine-annotated):
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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
import { findClientIdByAddress, insertClientWithAddresses } from "../_shared/contact-methods.ts";
import { classifyAndRecordMessage, type ClassifyAdmin } from "../_shared/inbox-intelligence/classify-message.ts";
import {
  getInboundAdapter,
  registerInboundAdapter,
  type InboundChannelAdapter,
  type MessageAttachment,
  type MessageParty,
  type NormalizedMessage,
} from "../_shared/channel-adapters.ts";

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
    const providerMessageId = (
      data.message_id ?? data.id ?? evt.id ?? crypto.randomUUID()
    ).toString();

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

// -----------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

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
  try {
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTs = req.headers.get("svix-timestamp") ?? "";
    const svixSig = req.headers.get("svix-signature") ?? "";
    const signedContent = `${svixId}.${svixTs}.${rawBody}`;
    // Any ONE configured secret verifying is enough (multi-webhook accounts).
    const passed = await (async () => {
      for (const s of secretList) {
        try {
          const secretBytes = s.startsWith("whsec_")
            ? Uint8Array.from(atob(s.slice(6)), (c) => c.charCodeAt(0))
            : new TextEncoder().encode(s);
          const key = await crypto.subtle.importKey(
            "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
          );
          const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
          const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
          if (svixSig.split(" ").some((part) => part.split(",")[1] === sigB64)) return true;
        } catch { /* try the next secret */ }
      }
      return false;
    })();
    if (!passed) {
      console.warn("[handle-inbound-email] svix_signature_invalid");
      return new Response("invalid_signature", { status: 401 });
    }
  } catch (e) {
    console.error("[handle-inbound-email] signature_check_error", (e as Error).message);
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

  const fromEmail = msg.sender?.address ?? "";
  if (!fromEmail || (!msg.body_text && !msg.body_html)) {
    return new Response(JSON.stringify({ ok: false, reason: "missing_fields" }), { status: 200 });
  }

  // -- 3. Resolve TENANT from the recipient -> channel_connectors (§9). -----------
  // The routing key is the address the mail ARRIVED at (a recipient), NEVER the body.
  const recipientAddresses = (msg.recipients ?? []).map((r) => r.address).filter(Boolean);
  let connector:
    | { id: string; tenant_id: string; from_address: string | null; from_name: string | null; reply_to: string | null }
    | null = null;

  // 3a. Try each recipient as an exact inbound_address (case-insensitive).
  for (const addr of recipientAddresses) {
    const { data: byAddr } = await admin
      .from("channel_connectors")
      .select("id, tenant_id, from_address, from_name, reply_to")
      .eq("channel_type", "email")
      .eq("active", true)
      .ilike("inbound_address", addr)
      .limit(1)
      .maybeSingle();
    if (byAddr?.tenant_id) { connector = byAddr; break; }
  }

  // 3b. Fall back to matching the recipient's DOMAIN against inbound_domain.
  if (!connector) {
    const domains = Array.from(
      new Set(recipientAddresses.map((a) => a.split("@")[1]).filter(Boolean)),
    );
    for (const dom of domains) {
      const { data: byDom } = await admin
        .from("channel_connectors")
        .select("id, tenant_id, from_address, from_name, reply_to")
        .eq("channel_type", "email")
        .eq("active", true)
        .ilike("inbound_domain", dom)
        .limit(1)
        .maybeSingle();
      if (byDom?.tenant_id) { connector = byDom; break; }
    }
  }

  // No connector => we cannot know the tenant. NEVER guess (§9). Skip + log.
  // This is the INERT state until a tenant provisions an inbound email connector (§13).
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
  if (!contactId) {
    // clients.created_by is NOT NULL. Use the tenant's owner; fall back to the
    // platform owner user only if the tenant has no owner set.
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
    if (createdBy) {
      const localPart = fromEmail.split("@")[0];
      const firstName = msg.sender?.display_name?.trim() || localPart || "Inbound";
      // The sender's address becomes the new contact's first (primary) email. A failed create,
      // or one whose address cannot be attached, is logged by the helper and writes nothing.
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
      contactId = created?.id ?? null;
    } else {
      console.warn("[handle-inbound-email] no_created_by_for_tenant", { tenantId });
    }
  }

  // -- 5. Insert the inbound public.messages row (tenant_id omitted -> trigger). ---
  // §49 one-thread-per-contact: key on the CONTACT so this inbound coalesces into the same thread
  // as that person's voice/sms/outbound messages. Only when no contact resolved (§13 honest tail)
  // do we fall back to the old per-address email key.
  const threadKey = contactId
    ? `contact:${tenantId}:${contactId}`
    : `email:${tenantId}:${fromEmail}`;
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      // tenant_id intentionally OMITTED — set_message_tenant() derives it from connector_id.
      thread_key: threadKey,
      contact_id: contactId,
      connector_id: connector.id,
      channel_type: "email",
      direction: "inbound",
      status: "received",
      sender: msg.sender ?? null,
      recipients: msg.recipients ?? [],
      subject: msg.subject ?? null,
      body_text: msg.body_text ?? null,
      body_html: msg.body_html ?? null,
      attachments: msg.attachments ?? [],
      provider_message_id: msg.provider_message_id ?? null,
      in_reply_to_provider_id: msg.in_reply_to_provider_id ?? null,
      meta: msg.meta ?? {},
      sent_at: msg.sent_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr) {
    // Unique violation on provider_message_id = webhook retry already processed.
    if (insertErr.code === "23505") {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("[handle-inbound-email] messages_insert_error", insertErr);
    return new Response(JSON.stringify({ ok: false, error: insertErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const messageId = inserted!.id as string;

  // -- 5b. The ONE shared inbound-intelligence engine (#1140 two-mailbox pilot). ----------
  // Both inbound paths (Resend here, the Gmail sync for a shared connector) call the same
  // service RPC: shared_support connectors get case upsert + follow-up cancellation; personal
  // connectors are refused-by-construction inside it (no cases ever open on a private mailbox).
  // Best-effort and NON-BLOCKING: a failure here must never drop or delay the inbound row that
  // already landed — the next sync tick re-runs the classification side of the engine.
  try {
    await admin.rpc("record_inbound_message_intelligence", { _message_id: messageId });
  } catch (intelErr) {
    console.warn("[handle-inbound-email] intelligence_engine_deferred", (intelErr as Error)?.message);
  }
  // Classification rides the SAME shared helper the Gmail sync uses (the classify
  // lane of the model router): the shared support mailbox gets intent + risk tier
  // + auto labels exactly like the personal one. Best-effort and non-blocking —
  // the sync tick's backfill sweep retries what fails here.
  try {
    const { data: connectorRow } = await admin.from("channel_connectors")
      .select("mailbox_class").eq("id", connector.id).maybeSingle();
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

  // -- 6. File the comms-draft-reply action (§8 action bus). ----------------------
  // tenant_id is set EXPLICITLY here — paige_actions has NO tenant-deriving trigger
  // and its column is NOT NULL. Client Experience files -> Owner Ops drafts ->
  // coach approves (autonomy 'confirm'). email-composer + the worker + the
  // trg_comms_file_outbound_draft trigger produce the outbound draft row.
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
    }
  } catch (e) {
    console.error("[handle-inbound-email] action_file_exception", (e as Error).message);
  }

  // -- 7. Legacy paige_conversations dual-write + n8n bridge (GUARDED, §37). -------
  // Kept for ONE release so existing n8n CS-Triage consumers keep their feed. Fully
  // NON-BLOCKING: any failure here is logged and never affects the response.
  // Retires as a follow-up once those consumers read from the messages inbox.
  if (LEGACY_DUAL_WRITE) {
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
          source_message_id: msg.provider_message_id,
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

  return new Response(JSON.stringify({ ok: true, message_id: messageId, tenant_id: tenantId }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});