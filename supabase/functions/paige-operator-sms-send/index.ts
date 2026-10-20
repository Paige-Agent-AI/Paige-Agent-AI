// paige-operator-sms-send — outbound SMS from the OPERATOR (God/Super-Admin) surface.
//
// §9: the caller is verified server-side as the platform OWNER (is_platform_owner()),
// derived from the JWT — NEVER from the request body. A tenant/coach/client JWT is
// rejected 403. Sends through the operator account's A2P Messaging Service SID (§ A2P
// best practice — never a raw From), then persists the outbound message threaded to its
// operator_conversations row (upsert by counterparty phone). verify_jwt defaults to true
// for this function (it is NOT listed as verify_jwt=false in config.toml).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { operatorTwilioCreds, operatorMessagingServiceSid, sendOperatorSms } from "../_shared/operator-twilio.ts";
import { normalizePhone } from "../_shared/pre-send-pipeline.ts";
import { formatPaigeAgentAiSms } from "../_shared/paige-agent-ai-sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY = 1600;

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Caller-scoped client → derive the owner identity from the JWT (§9), never the body.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  // Resolve the caller's uid from the JWT, then call the EXPLICIT is_platform_owner(_user_id)
  // overload. A no-arg .rpc("is_platform_owner") is AMBIGUOUS under PostgREST because the
  // function is overloaded — is_platform_owner() AND is_platform_owner(uuid) both exist — so
  // PostgREST returns PGRST203 ("could not choose the best candidate function"), which
  // surfaced as the opaque `authz_check_failed` 500 the owner hit on the live-drive (D.1).
  // Passing `_user_id` disambiguates to the uuid overload (verified: it checks that uid's
  // super_admin role in user_roles). Every OTHER caller uses is_platform_owner() INSIDE an
  // RLS policy (definer context, no PostgREST resolution), which is why this direct rpc caller
  // was the first to break.
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const { data: isOwner, error: ownerErr } = await caller.rpc("is_platform_owner", {
    _user_id: userData.user.id,
  });
  if (ownerErr) {
    // §32/§13: log the REAL cause, never a swallowed opaque 500.
    console.error("[paige-operator-sms-send] is_platform_owner check failed:", ownerErr.message);
    return json({ error: "authz_check_failed", detail: ownerErr.message }, 500);
  }
  if (isOwner !== true) return json({ error: "forbidden" }, 403);

  let payload: { to?: string; reason?: string; conversation_id?: string; counterparty_name?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const toRaw = (payload.to ?? "").trim();
  const reason = (payload.reason ?? "").trim();
  if (!toRaw) return json({ error: "to_required" }, 400);
  if (!reason) return json({ error: "account_action_reason_required" }, 400);
  if (reason.length > 240) return json({ error: "account_action_reason_too_long_max_240" }, 400);

  const toNorm = normalizePhone(toRaw);
  let fullBody: string;
  try {
    fullBody = formatPaigeAgentAiSms({
      body: `Your account requires action: ${reason}`,
      url: "https://paigeagent.ai/auth?mode=login",
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
  if (fullBody.length > MAX_BODY) return json({ error: "body_too_long_max_1600" }, 400);

  // Short-circuit needs_config BEFORE any DB write (§13): when the operator Twilio config
  // is incomplete there is nothing to send, so we must not create a conversation thread or
  // a `failed` message row — otherwise the operator inbox fills with phantom pre-config
  // artifacts. Account/auth reuse the master creds (already set); the only realistic gap is
  // the A2P Messaging Service SID, so name it precisely so the owner knows the ONE secret.
  if (!operatorTwilioCreds()) {
    const reason = !operatorMessagingServiceSid()
      ? "operator_messaging_service_not_configured"
      : "operator_twilio_not_configured";
    return json({ outcome: "needs_config", reason }, 200);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Platform Campaign traffic is authorized only by the platform-user evidence
  // row created from the exact signup disclosure. Tenant/contact consent cannot
  // authorize an operator message, even when the phone number happens to match.
  // The one gate (has_sms_consent, #2087) also requires that the account behind the
  // evidence VERIFIED this number: a number typed at signup proves nothing about
  // who owns it, and a check that cannot run holds the message.
  const { data: platformConsent, error: consentErr } = await admin.rpc("has_sms_consent", {
    _phone: toNorm,
    _marketing: false,
  });
  if (consentErr) return json({ outcome: "suppressed", reason: "consent_check_failed" }, 200);
  if (platformConsent !== true) return json({ outcome: "suppressed", reason: "platform_sms_consent_required" }, 200);

  // Upsert the operator conversation thread for this counterparty (service role; the owner
  // gate above already authorized this write). Unique on (channel, counterparty_phone).
  const { data: convo, error: convoErr } = await admin
    .from("operator_conversations")
    .upsert(
      {
        channel: "sms",
        counterparty_phone: toNorm,
        ...(payload.counterparty_name ? { counterparty_name: payload.counterparty_name } : {}),
      },
      { onConflict: "channel,counterparty_phone", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (convoErr || !convo) {
    console.error("[paige-operator-sms-send] conversation upsert failed:", convoErr?.message);
    return json({ error: "conversation_upsert_failed" }, 500);
  }
  const conversationId = convo.id as string;

  // Send through the operator A2P Messaging Service SID.
  const send = await sendOperatorSms(toNorm, fullBody);
  const providerMsgId = (send.data as Record<string, unknown> | null)?.sid as string | undefined;
  const status: "sent" | "failed" = send.ok ? "sent" : "failed";

  // Persist the outbound message (record the attempt truthfully whether it sent or failed, §13).
  const { data: msg, error: msgErr } = await admin
    .from("operator_messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      body: fullBody,
      status,
      provider_message_id: providerMsgId ?? null,
      to_phone: toNorm,
      error: send.ok ? null : (send.error ?? "send_failed"),
      sent_at: send.ok ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (msgErr) {
    console.error("[paige-operator-sms-send] message insert failed:", msgErr.message);
  }

  // Roll the thread forward (last message + direction). Best-effort; never fails the send.
  await admin
    .from("operator_conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_direction: "outbound",
      last_preview: fullBody.slice(0, 140),
    })
    .eq("id", conversationId);

  if (!send.ok) {
    // Honest degrade (§13): needs_config vs a real Twilio failure.
    if (send.needs_config) {
      return json({ outcome: "needs_config", reason: send.error, conversation_id: conversationId }, 200);
    }
    return json({ outcome: "failed", reason: send.error, conversation_id: conversationId, message_id: msg?.id ?? null }, 200);
  }

  return json({
    outcome: "sent",
    conversation_id: conversationId,
    message_id: msg?.id ?? null,
    provider_message_id: providerMsgId ?? null,
  });
  } catch (e) {
    // §32 loud-failure: never a swallowed opaque 500 — log the real cause + return its detail.
    console.error("[paige-operator-sms-send] unhandled error:", (e as Error)?.message, (e as Error)?.stack);
    return json({ error: "internal_error", detail: (e as Error)?.message ?? "unknown" }, 500);
  }
});
