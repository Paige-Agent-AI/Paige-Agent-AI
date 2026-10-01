// Paige Live Conversation's first-party browser WebSocket boundary.
//
// verify_jwt=false is deliberate: a browser WebSocket cannot set Authorization.
// The only credential is a one-use, 45-second opaque ticket issued by the
// JWT-gated paige-live-session function. Its SHA-256 digest is consumed by an
// atomic conditional UPDATE before upgrade; tenant/thread identity is resolved
// only from that verified database row, never from query/body tenantId.
//
// Pilot availability defaults off in the platform-owned table. Only after a
// consumed ticket, current caller-owned thread, standing, and pilot gate do
// server-side ears/mouth adapters open. The canonical paige-ai-chat stream
// remains the sole runtime; this relay never executes a spoken approval.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { APPROVED_PAIGE_ELEVENLABS_VOICE_ID, elevenlabsSpeechStream, resolveElevenLabsModel } from "../_shared/elevenlabs.ts";
import { envKey } from "../_shared/env-key.ts";
import { openFluxEars } from "../_shared/paige-live-flux-ears.ts";
import { LiveRelayAdmission, PaigeLiveRelayBridge } from "../_shared/paige-live-relay-bridge.ts";
import { createLiveRuntimeProof, liveRuntimeDigest } from "../_shared/paige-live-runtime-proof.ts";
import { consumeRelayTicket, hasLiveWorkspaceStanding, isLiveWorkspaceCurrent } from "../_shared/paige-live-ticket.ts";

const waitUntil = (promise: Promise<unknown>): void => {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  runtime?.waitUntil?.(promise);
};

Deno.serve(async (req) => {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected_websocket", { status: 426 });
  }
  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("relay_unavailable", { status: 503 });
  const admin = createClient(supabaseUrl, serviceKey);

  // The conditional UPDATE is the single-use claim. Concurrent/replayed or
  // expired tickets return no row. No socket or adapter exists before this gate.
  const session = await consumeRelayTicket(ticket, sessionId, {
    async consume(id, storedDigest) {
      const { data, error } = await admin.from("paige_live_sessions")
        .update({ provider_session_ref: null, state: "connecting", updated_at: new Date().toISOString() })
        .eq("id", id).eq("provider_session_ref", storedDigest)
        .in("state", ["connecting", "reconnecting"])
        .select("id,tenant_id,actor_user_id,thread_id,context_epoch").maybeSingle();
      if (error) {
        console.error("[paige-live-relay] ticket claim failed", { code: error.code });
        return null;
      }
      return data;
    },
  });
  if (!session) return new Response("invalid_or_consumed_ticket", { status: 401 });

  const markUnavailable = async (code: string): Promise<boolean> => {
    const { data, error } = await admin.from("paige_live_sessions")
      .update({
        state: "unavailable", availability: "UNAVAILABLE", failure_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id).eq("tenant_id", session.tenant_id)
      .eq("actor_user_id", session.actor_user_id)
      .in("state", ["connecting", "listening", "thinking", "speaking", "interrupted", "held"])
      .select("id").maybeSingle();
    if (error || !data) {
      console.error("[paige-live-relay] terminal state write failed", { code: error?.code });
      return false;
    }
    return true;
  };

  const readProviderAdmission = async () => {
  // Read back the one corrected Jessica candidate. Active read-aloud stays on
  // OpenAI; neither a browser value nor a tenant preference selects a voice.
  const { data: voice, error: voiceError } = await admin.from("paige_voice_profiles")
    .select("provider,provider_voice_ref,revision,active")
    .eq("slot", "candidate").maybeSingle();
  const voiceReady = !voiceError && voice?.provider === "elevenlabs" &&
    voice.provider_voice_ref === APPROVED_PAIGE_ELEVENLABS_VOICE_ID &&
    voice.revision === "elevenlabs-jessica-take5-r1" && voice.active === false;
  // The service-only scoped admission below joins the existing readiness,
  // candidate and inspection receipt. Pilot authorization accepts default
  // retention; it is not a legacy profile approval or a zero-retention claim.
  const modelReady = resolveElevenLabsModel() !== null;
  // Deepgram opt-out is mandatory per request in the existing STT router.
  // There is no project-level MIP switch to attest through an environment key.
  const runtimeSigningKey = envKey("PAIGE_LIVE_STREAM_SIGNING_KEY") ?? "";
  const unavailableCode = !voiceReady ? "approved_voice_unavailable"
    : !modelReady || !envKey("ELEVENLABS_API_KEY") ? "mouth_not_configured"
    : !envKey("DEEPGRAM_API_KEY") ? "ears_not_configured"
    : runtimeSigningKey.length < 32 ? "runtime_not_configured"
    : null;
    return { voice, runtimeSigningKey, unavailableCode };
  };

  const checkCurrentAdmission = async (recheckProvider = true): Promise<Response | null> => {
  // One database predicate owns scoped authorization and provider inspection.
  // It is mandatory even if legacy global transport is enabled. Reuse it on
  // renewal/PCM checks so revocation stops an already-connected relay.
  const { data: authorizedPilot, error: authorizationError } = await admin.rpc("paige_live_pilot_authorized_internal", {
    _actor_user_id: session.actor_user_id, _tenant_id: session.tenant_id,
  });
  if (authorizationError || authorizedPilot !== true) {
    if (!await markUnavailable("live_audio_not_enabled")) return new Response("relay_unavailable", { status: 503 });
    return new Response("live_audio_not_enabled", { status: 403 });
  }
  const { data: currentSession, error: currentSessionError } = await admin.from("paige_live_sessions")
    .select("id").eq("id", session.id).eq("tenant_id", session.tenant_id)
    .eq("actor_user_id", session.actor_user_id).eq("thread_id", session.thread_id)
    .eq("context_epoch", session.context_epoch)
    .in("state", ["connecting", "listening", "thinking", "speaking", "interrupted", "held"])
    .maybeSingle();
  if (currentSessionError || !currentSession) return new Response("live_admission_changed", { status: 403 });
  // The same resolution is reused before provider open, before ready and
  // throughout capture. Admission is never a once-per-socket privacy decision.
  // Recheck the original caller-owned thread after the atomic claim. The
  // ticket only identifies a server-owned session; it grants no tenant choice.
  const { data: thread, error: threadError } = await admin.from("paige_chat_threads")
    .select("id").eq("id", session.thread_id).eq("tenant_id", session.tenant_id)
    .eq("caller_user_id", session.actor_user_id).maybeSingle();
  if (threadError || !thread) {
    if (!await markUnavailable("thread_scope_mismatch")) return new Response("relay_unavailable", { status: 503 });
    return new Response("thread_scope_mismatch", { status: 403 });
  }
  // A ticket binds the original user, tenant and thread. Recheck the current
  // workspace and the same standing alternatives as current_user_tenant_id()
  // before upgrade; an agency user need not have a child tenant_members row.
  // No role label changes the caller-owned thread or grants tenant writes.
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("active_tenant_id").eq("user_id", session.actor_user_id).maybeSingle();
  if (profileError) {
    if (!await markUnavailable("workspace_unresolved")) return new Response("relay_unavailable", { status: 503 });
    return new Response("workspace_unresolved", { status: 503 });
  }
  let activeTenantHasStanding = false;
  if (profile?.active_tenant_id) {
    const { data: activeMembership, error: activeMembershipError } = await admin.from("tenant_members")
      .select("id").eq("tenant_id", profile.active_tenant_id)
      .eq("user_id", session.actor_user_id).eq("status", "active").maybeSingle();
    if (activeMembershipError) {
      if (!await markUnavailable("workspace_unresolved")) return new Response("relay_unavailable", { status: 503 });
      return new Response("workspace_unresolved", { status: 503 });
    }
    activeTenantHasStanding = !!activeMembership;
    if (!activeTenantHasStanding) {
      const [activeChildAccess, activeAgencyRole, activePlatformRole] = await Promise.all([
        admin.rpc("agency_can_manage_child", { _child: profile.active_tenant_id, _actor: session.actor_user_id }),
        admin.rpc("agency_team_role", { _agency: profile.active_tenant_id, _actor: session.actor_user_id }),
        admin.rpc("is_platform_admin", { _actor: session.actor_user_id }),
      ]);
      if (activeChildAccess.error || activeAgencyRole.error || activePlatformRole.error) {
        if (!await markUnavailable("workspace_unresolved")) return new Response("relay_unavailable", { status: 503 });
        return new Response("workspace_unresolved", { status: 503 });
      }
      activeTenantHasStanding = hasLiveWorkspaceStanding(false, activeChildAccess.data, activeAgencyRole.data, activePlatformRole.data);
    }
  }
  let fallbackTenantId: string | null = null;
  if (!activeTenantHasStanding) {
    const { data: fallback, error: fallbackError } = await admin.from("tenant_members")
      .select("tenant_id").eq("user_id", session.actor_user_id).eq("status", "active")
      .order("joined_at", { ascending: true }).limit(1).maybeSingle();
    if (fallbackError) {
      if (!await markUnavailable("workspace_unresolved")) return new Response("relay_unavailable", { status: 503 });
      return new Response("workspace_unresolved", { status: 503 });
    }
    fallbackTenantId = fallback?.tenant_id ?? null;
  }
  if (!isLiveWorkspaceCurrent(session.tenant_id, profile?.active_tenant_id, activeTenantHasStanding, fallbackTenantId)) {
    if (!await markUnavailable("stale_context")) return new Response("relay_unavailable", { status: 503 });
    return new Response("stale_context", { status: 403 });
  }
  const { data: membership, error: membershipError } = await admin.from("tenant_members")
    .select("id").eq("tenant_id", session.tenant_id)
    .eq("user_id", session.actor_user_id).eq("status", "active").maybeSingle();
  if (membershipError) {
    if (!await markUnavailable("workspace_unresolved")) return new Response("relay_unavailable", { status: 503 });
    return new Response("workspace_unresolved", { status: 503 });
  }
  let hasStanding = !!membership;
  if (!hasStanding) {
    const [childAccess, agencyRole, platformRole] = await Promise.all([
      admin.rpc("agency_can_manage_child", { _child: session.tenant_id, _actor: session.actor_user_id }),
      admin.rpc("agency_team_role", { _agency: session.tenant_id, _actor: session.actor_user_id }),
      admin.rpc("is_platform_admin", { _actor: session.actor_user_id }),
    ]);
    if (childAccess.error || agencyRole.error || platformRole.error) {
      if (!await markUnavailable("workspace_unresolved")) return new Response("relay_unavailable", { status: 503 });
      return new Response("workspace_unresolved", { status: 503 });
    }
    hasStanding = hasLiveWorkspaceStanding(false, childAccess.data, agencyRole.data, platformRole.data);
  }
  if (!hasStanding) {
    if (!await markUnavailable("membership_inactive")) return new Response("relay_unavailable", { status: 503 });
    return new Response("membership_inactive", { status: 403 });
  }
  // ONE HOME FOR "MAY THIS PERSON SPEAK" (§18). A second paige_live_tenant_availability read
  // stood here and refused on a missing row. The predicate called at the top of this same
  // function already owns that question and honours both meanings of the row, so this was a
  // duplicate answer that would have contradicted it for any workspace admitted by tier rather
  // than by a hand-written row. Revocation still stops a connected relay: it is the predicate,
  // re-run on every renewal and PCM check, that does the stopping.
  // Provider approval is revocable just like workspace authority. Reuse the
  // same canonical proof on every monitor decision and before further speech.
  if (recheckProvider) {
    const { unavailableCode: providerFailure } = await readProviderAdmission();
    if (providerFailure) {
      if (!await markUnavailable(providerFailure)) return new Response("relay_unavailable", { status: 503 });
      return new Response(providerFailure, { status: 403 });
    }
  }
  return null;
  };
  // Initial identity/standing checks still precede upgrade. A provider refusal
  // uses the structured unavailable socket below (browser WS cannot read a
  // failed handshake body). Recurring checks always include provider approval.
  const admissionFailure = await checkCurrentAdmission(false);
  if (admissionFailure) return admissionFailure;
  const { voice, runtimeSigningKey, unavailableCode } = await readProviderAdmission();
  if (unavailableCode) {
    if (!await markUnavailable(unavailableCode)) return new Response("relay_unavailable", { status: 503 });
    const { socket, response } = Deno.upgradeWebSocket(req);
    const closed = new Promise<void>((resolve) => { socket.onclose = () => resolve(); });
    waitUntil(closed);
    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: "unavailable", code: unavailableCode,
        message: "Live audio isn't ready for this workspace yet. You can keep working with Paige in chat.",
      }));
      setTimeout(() => socket.close(1013, "live_audio_unavailable"), 0);
    };
    socket.onmessage = () => { try { socket.close(1008, "audio_not_ready"); } catch { /* closed */ } };
    return response;
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const markLive = async (): Promise<boolean> => {
    const { data, error } = await admin.from("paige_live_sessions")
      .update({
        state: "listening", availability: "LIVE", failure_code: null,
        profile_provider: "elevenlabs",
        profile_provider_voice_ref: APPROVED_PAIGE_ELEVENLABS_VOICE_ID,
        profile_revision: voice?.revision,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id).eq("tenant_id", session.tenant_id)
      .eq("actor_user_id", session.actor_user_id).eq("state", "connecting")
      .select("id").maybeSingle();
    if (error || !data) {
      console.error("[paige-live-relay] ready state write failed", { code: error?.code });
      return false;
    }
    return true;
  };
  const markFailed = async (code: string): Promise<void> => {
    const { error } = await admin.from("paige_live_sessions")
      .update({
        state: "unavailable", availability: "UNAVAILABLE",
        failure_code: code, updated_at: new Date().toISOString(),
      })
      .eq("id", session.id).eq("tenant_id", session.tenant_id)
      .eq("actor_user_id", session.actor_user_id)
      .in("state", ["connecting", "listening", "thinking", "speaking", "interrupted", "held"]);
    if (error) console.error("[paige-live-relay] failure state write failed", { code: error.code });
  };
  let failureWrite: Promise<void> | null = null;
  let admissionTimer: ReturnType<typeof setInterval> | undefined;
  const admission = new LiveRelayAdmission(
    async () => (await checkCurrentAdmission()) === null,
    () => bridge.unavailable("live_admission_changed"),
  );
  const runtimeProof = createLiveRuntimeProof(runtimeSigningKey);
  let outputBlocked = false;
  const bridge = new PaigeLiveRelayBridge({
    sessionId: session.id, epoch: session.context_epoch,
    send(frame) {
      if (outputBlocked || socket.readyState !== WebSocket.OPEN) return;
      const bytes = typeof frame === "string" ? new TextEncoder().encode(frame).byteLength : frame.byteLength;
      if (socket.bufferedAmount + bytes > 262_144) {
        // Transport memory bound, not a usage cap. Set first: failure notification uses this sender.
        outputBlocked = true;
        bridge.unavailable("live_output_backpressure");
        return;
      }
      try { socket.send(frame); } catch {
        outputBlocked = true;
        bridge.unavailable("live_output_unavailable");
      }
    },
    close(code, reason) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try { socket.close(code, reason); } catch { /* already closed */ }
      }
    },
    openEars: (events) => openFluxEars(events),
    async openMouth(text, signal) {
      if (!await admission.check(true)) throw new Error("live_admission_changed");
      const response = await elevenlabsSpeechStream({
        text, voiceId: APPROVED_PAIGE_ELEVENLABS_VOICE_ID,
        modelId: resolveElevenLabsModel() ?? "",
        // check(true) above proves the stored scoped default-retention authorization.
        retentionPolicy: "default_provider_retention",
      }, signal);
      if (!response.body) throw new Error("mouth_stream_missing");
      return response.body;
    },
    usage: { emit() { /* Neutral UsageSink seam. Budget lane supplies persistence later. */ } },
    authorize: (force) => admission.check(force),
    runtimeProof: {
      readOutput: async (token) => await admission.check() ? runtimeProof.readOutput(token) : null,
      async issue(turnId, transcript) {
        if (!await admission.check()) throw new Error("live_admission_changed");
        const challenge = await runtimeProof.issue({
          sessionId: session.id, tenantId: session.tenant_id, actorId: session.actor_user_id,
          threadId: session.thread_id, epoch: session.context_epoch, turnId,
        }, transcript);
        // Reuse the service-only one-use slot AFTER the connection ticket was
        // consumed. Renewal returns to connecting and invalidates this challenge.
        const { data, error } = await admin.from("paige_live_sessions")
          .update({ provider_session_ref: `runtime:${await liveRuntimeDigest(challenge.token)}` })
          .eq("id", session.id).eq("tenant_id", session.tenant_id)
          .eq("actor_user_id", session.actor_user_id).eq("context_epoch", session.context_epoch)
          .eq("availability", "LIVE").in("state", ["listening", "thinking", "speaking", "interrupted", "held"])
          .select("id").maybeSingle();
        if (error || !data) throw new Error("live_runtime_admission_changed");
        return challenge;
      },
    },
    onFailure(code) {
      failureWrite = markFailed(code);
      waitUntil(failureWrite);
    },
  });
  const closed = new Promise<void>((resolve) => {
    socket.onclose = () => {
      clearInterval(admissionTimer);
      admission.stop();
      bridge.end();
      // A socket ending is not the user ending their logical conversation:
      // Minimize, hidden windows and reconnect all close the audio transport.
      // The existing authenticated control plane owns durable minimize/end.
      // Never overwrite it (or a renewed socket) from a delayed close callback.
      void Promise.resolve(failureWrite).finally(resolve);
    };
    socket.onerror = () => { try { socket.close(1011, "relay_unavailable"); } catch { resolve(); } };
  });
  waitUntil(closed);
  socket.onopen = () => {
    waitUntil((async () => {
      if (!await bridge.open()) return;
      if (!await admission.check(true)) return;
      if (!await markLive()) {
        bridge.unavailable("live_admission_changed");
        return;
      }
      if (!await admission.check(true)) return;
      bridge.ready();
      admissionTimer = setInterval(() => { waitUntil(admission.check(true)); }, 500);
    })());
  };
  socket.onmessage = (event) => {
    if (typeof event.data === "string" || event.data instanceof ArrayBuffer) {
      bridge.receive(event.data);
    } else {
      try { socket.close(1008, "invalid_audio_frame"); } catch { /* socket already closed */ }
    }
  };
  return response;
});
