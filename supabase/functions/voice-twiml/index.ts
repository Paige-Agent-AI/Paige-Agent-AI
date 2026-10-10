import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
// #140 Slice A3 — the voice-twiml webhook. This is the URL the per-tenant TwiML
// Application's VoiceUrl already targets (see _shared/twilio.ts defaultVoiceTwimlUrl):
// ${SUPABASE_URL}/functions/v1/voice-twiml. Twilio POSTs application/x-www-form-urlencoded
// here on BOTH directions and we answer with TwiML:
//   • OUTBOUND — a browser Device did device.connect({params:{To}}). Twilio hits this with
//     From="client:<tenantId>.<userId>" (the AUTHENTICATED identity from the access-token
//     grant) + To=<dialed PSTN number>. We resolve the tenant FROM the identity, look up
//     that tenant's OWNED caller-ID number, and <Dial><Number> the callee presenting it.
//   • INBOUND — the tenant's Twilio number rang. Twilio hits this with To=<tenant number>
//     + From=<external caller>. We resolve the tenant that OWNS the To number, then
//     <Dial><Client> the tenant's registered browser seat(s).
//
// DOCTRINE
//  §9  Tenant isolation on BOTH directions, from a NON-forgeable field, never a trusted body:
//        - outbound tenant = the authenticated `client:` identity Twilio derived from the JWT
//          grant (the browser cannot forge another tenant's identity — the token is scoped);
//        - inbound tenant  = the OWNER of the dialed To number (tenant_phone_numbers), so a
//          caller is only ever bridged to seats of the tenant whose number they dialed. A
//          caller can NEVER reach another tenant's client.
//  §53 PHASE 3 — the OPERATOR (God/Super-Admin) scope runs on the platform MASTER account and is
//      TENANT-LESS. OUTBOUND: a `client:operator.<userId>` caller presents the MASTER caller-id
//      (operatorVoiceCallerId, env) — never a tenant number — intercepted BEFORE the tenant parse.
//      INBOUND: a call to the master number (owned by NO tenant) rings the operator seat(s)
//      (super_admin/platform_admin), never a tenant. Operator call rows write ONLY to
//      operator_messages/operator_conversations (is_platform_owner()-gated, NO tenant_id) — the two
//      scopes never mix (§9/§51). No co-pilot fork on the operator scope (that is tenant STT).
//  §13 Honest degrade — no owned caller-ID / unknown number / no seat available speaks a plain
//      message and hangs up. Never a dial with a bogus callerId, never a silent 500, never a
//      fabricated bridge. On the operator scope: no configured operator caller-id → the same honest
//      spoken degrade (owed secret TWILIO_OPERATOR_CALLER_ID), never a bogus dial.
//  §18 verify_jwt=false (Twilio can't present a Supabase JWT). Reuses the ONE Twilio seam's
//      canonical validateTwilioSignature (no fourth inline copy) + the ONE phone normalizer.
//  §32 The request-shaping logic (direction, identity parse, TwiML) is PURE + unit-smoked
//      (./twiml.ts + scripts/voice-twiml-smoke.mts). Every degrade path LOGS loudly.
//  §3  Every spoken <Say> is plain and jargon-free (copy lives in ./twiml.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateTwilioWebhook } from "../_shared/twilio-webhook-auth.ts";
import { deriveOperatorVoiceWebhookSecret, operatorVoiceCallerId } from "../_shared/operator-twilio.ts";
import { normalizePhone } from "../_shared/pre-send-pipeline.ts";
import { findClientIdByAddress } from "../_shared/contact-methods.ts";
import { mintStreamToken } from "../_shared/voice-stream-token.ts";
import {
  buildIdentity,
  buildInboundTwiml,
  buildOperatorIdentity,
  buildOutboundTwiml,
  buildSayHangupTwiml,
  buildStreamStart,
  classifyDirection,
  isOperatorClientCaller,
  parseClientCaller,
  parseOperatorClientCaller,
  resolveStatusCallbackUrl,
  voiceThreadKey,
  CALL_UNAVAILABLE_MESSAGE,
  NO_CALLER_ID_MESSAGE,
  OUTBOUND_NO_NUMBER_MESSAGE,
  UNKNOWN_NUMBER_MESSAGE,
  VOICEMAIL_UNAVAILABLE_MESSAGE,
} from "./twiml.ts";

/**
 * #140 B1 — GATED live-call co-pilot fork. Returns the <Start><Stream> XML that forks call audio
 * to paige-stt, or "" (DEFAULT OFF) so the TwiML is byte-identical to A3 until co-pilot is
 * activated. Emits the stream ONLY when BOTH VOICE_STT_STREAM_URL (the paige-stt wss URL) AND
 * VOICE_STREAM_SECRET are set — never an UNauthenticated stream: if the URL is set but the secret
 * is missing we skip the fork and log loudly (§13) rather than expose an open media endpoint.
 * The token encodes { tenantId, callSid } and is HMAC-signed; paige-stt derives the tenant from
 * it (§9), never from a raw parameter. tenantId here is the SAME non-forgeable value already
 * resolved for the bridge (outbound = authenticated client identity, inbound = number owner).
 */
async function buildCoPilotStreamXml(
  admin: Admin,
  tenantId: string,
  callSid: string,
  counterpartyPhone: string,
  precomputedContactId: string | null | undefined,
  /**
   * Did we VERIFY a signature on the request asking for this fork? Checked FIRST — see
   * below. REQUIRED, with no default, so a call site that forgets it fails to COMPILE.
   * An earlier revision wrote that sentence and then defaulted it to `false` on the very
   * next line, which made it optional: a forgetful caller would have compiled cleanly,
   * silently lost the co-pilot, and logged "unsigned request" on a request that WAS
   * signed. Fail-closed is the right runtime posture and is not a substitute for the
   * compiler catching it.
   */
  requestAuthenticated: boolean,
): Promise<string> {
  // §9 — THE SAME GATE AS THE statusCallback SECRET, FOR THE SAME REASON.
  // The minted token travels in the SAME response body, from the SAME `verify_jwt = false`
  // endpoint, keyed off the SAME attacker-supplied fields. `paige-stt` is also
  // `verify_jwt = false` and this token is its ONLY gate — it derives the tenant from the
  // verified payload. So handing one to an unauthenticated caller lets them open the media
  // socket AS that tenant and drive the co-pilot.
  //
  // Inbound is the cheap path: the tenant resolves from the DIALED NUMBER, which is public.
  // An anonymous POST naming a tenant's published phone number was enough. The token payload
  // is base64url, not encrypted, so tenantId/callSid/contactId are readable in it too.
  //
  // This is the defect that was fixed for the callback secret and NOT carried the ninety
  // lines down to here. Stated plainly so the next reader sees the rule rather than the
  // instance: on this endpoint, nothing secret or capability-bearing leaves in a response to
  // a request we did not authenticate.
  //
  // Requests now authenticate with either Twilio's master signature (operator calls) or the
  // active tenant's stamped webhook secret (tenant subaccount calls). The caller-to-tenant
  // binding is checked before this function is reached, so the token remains fail-closed
  // without disabling configured tenant co-pilot streams.
  if (!requestAuthenticated) {
    if (Deno.env.get("VOICE_STT_STREAM_URL")) {
      console.warn(
        "[voice-twiml] unauthenticated request — NOT minting a tenant-scoped co-pilot stream token.",
      );
    }
    return "";
  }
  const streamUrl = Deno.env.get("VOICE_STT_STREAM_URL") ?? "";
  if (!streamUrl) return ""; // co-pilot not activated — default OFF, changes nothing
  const secret = Deno.env.get("VOICE_STREAM_SECRET") ?? "";
  if (!secret) {
    console.warn("[voice-twiml] VOICE_STT_STREAM_URL set but VOICE_STREAM_SECRET missing — NOT forking an unauthenticated stream");
    return "";
  }
  if (!tenantId || !callSid) {
    console.warn("[voice-twiml] co-pilot fork skipped — missing tenantId/callSid", { hasTenant: !!tenantId, hasCall: !!callSid });
    return "";
  }
  try {
    // §9/§13 — resolve the call's CLIENT counterparty phone → a TENANT-SCOPED contact id so the
    // co-pilot can link commitments/at-risk flags to the client AND the auto-drafted follow-up can
    // resolve a recipient. No match ⇒ null (honest degrade — we NEVER invent/auto-create a contact
    // here; the copilot no-ops contact-linking when null). Gated behind the stream checks above so a
    // contact lookup only runs when the co-pilot fork is actually being minted.
    // #168: reuse the contact the voice-row writer already resolved/auto-created (avoids a duplicate
    // lookup and links the co-pilot to the SAME, now-existing contact). Only fall back to a resolve-only
    // lookup when no value was threaded through (undefined) — an explicit null means "no contact", honored.
    // NOTE (§13) — this fallback is currently UNREACHABLE, and the reason is a defect
    // rather than tidy design. Both call sites pass `voiceLink.contactId`, typed
    // `string | null`, never undefined. Worse, `writeVoiceMessageRow` returns null for
    // TWO different things: "no contact exists" and "the conversation RPC errored / the
    // writer threw". So on a transient RPC failure the co-pilot mints a CONTACTLESS token
    // and loses client linkage — exactly the case this resolve-only fallback exists for,
    // and it structurally cannot run. The remedy is distinguishing the two nulls at the
    // writer, not deleting this branch. Left in place, and named, rather than removed.
    const contactId = precomputedContactId !== undefined
      ? precomputedContactId
      : await resolveContactByPhone(admin, tenantId, counterpartyPhone);
    const token = await mintStreamToken({ secret, tenantId, callSid, contactId });
    // tenantId/callSid are ALSO stamped for logging/debug, but paige-stt trusts ONLY the token (the
    // contactId rides INSIDE the signed token, never as a forgeable <Parameter>).
    return buildStreamStart(streamUrl, { streamToken: token, tenantId, callSid });
  } catch (e) {
    console.error("[voice-twiml] co-pilot token mint failed — bridging without stream", (e as Error)?.message);
    return "";
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

/** Answer Twilio with a TwiML document (always 200 so Twilio plays it, not a retry). */
function twiml(xml: string): Response {
  return new Response(xml, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } });
}

// deno-lint-ignore no-explicit-any
type Admin = any;

/**
 * §9 — the tenant's OWN caller-ID number for an OUTBOUND call. Scoped to the tenant we
 * resolved from the authenticated identity; prefers the primary number, then any active
 * one. Returns the E.164 string, or null when the tenant owns no active number (→ honest
 * "not set up" spoken message, never a dial with a bogus callerId, §13).
 */
async function resolveTenantCallerId(admin: Admin, tenantId: string): Promise<string | null> {
  const { data: sub, error: subError } = await admin
    .from("tenant_twilio_subaccounts")
    .select("id, active, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (subError || !sub || sub.active !== true || sub.status !== "active") {
    console.error("[voice-twiml] active subaccount lookup failed", {
      hasRow: !!sub,
      code: subError?.code ?? null,
    });
    return null;
  }

  const { data, error } = await admin
    .from("tenant_phone_numbers")
    .select("phone_number, is_primary, subaccount_id, twilio_sid, capabilities")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("is_primary", true)
    .maybeSingle();
  if (error) {
    console.error("[voice-twiml] caller-id lookup failed:", error.code, error.message);
    return null;
  }
  const voiceCapable = data?.capabilities?.voice === true;
  if (!data?.phone_number || !data.twilio_sid || data.subaccount_id !== sub.id || !voiceCapable) {
    console.warn("[voice-twiml] primary caller-id is not provider-bound to the active tenant subaccount", {
      hasNumber: !!data?.phone_number,
      hasProviderId: !!data?.twilio_sid,
      sameSubaccount: data?.subaccount_id === sub.id,
      voiceCapable,
    });
    return null;
  }
  return data.phone_number as string;
}

/**
 * §9/§13 — resolve the call's CLIENT counterparty phone → a TENANT-SCOPED contact id. The tenant is
 * the SAME non-forgeable value already resolved for the bridge (outbound = authenticated identity,
 * inbound = number owner); the contact is only ever looked up WITHIN that tenant, so a call can never
 * link to another tenant's client. The number matches ANY of a contact's phone numbers on its last ten
 * digits — the one rule every inbound channel uses (§18, _shared/contact-methods.ts). It is passed as
 * a bound parameter, never interpolated into a filter. Returns null when no contact matches — we NEVER
 * invent/auto-create a contact here; a null contact is an honest degrade the copilot handles (it files
 * the action contactless).
 */
async function resolveContactByPhone(admin: Admin, tenantId: string, phone: string): Promise<string | null> {
  if (!phone || !tenantId) return null;
  return await findClientIdByAddress(admin, tenantId, "phone", normalizePhone(phone) || phone, "voice-twiml");
}

/**
 * §9 — resolve the tenant that OWNS the dialed (To) number for an INBOUND call. The To
 * number is the ONLY key; the tenant is derived from it, never trusted from any body field.
 * Returns the tenant_id, or null when no tenant owns it (e.g. the +1 470 platform number,
 * which has no tenant) → honest "can't take calls" message rather than a wrong-tenant bridge.
 */
async function resolveOwningTenant(admin: Admin, toNumber: string): Promise<string | null> {
  if (!toNumber) return null;
  const norm = normalizePhone(toNumber);
  const { data, error } = await admin
    .from("tenant_phone_numbers")
    .select("tenant_id")
    .eq("phone_number", norm)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    console.error("[voice-twiml] owning-tenant lookup failed:", error.code, error.message);
    return null;
  }
  return (data?.tenant_id as string | undefined) ?? null;
}

type VoiceScope = { kind: "tenant"; tenantId: string } | { kind: "operator" };

/**
 * §9 — the browser-seat identities to ring for an INBOUND call: the tenant's active
 * owner/admin members, each as `${tenantId}.${userId}` (the A1 identity format).
 * Scoped to the ONE resolved tenant — never another tenant's members. Empty array when
 * the tenant has no reachable seat (→ honest voicemail-ish message).
 */
async function resolveTenantSeatIdentities(admin: Admin, tenantId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("tenant_members")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  if (error) {
    console.error("[voice-twiml] seat lookup failed:", error.code, error.message);
    return [];
  }
  const ids = (data ?? [])
    .map((r: { user_id?: string | null }) => r.user_id)
    .filter((u: string | null | undefined): u is string => typeof u === "string" && u.length > 0)
    .map((userId: string) => buildIdentity(tenantId, userId));
  // De-dupe defensively (a member could hold two of the three roles across rows).
  return [...new Set<string>(ids as string[])];
}

/**
 * #168 — write the ONE messages row that makes this call a first-class Conversations entry (§49), and
 * resolve/auto-create the counterparty contact so the row lands in that person's thread.
 *
 * WHY THE CONTACT IS MANDATORY (§9): set_message_tenant() (BEFORE INSERT) derives tenant_id ONLY from
 * connector_id → contact_id → current_user_tenant_id(). A service-role voice insert has no connector and
 * no session tenant, so the ONLY way to stamp the correct tenant is via contact_id. We therefore call
 * create_and_attach_conversation (service-role → p_tenant_id honored because auth.uid() IS NULL) which
 * resolve-or-creates ONE contact for this phone — auto-creating an unknown INBOUND caller (§49) and
 * resolving a known one — and returns its id. No contact ⇒ we do NOT write an untenanted, orphaned row.
 *
 * IDEMPOTENCY: provider_message_id = the Twilio Call SID (uq_messages_provider_message_id) — a webhook
 * retry re-inserting the same SID hits 23505 and is a no-op. THREAD COALESCE: thread_key = the canonical
 * voiceThreadKey (byte-identical to the RPC + src), so trg_messages_upsert_thread folds this call into
 * the same VOICE thread as any prior call with this contact. thread_key is channel-prefixed
 * (`voice:` vs `sms:`/`email:`), so voice coalesces with voice — landing in the shared inbox alongside
 * the contact's own sms/email threads (each channel its own thread), first-class to the same standard.
 *
 * The bridge is allowed only after this durable row exists. A failed write returns ok:false so the
 * handler can speak an unavailable response instead of placing an unaudited call. Returns the
 * resolved contactId for the co-pilot fork to reuse.
 */
async function writeVoiceMessageRow(
  admin: Admin,
  opts: {
    tenantId: string;
    callSid: string;
    direction: "outbound" | "inbound";
    counterpartyPhone: string;
    ownNumber: string;
  },
): Promise<{ ok: boolean; contactId: string | null }> {
  const { tenantId, callSid, direction, counterpartyPhone, ownNumber } = opts;
  try {
    if (!tenantId || !callSid || !counterpartyPhone) {
      console.warn("[voice-twiml] voice row skipped — missing key field", {
        hasTenant: !!tenantId, hasCall: !!callSid, hasCounterparty: !!counterpartyPhone,
      });
      return { ok: false, contactId: null };
    }

    // Resolve-or-create ONE contact for the counterparty (§9 explicit p_tenant_id on the service-role path).
    let contactId: string | null = null;
    const { data: convo, error: convoErr } = await admin.rpc("create_and_attach_conversation", {
      p_phone: counterpartyPhone,
      p_channel: "voice",
      p_tenant_id: tenantId,
    });
    if (convoErr) {
      console.error("[voice-twiml] create_and_attach_conversation failed — refusing unaudited call:",
        convoErr.code, convoErr.message);
    } else {
      const row = Array.isArray(convo) ? convo[0] : convo;
      contactId = (row?.contact_id as string | undefined) ?? null;
    }
    if (!contactId) {
      // §9/§13: never write a null-tenant orphan row. The handler refuses the bridge rather
      // than placing a call that has no tenant-safe durable history.
      console.error("[voice-twiml] no contact resolved — NOT writing an untenanted voice row", { tenantId, direction });
      return { ok: false, contactId: null };
    }

    // §9: tenant_id OMITTED — set_message_tenant() derives it from contact_id. from/to reflect the two
    // phone numbers by direction; body_text is a real human line (§15 — no placeholder).
    const fromAddr = direction === "outbound" ? ownNumber : counterpartyPhone;
    const toAddr = direction === "outbound" ? counterpartyPhone : ownNumber;
    const body = direction === "outbound"
      ? `Outbound call to ${counterpartyPhone}`
      : `Inbound call from ${counterpartyPhone}`;

    const { error: insErr } = await admin.from("messages").insert({
      thread_key: voiceThreadKey(tenantId, counterpartyPhone, contactId),
      contact_id: contactId,
      channel_type: "voice",
      direction,
      // §13 honest: the call is initiating. 'initiated' is NOT a valid messages.status value (CHECK is
      // draft/queued/sent/delivered/failed/received/read) — 'queued' is the honest in-flight value; the
      // CallStatus completion webhook advances it to delivered/failed + stamps call_duration_seconds.
      status: "queued",
      provider_message_id: callSid,
      sender: fromAddr ? { address: fromAddr } : null,
      recipients: toAddr ? [{ address: toAddr }] : [],
      body_text: body,
      meta: { call: { provider: "twilio", direction, from: fromAddr ?? null, to: toAddr ?? null, call_sid: callSid } },
      sent_at: new Date().toISOString(),
    });
    if (insErr) {
      if (insErr.code === "23505") {
        // Twilio re-hit the VoiceUrl for the same Call SID — the row already exists. Idempotent no-op.
        console.log("[voice-twiml] voice row already present (webhook retry) — dedup");
        return { ok: true, contactId };
      }
      console.error("[voice-twiml] voice row insert failed — refusing unaudited call:", insErr.code, insErr.message);
      return { ok: false, contactId };
    }
    console.log("[voice-twiml] voice row written", { direction, tenantId, hasContact: true });
    return { ok: true, contactId };
  } catch (e) {
    console.error("[voice-twiml] writeVoiceMessageRow threw — refusing unaudited call:", (e as Error)?.message);
    return { ok: false, contactId: null };
  }
}

// ── OPERATOR (God/Super-Admin) scope — Phase 3 (§9/§53) ──────────────────────────────────────
// An operator call runs on the platform MASTER account and is TENANT-LESS. Its rows live ONLY in
// operator_messages / operator_conversations (is_platform_owner()-gated, NO tenant_id) — NEVER in
// the tenant messages/threads store. An operator call NEVER resolves or touches a tenant (§9).

/**
 * §53 — the browser-seat identities to ring for an INBOUND operator call: the platform operators
 * (super_admin OR platform_admin), each as `operator.<userId>` (the Phase-3 operator identity
 * format). Reads user_roles (user_id, role); scoped to the operator tiers ONLY, so a tenant member
 * is never rung. Empty array when no operator seat exists (→ honest voicemail-ish message). This is
 * the operator analog of resolveTenantSeatIdentities — it never returns a tenant identity.
 */
async function resolveOperatorSeatIdentities(admin: Admin): Promise<string[]> {
  const { data, error } = await admin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["super_admin", "platform_admin"]);
  if (error) {
    console.error("[voice-twiml] operator seat lookup failed:", error.code, error.message);
    return [];
  }
  const ids = (data ?? [])
    .map((r: { user_id?: string | null }) => r.user_id)
    .filter((u: string | null | undefined): u is string => typeof u === "string" && u.length > 0)
    .map((userId: string) => buildOperatorIdentity(userId));
  // De-dupe defensively (a user could hold both super_admin and platform_admin rows).
  return [...new Set<string>(ids as string[])];
}

/**
 * §49/§9/§53 — write the ONE operator_messages row that makes this call a first-class operator
 * Conversations entry (channel_type='voice'), and roll its operator_conversations thread. The
 * operator store has NO tenant_id and NO set_message_tenant() trigger — these are service-role
 * writes gated upstream by the is_platform_owner() RLS posture of the tables.
 *
 * THREAD MODEL (§49 — a call is an inline row in the SAME thread, never a separate channel): the
 * thread is keyed on the counterparty phone. If an operator thread already exists for this phone
 * (ANY channel — e.g. an SMS thread), the call joins THAT thread (a channel_type='voice' message
 * row); only when NO thread exists does a call-only thread open with channel='voice'. This mirrors
 * the Phase-1 migration's stated intent ("an SMS phone thread keeps channel='sms' and simply gains
 * channel_type='voice' rows; a call-only thread may open with channel='voice'"). The unique key is
 * (channel, counterparty_phone), so we SELECT-then-INSERT rather than upsert (upsert can't express
 * "match any channel for this phone").
 *
 * IDEMPOTENCY: provider_message_id = the Twilio Call SID (operator_messages_provider_msg_uq) — a
 * webhook retry re-inserting the same SID hits 23505 and is a no-op. The handler refuses to bridge
 * when persistence fails, so an operator call cannot exist without its audit row.
 */
async function writeOperatorVoiceMessageRow(
  admin: Admin,
  opts: {
    callSid: string;
    direction: "outbound" | "inbound";
    counterpartyPhone: string;
    ownNumber: string;
  },
): Promise<boolean> {
  const { callSid, direction, counterpartyPhone: rawCounterparty, ownNumber } = opts;
  // Normalize to E.164 BEFORE the thread SELECT/INSERT — both operator SMS paths store
  // counterparty_phone E.164-normalized (paige-operator-sms-{send,inbound}), so a call whose
  // Twilio To/From isn't normalized (e.g. an outbound browser-dialed '4705551234') must be
  // normalized here or it opens a DUPLICATE voice-only thread instead of joining the SMS thread (§49).
  const counterpartyPhone = normalizePhone(rawCounterparty);
  try {
    if (!callSid || !counterpartyPhone) {
      console.warn("[voice-twiml] operator voice row skipped — missing key field", {
        hasCall: !!callSid, hasCounterparty: !!counterpartyPhone,
      });
      return false;
    }

    // Find an existing operator thread for this phone (ANY channel) so a call joins the SAME thread
    // as this counterparty's SMS (§49). Only open a new channel='voice' thread when none exists.
    const { data: existing, error: findErr } = await admin
      .from("operator_conversations")
      .select("id")
      .eq("counterparty_phone", counterpartyPhone)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (findErr) {
      console.error("[voice-twiml] operator thread lookup failed — refusing unaudited call:", findErr.code, findErr.message);
      return false;
    }

    let conversationId: string | null = (existing?.id as string | undefined) ?? null;
    if (!conversationId) {
      const { data: created, error: insErr } = await admin
        .from("operator_conversations")
        .insert({ channel: "voice", counterparty_phone: counterpartyPhone })
        .select("id")
        .single();
      if (insErr) {
        if (insErr.code === "23505") {
          // A concurrent insert created the thread — re-select it (any channel) and reuse.
          const { data: raced } = await admin
            .from("operator_conversations")
            .select("id")
            .eq("counterparty_phone", counterpartyPhone)
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          conversationId = (raced?.id as string | undefined) ?? null;
        }
        if (!conversationId) {
          console.error("[voice-twiml] operator thread insert failed — refusing unaudited call:", insErr.code, insErr.message);
          return false;
        }
      } else {
        conversationId = created.id as string;
      }
    }

    // from/to reflect the two numbers by direction; the operator's own master number is ownNumber.
    const fromAddr = direction === "outbound" ? ownNumber : counterpartyPhone;
    const toAddr = direction === "outbound" ? counterpartyPhone : ownNumber;
    const body = direction === "outbound"
      ? `Outbound call to ${counterpartyPhone}`
      : `Inbound call from ${counterpartyPhone}`;

    const { error: msgErr } = await admin.from("operator_messages").insert({
      conversation_id: conversationId,
      channel_type: "voice",
      direction,
      body,
      // §13 honest in-flight value: 'queued' (a valid operator_messages.status). The CallStatus
      // completion webhook advances it to delivered/failed + stamps call_duration_seconds.
      status: "queued",
      provider_message_id: callSid,
      from_phone: fromAddr || null,
      to_phone: toAddr || null,
      sent_at: new Date().toISOString(),
    });
    if (msgErr) {
      if (msgErr.code === "23505") {
        console.log("[voice-twiml] operator voice row already present (webhook retry) — dedup");
        return true;
      }
      console.error("[voice-twiml] operator voice row insert failed — refusing unaudited call:", msgErr.code, msgErr.message);
      return false;
    }

    // Roll the thread forward. An inbound call bumps unread (mirrors paige-operator-sms-inbound).
    const update: Record<string, unknown> = {
      last_message_at: new Date().toISOString(),
      last_direction: direction,
      last_preview: body.slice(0, 140),
    };
    if (direction === "inbound") {
      const { data: convo } = await admin
        .from("operator_conversations")
        .select("unread_count")
        .eq("id", conversationId)
        .maybeSingle();
      update.unread_count = ((convo?.unread_count as number | undefined) ?? 0) + 1;
    }
    await admin.from("operator_conversations").update(update).eq("id", conversationId);

    console.log("[voice-twiml] operator voice row written", { direction });
    return true;
  } catch (e) {
    console.error("[voice-twiml] writeOperatorVoiceMessageRow threw — refusing unaudited call:", (e as Error)?.message);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const rawBody = await req.text();

  const params = new URLSearchParams(rawBody);
  const from = params.get("From") ?? "";
  const to = params.get("To") ?? "";
  const callSid = params.get("CallSid") ?? ""; // #140 B1 — binds the co-pilot stream token to this call
  const direction = classifyDirection(from);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Resolve the claimed scope from server-owned data before selecting any credential.
  // Outbound tenant scope comes from the Twilio Client identity; inbound tenant scope
  // comes from ownership of the dialed number. Unknown scopes receive no credential.
  let preResolvedInboundTenant: string | null = null;
  let scope: VoiceScope | null = null;
  if (direction === "outbound") {
    if (isOperatorClientCaller(from)) scope = { kind: "operator" };
    else {
      const caller = parseClientCaller(from);
      if (caller) scope = { kind: "tenant", tenantId: caller.tenantId };
    }
  } else {
    preResolvedInboundTenant = await resolveOwningTenant(admin, to);
    if (preResolvedInboundTenant) scope = { kind: "tenant", tenantId: preResolvedInboundTenant };
    else {
      const opNumber = operatorVoiceCallerId();
      if (opNumber && normalizePhone(to) === normalizePhone(opNumber)) scope = { kind: "operator" };
    }
  }

  const offeredSecret = new URL(req.url).searchParams.get("t");
  let expectedSecret: string | null = scope?.kind === "operator"
    ? await deriveOperatorVoiceWebhookSecret()
    : null;
  if (scope?.kind === "tenant") {
    const { data: proofRow, error: proofError } = await admin
      .from("tenant_twilio_subaccounts")
      .select("inbound_webhook_secret")
      .eq("tenant_id", scope.tenantId)
      .eq("active", true)
      .eq("status", "active")
      .maybeSingle();
    if (proofError) {
      console.error("[voice-twiml] tenant proof lookup failed", { code: proofError.code ?? null });
      return new Response("provider_auth_unavailable", { status: 503 });
    }
    expectedSecret = (proofRow?.inbound_webhook_secret as string | undefined) ?? null;
  }
  const auth = await authenticateTwilioWebhook(req, rawBody, {
    authToken: Deno.env.get("TWILIO_AUTH_TOKEN"),
    expectedSecret,
  });
  let requestAuthenticated = false;
  if (auth.ok) {
    // A tenant proof may authorize only its exact tenant branch. A master signature may
    // authorize only the operator branch; it can never unlock tenant caller IDs or secrets.
    requestAuthenticated = scope?.kind === "tenant"
      ? auth.via === "shared_secret"
      : scope?.kind === "operator" && (auth.via === "signature" || auth.via === "shared_secret");
  }
  if (!requestAuthenticated) {
    console.error("[voice-twiml] refused unauthenticated provider request", {
      reason: auth.ok ? "proof_scope_mismatch" : auth.reason,
      hasSignature: !!req.headers.get("x-twilio-signature"),
      hasTenantProof: !!offeredSecret,
      resolvedScope: scope?.kind ?? "unknown",
    });
    const status = !auth.ok && (auth.reason === "no_proof_offered" || auth.reason === "unknown_recipient") ? 401 : 403;
    return new Response("unauthenticated", { status });
  }
  const authenticatedTenantId = scope?.kind === "tenant" ? scope.tenantId : null;
  if (authenticatedTenantId && !await commsProviderExecutionAllowed(admin, { tenantId: authenticatedTenantId })) {
    return new Response("<Response><Hangup/></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
  }

  // #168 — where Twilio POSTs the call's terminal status (CallStatus + CallDuration) at call end, so
  // twilio-status-callback can stamp the voice row's final status + duration. Mirrors send-message's
  // SMS-DLR URL derivation EXACTLY (env override → default). "" ⇒ the noun emits no statusCallback
  // (the row stays 'queued'; honest degrade, never a broken dial).
  //
  // `twilio-status-callback` now fails CLOSED, so a callback URL is only useful when it
  // carries proof — either the master signature (operator/master-account calls) or the
  // receiving tenant's stamped `?t=` secret.
  //
  // ── WHY THIS IS GATED ON authenticated provider proof ──
  // The TwiML we return here is the HTTP RESPONSE BODY handed to whoever POSTed. A stamped
  // URL therefore DISCLOSES `inbound_webhook_secret` to the caller. That is safe only after
  // the request proves either master-account or active-tenant authority. Without this gate an
  // anonymous POST of `From=client:<any tenantId>.<any userId>` would have made us look up
  // that tenant's secret and hand it back in `<Number statusCallback="…?t=SECRET">`. The
  // holder of that long-lived secret can then forge inbound SMS, suppressions and consent
  // events against the tenant — i.e. it would have handed away the very fail-closed posture
  // the rest of this change establishes.
  //
  // An earlier revision of this block called `From` "the AUTHENTICATED client identity …
  // never a raw parameter (§9)". That is true of Twilio's own request and FALSE of an
  // unsigned one: with no signature to check, every field here is attacker-supplied. §9
  // scope is only as non-forgeable as the authentication underneath it.
  //
  // So: emit a secret-bearing (or signature-authenticated) callback ONLY on a verified
  // request. Unverified requests are refused before TwiML or durable history is created.
  const statusCallbackBase =
    Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ||
    (supabaseUrl ? `${supabaseUrl}/functions/v1/twilio-status-callback` : "");

  // Tenant subaccounts cannot be validated with the absent master Auth Token. Instead, the
  // TwiML App URL is stamped with the tenant's existing webhook secret; authentication above
  // resolves that proof to one active subaccount and then binds it to the client identity or
  // called-number owner. Operator calls continue to use the master signature path.
  /**
   * Resolve the callback URL for the tenant THIS BRANCH actually established.
   *
   * Computed per branch, not once up front. The previous revision derived one tenant from
   * `From` and reused it everywhere — but `From` is a PSTN number on every INBOUND call, so
   * `parseClientCaller` returned null and every inbound tenant call was treated as an
   * operator/master call and got the bare, unstamped URL. That URL is refused 401 by the
   * (now fail-closed) callback endpoint, because a tenant leg is signed by the subaccount
   * and not the master token.
   *
   * The tenant is passed in by the branch that resolved it non-forgeably: the authenticated
   * client identity outbound, the OWNER OF THE DIALED NUMBER inbound (§9). null = an
   * operator/master call, which carries no tenant credential.
   */
  const callbackUrlFor = async (tenantId: string | null): Promise<string> => {
    // Skip the credential read entirely on an unverified request — nothing downstream can
    // use it, and not reading it is stronger than reading it and discarding it.
    if (!statusCallbackBase || !requestAuthenticated) return "";
    let tenantSecret: string | null = tenantId ? null : await deriveOperatorVoiceWebhookSecret();
    if (tenantId) {
      // §32 — LOG the fault. This previously destructured only `.data`, so a PGRST
      // error (including PGRST116, which `.maybeSingle()` raises when a tenant somehow
      // has more than one row) silently produced null → no statusCallback → a voice row
      // that never gets its terminal status, indistinguishable from "no secret on file".
      // Every sibling lookup in this file logs its error; this one did not.
      const { data, error } = await admin.from("tenant_twilio_subaccounts")
        .select("inbound_webhook_secret").eq("tenant_id", tenantId).limit(1).maybeSingle();
      if (error) {
        console.error("[voice-twiml] webhook-secret lookup FAILED — emitting no statusCallback:",
          error.code, error.message, { tenantId });
      }
      tenantSecret = (data?.inbound_webhook_secret as string | undefined) ?? null;
    }
    return resolveStatusCallbackUrl({ base: statusCallbackBase, signatureVerified: requestAuthenticated, tenantId, tenantSecret });
  };

  try {
    if (direction === "outbound") {
      // ── OPERATOR outbound (§9/§53, Phase 3) — intercept the operator sentinel BEFORE
      //    parseClientCaller (which would mis-parse `operator.<userId>` into a tenantId="operator").
      //    Present the platform MASTER caller-id; write the operator voice row; NO tenant lookup and
      //    NO co-pilot fork (that is tenant STT, §9). "operator" is not a UUID, so no tenant collides. ──
      if (isOperatorClientCaller(from)) {
        if (authenticatedTenantId) {
          console.error("[voice-twiml] tenant proof cannot authorize an operator call");
          return new Response("tenant_scope_mismatch", { status: 403 });
        }
        const operatorUserId = parseOperatorClientCaller(from);
        if (!operatorUserId) {
          console.error("[voice-twiml] operator outbound: unparseable operator identity");
          return twiml(buildSayHangupTwiml(OUTBOUND_NO_NUMBER_MESSAGE));
        }
        if (!to) {
          console.error("[voice-twiml] operator outbound: missing To (dialed number)");
          return twiml(buildSayHangupTwiml(OUTBOUND_NO_NUMBER_MESSAGE));
        }
        // The operator's own E.164 number on the MASTER account (+1 470 …). Resolved from env, NOT
        // from any tenant_phone_numbers row (§9 — the operator has no tenant number).
        const opCallerId = operatorVoiceCallerId();
        if (!opCallerId) {
          // §13: no operator voice number configured → speak the honest "not set up" message; NEVER
          // dial with a bogus/placeholder callerId. Owed secret: TWILIO_OPERATOR_CALLER_ID (the
          // master account's +1 470 number, exposed to the edge runtime).
          console.warn("[voice-twiml] operator outbound: no operator voice caller-id configured — honest degrade");
          return twiml(buildSayHangupTwiml(NO_CALLER_ID_MESSAGE));
        }
        // §9/§53: operator scope writes ONLY operator_messages/operator_conversations (no tenant_id),
        // NEVER the tenant messages/threads store. Non-blocking (§32) — the bridge proceeds regardless.
        const historyWritten = await writeOperatorVoiceMessageRow(admin, {
          callSid, direction: "outbound", counterpartyPhone: to, ownNumber: opCallerId,
        });
        if (!historyWritten) return twiml(buildSayHangupTwiml(CALL_UNAVAILABLE_MESSAGE));
        console.log("[voice-twiml] operator outbound bridge");
        // No co-pilot stream on the operator scope (co-pilot is tenant STT, §9). streamXml = "".
        return twiml(buildOutboundTwiml(opCallerId, to, "", await callbackUrlFor(null)));
      }

      // §9: tenant is the AUTHENTICATED client identity Twilio populated From with.
      const caller = parseClientCaller(from);
      if (!caller) {
        console.error("[voice-twiml] outbound: unparseable client identity");
        return twiml(buildSayHangupTwiml(OUTBOUND_NO_NUMBER_MESSAGE));
      }
      if (authenticatedTenantId && caller.tenantId !== authenticatedTenantId) {
        console.error("[voice-twiml] outbound tenant proof mismatch");
        return new Response("tenant_scope_mismatch", { status: 403 });
      }
      if (!to) {
        console.error("[voice-twiml] outbound: missing To (dialed number)", { tenantId: caller.tenantId });
        return twiml(buildSayHangupTwiml(OUTBOUND_NO_NUMBER_MESSAGE));
      }
      const callerId = await resolveTenantCallerId(admin, caller.tenantId);
      if (!callerId) {
        // §13: no owned number → speak the honest "not set up" message; NEVER dial with a
        // bogus/placeholder callerId (Twilio would reject or spoof).
        console.warn("[voice-twiml] outbound: tenant owns no active number — honest degrade", {
          tenantId: caller.tenantId,
        });
        return twiml(buildSayHangupTwiml(NO_CALLER_ID_MESSAGE));
      }
      // #168: write the first-class voice Conversations row (resolves/creates the counterparty contact),
      // BEFORE the co-pilot fork so the fork reuses the same contact. Never breaks the bridge (§32).
      // OUTBOUND: counterparty = the dialed number (To); the tenant's own number is the presented callerId.
      const voiceLink = await writeVoiceMessageRow(admin, {
        tenantId: caller.tenantId, callSid, direction: "outbound", counterpartyPhone: to, ownNumber: callerId,
      });
      if (!voiceLink.ok) return twiml(buildSayHangupTwiml(CALL_UNAVAILABLE_MESSAGE));
      // #140 B1: GATED co-pilot fork (default OFF) — non-blocking, before the <Dial> bridge.
      const streamXml = await buildCoPilotStreamXml(admin, caller.tenantId, callSid, to, voiceLink.contactId, requestAuthenticated);
      console.log("[voice-twiml] outbound bridge", { tenantId: caller.tenantId, coPilot: streamXml.length > 0 });
      return twiml(buildOutboundTwiml(callerId, to, streamXml, await callbackUrlFor(caller.tenantId)));
    }

    // ── INBOUND ──────────────────────────────────────────────────────────────────
    // §9: the tenant is the OWNER of the dialed number — derived from To, never a body.
    const tenantId = preResolvedInboundTenant;
    if (authenticatedTenantId && tenantId !== authenticatedTenantId) {
      console.error("[voice-twiml] inbound tenant proof mismatch");
      return new Response("tenant_scope_mismatch", { status: 403 });
    }
    if (!tenantId) {
      // ── OPERATOR inbound (§9/§53, Phase 3) — the null-tenant branch is the operator attach point.
      //    A number owned by NO tenant is the platform MASTER (+1 470 …) number when it matches the
      //    operator voice caller-id; route it to the operator seat(s), NEVER to any tenant. If it does
      //    not match the operator number (or no operator number is configured), fall through to the
      //    existing honest "unknown number" degrade. This preserves §9/§51: the master number NEVER
      //    routes to a tenant, and a subaccount/tenant number NEVER reaches this operator branch (it
      //    resolved a tenantId above and rang that tenant's seats). ──
      const opNumber = operatorVoiceCallerId();
      if (opNumber && normalizePhone(to) === normalizePhone(opNumber)) {
        const opIdentities = await resolveOperatorSeatIdentities(admin);
        if (opIdentities.length === 0) {
          // Graceful fallback — no operator seat available: speak the honest "no one available"
          // message and hang up (mirrors the tenant no-seat path). Never a fabricated bridge (§13).
          console.warn("[voice-twiml] operator inbound: no operator seat available — voicemail message");
          return twiml(buildSayHangupTwiml(VOICEMAIL_UNAVAILABLE_MESSAGE));
        }
        // §9/§53: operator scope writes ONLY operator_messages (no tenant_id). INBOUND: counterparty
        // = the external caller (From); the operator's own master number is the dialed To. Non-blocking (§32).
        const historyWritten = await writeOperatorVoiceMessageRow(admin, {
          callSid, direction: "inbound", counterpartyPhone: from, ownNumber: to,
        });
        if (!historyWritten) return twiml(buildSayHangupTwiml(CALL_UNAVAILABLE_MESSAGE));
        console.log("[voice-twiml] operator inbound ring", { seats: opIdentities.length });
        // No co-pilot stream on the operator scope (co-pilot is tenant STT, §9). streamXml = "".
        return twiml(buildInboundTwiml(opIdentities, "", await callbackUrlFor(null)));
      }
      console.warn("[voice-twiml] inbound: dialed number owned by no active tenant — honest degrade");
      return twiml(buildSayHangupTwiml(UNKNOWN_NUMBER_MESSAGE));
    }
    const identities = await resolveTenantSeatIdentities(admin, tenantId);
    if (identities.length === 0) {
      // A3 keeps voicemail minimal: speak an honest "no one available" message and hang up.
      // Real voicemail capture (<Record>/transcription) is a tracked follow-up.
      console.warn("[voice-twiml] inbound: tenant has no reachable seat — voicemail message", { tenantId });
      return twiml(buildSayHangupTwiml(VOICEMAIL_UNAVAILABLE_MESSAGE));
    }
    // #168: write the first-class voice Conversations row — auto-creates the contact for an UNKNOWN
    // inbound caller (§49) — BEFORE the co-pilot fork so it reuses the same contact. Never breaks the ring (§32).
    // INBOUND: counterparty = the external caller (From); the tenant's own number is the dialed To.
    const voiceLink = await writeVoiceMessageRow(admin, {
      tenantId, callSid, direction: "inbound", counterpartyPhone: from, ownNumber: to,
    });
    if (!voiceLink.ok) return twiml(buildSayHangupTwiml(CALL_UNAVAILABLE_MESSAGE));
    // #140 B1: GATED co-pilot fork (default OFF) — non-blocking, before the <Dial> ring.
    const streamXml = await buildCoPilotStreamXml(admin, tenantId, callSid, from, voiceLink.contactId, requestAuthenticated);
    console.log("[voice-twiml] inbound ring", { tenantId, seats: identities.length, coPilot: streamXml.length > 0 });
    return twiml(buildInboundTwiml(identities, streamXml, await callbackUrlFor(tenantId)));
  } catch (e) {
    // §32: never a silent 500 — a runtime fault still answers with a spoken, graceful hangup
    // so the caller/browser hears something, and we log the real cause loudly.
    console.error("[voice-twiml] unhandled error — degrading to spoken hangup:", (e as Error)?.message, (e as Error)?.stack);
    return twiml(buildSayHangupTwiml(CALL_UNAVAILABLE_MESSAGE));
  }
});
