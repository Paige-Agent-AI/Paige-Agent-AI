// Paige Live Conversation control plane. Paige owns the session and context; this endpoint does
// not call a voice provider, issue a provider token, request microphone access, or accept a tool.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { issueRelayTicket, liveContextEpochTenant } from "../_shared/paige-live-ticket.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    thread_id: z.string().uuid(),
    context_epoch: z.string().min(1).max(512),
    entry_mode: z.enum(["embedded", "existing-popout", "requested-popout"]),
  }),
  z.object({
    action: z.literal("relay"),
    thread_id: z.string().uuid(),
    context_epoch: z.string().min(1).max(512),
    entry_mode: z.enum(["embedded", "existing-popout", "requested-popout"]),
    session_id: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("transition"),
    session_id: z.string().uuid(),
    thread_id: z.string().uuid(),
    context_epoch: z.string().min(1).max(512),
    transition: z.enum(["hold", "resume", "minimize", "restore", "retry", "end"]),
  }),
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ code: "unauthenticated" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const asCaller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await asCaller.auth.getUser();
  if (authError || !user) return json({ code: "unauthenticated" }, 401);

  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ code: "invalid_request" }, 400);
  const admin = createClient(supabaseUrl, serviceKey);

  const endStaleSession = async () => {
    if (parsed.data.action !== "transition" || parsed.data.transition !== "end") return null;
    const { data, error } = await admin.rpc("paige_live_session_end_stale_internal", {
      _actor_user_id: user.id,
      _session_id: parsed.data.session_id,
    });
    if (error) return json({ code: "session_transition_refused" }, error.code === "42501" ? 403 : 409);
    return json(data);
  };

  // Resolve active tenant and thread for every start and transition. Request scope can only make
  // the call fail; it never selects a tenant. Only explicit end may clean up a stale session.
  const { data: tenantValue, error: tenantError } = await asCaller.rpc("current_user_tenant_id");
  if (tenantError || !tenantValue) return (await endStaleSession()) ?? json({ code: "workspace_unresolved" }, 409);
  const tenantId = String(tenantValue);
  const epochTenant = liveContextEpochTenant(parsed.data.context_epoch);
  if (epochTenant !== tenantId) return (await endStaleSession()) ?? json({ code: "stale_context" }, 409);

  const { data: thread, error: threadError } = await asCaller
    .from("paige_chat_threads")
    .select("id,tenant_id,caller_user_id")
    .eq("id", parsed.data.thread_id)
    .eq("tenant_id", tenantId)
    .eq("caller_user_id", user.id)
    .maybeSingle();
  if (threadError) {
    console.error("[paige-live-session] thread scope read failed", { code: threadError.code });
    return json({ code: "workspace_unresolved" }, 500);
  }
  if (!thread) return (await endStaleSession()) ?? json({ code: "thread_scope_mismatch" }, 403);

  if (parsed.data.action === "relay") {
    // ONE HOME FOR "MAY THIS PERSON SPEAK" (§18). This used to read
    // paige_live_tenant_availability here and refuse on a missing row, which made it a SECOND
    // answer to a question the database already answers — and, once a missing row came to mean
    // "follow the rollout scope" rather than "refused", a second answer that CONTRADICTED the
    // first. A brand-new Solo account would have been refused here without the predicate ever
    // being asked. The predicate below reads that same table itself and honours both of its
    // meanings: enabled = true admits a workspace outright, enabled = false is a kill switch.
    const { data: authorizedPilot, error: authorizationError } = await admin.rpc("paige_live_pilot_authorized_internal", {
      _actor_user_id: user.id, _tenant_id: tenantId,
    });
    if (authorizationError || authorizedPilot !== true) {
      return json({
        ok: false, session_id: null, availability: "UNAVAILABLE", code: "live_audio_not_enabled",
        explanation: "Live audio isn't available for this account yet. You can keep working with Paige in chat.",
      });
    }
    // This is a first-party ticket, not a provider token. Existing sessions
    // supply a fresh ticket on reconnect; replacing a pending digest revokes it.
    const ticket = await issueRelayTicket();
    const scoped = parsed.data.session_id
      ? await admin.from("paige_live_sessions")
        .update({ provider_session_ref: ticket.storedDigest, state: "reconnecting", updated_at: new Date().toISOString() })
        .eq("id", parsed.data.session_id).eq("tenant_id", tenantId)
        .eq("actor_user_id", user.id).eq("thread_id", parsed.data.thread_id)
        .eq("context_epoch", parsed.data.context_epoch).neq("state", "ended")
        .select("id").maybeSingle()
      : await admin.from("paige_live_sessions")
        .insert({
          tenant_id: tenantId, actor_user_id: user.id, thread_id: parsed.data.thread_id,
          context_epoch: parsed.data.context_epoch, entry_mode: parsed.data.entry_mode,
          state: "connecting", availability: "PROOF OWED",
          provider_session_ref: ticket.storedDigest,
        }).select("id").single();
    if (scoped.error || !scoped.data) {
      console.error("[paige-live-session] relay ticket refused", { code: scoped.error?.code });
      return json({ code: "relay_ticket_unavailable", explanation: "Paige could not secure this conversation. Try again or continue in chat." }, 409);
    }
    return json({
      ok: true, session_id: scoped.data.id, availability: "PROOF OWED",
      code: "relay_ticket_issued", ticket: ticket.value, ticket_expires_at: ticket.expiresAt,
      explanation: "Paige is checking the live connection. Your microphone has not started.",
    });
  }

  if (parsed.data.action === "transition") {
    const { data, error } = await admin.rpc("paige_live_session_transition_internal", {
      _actor_user_id: user.id,
      _tenant_id: tenantId,
      _thread_id: parsed.data.thread_id,
      _context_epoch: parsed.data.context_epoch,
      _session_id: parsed.data.session_id,
      _transition: parsed.data.transition,
    });
    if (error) {
      console.error("[paige-live-session] transition refused", { code: error.code });
      return json({ code: "session_transition_refused" }, error.code === "42501" ? 403 : 409);
    }
    return json(data);
  }

  const { data, error } = await admin.rpc("paige_live_session_start_internal", {
    _actor_user_id: user.id,
    _thread_id: parsed.data.thread_id,
    _context_epoch: parsed.data.context_epoch,
    _entry_mode: parsed.data.entry_mode,
  });
  if (error) {
    console.error("[paige-live-session] start failed closed", { code: error.code });
    return json({
      ok: false,
      session_id: null,
      availability: "UNAVAILABLE",
      code: "control_plane_unavailable",
      explanation: "Paige could not verify live audio setup. Nothing was recorded or sent.",
    });
  }
  return json(data);
});
