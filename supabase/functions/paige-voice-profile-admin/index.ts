// Platform-owner control seam for the server-owned Paige Voice Profile.
// Activation consumes independent canonical proof. Read-only account inspection is a separate
// owner-only action: metadata cannot activate audio or establish live transport/privacy proof.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { envKey } from "../_shared/env-key.ts";
import { inspectConfiguredVoiceProvider } from "../_shared/paige-voice-provider-inspection.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const requestSchema = z.discriminatedUnion("action", [z.object({
  action: z.literal("inspect-configured-account"),
}).strict(), z.object({
  action: z.literal("authorize-live-pilot"),
  accept_default_provider_retention: z.literal(true),
  accept_procedural_single_speaker: z.literal(true),
  // Opaque private register ID only; never accept a transcript, credential, or URL here.
  evidence_ref: z.string().uuid(),
}).strict(), z.object({
  action: z.literal("disable-live-pilot"),
}).strict(), z.object({
  // Who may use Live today, as a TIER and never a roster. This is the whole of "when the gate
  // opens, you change a setting": there is no account, login, email or workspace to supply here,
  // and the schema is `.strict()`, so one cannot be smuggled in.
  action: z.literal("set-live-rollout-scope"),
  scope: z.enum(["off", "solo_tier"]),
  // Opening Live to every Solo account extends the operator's own acceptance of DEFAULT PROVIDER
  // RETENTION to people who are not the operator. That is a decision, not a toggle, so it is
  // restated at the moment it is made rather than inherited from the earlier authorization.
  accept_default_provider_retention_for_scope: z.literal(true).optional(),
}).strict(), z.object({
  action: z.literal("activate-approved-profile"),
  profile_id: z.string().min(1).max(128),
  paige_facing_name: z.string().min(1).max(128),
  revision: z.string().min(1).max(128),
  provider: z.enum(["elevenlabs", "openai"]),
  provider_voice_ref: z.string().min(1).max(256),
  verification_id: z.string().uuid(),
  effective_at: z.string().datetime({ offset: true }),
  speech_policy: z.object({ source: z.enum(["paige-profile", "provider-dashboard"]) }).passthrough().optional(),
}).strict()]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ code: "unauthenticated" }, 401);
  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ code: "invalid_request" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return json({ code: "unauthenticated" }, 401);
  const { data: isOwner, error: ownerError } = await caller.rpc("is_platform_owner");
  if (ownerError || isOwner !== true) return json({ code: "platform_owner_required" }, 403);

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Scope comes only from the authenticated canonical workspace resolver,
  // never an account or tenant value supplied in the request body.
  if (parsed.data.action === "set-live-rollout-scope") {
    // Widening requires the acceptance to be restated in the same request that widens it. Closing
    // never does: a brake must not be harder to reach than the accelerator.
    if (parsed.data.scope !== "off" && parsed.data.accept_default_provider_retention_for_scope !== true) {
      return json({ code: "scope_retention_acceptance_required", scope_unchanged: true }, 409);
    }
    const { data: scopeResult, error } = await admin.rpc("set_paige_live_rollout_scope_internal", {
      _actor_user_id: user.id, _scope: parsed.data.scope,
    });
    if (error) return json({ code: "rollout_scope_change_refused", scope_unchanged: true }, 409);
    // Say what changed and what is still unresolved. Opening the scope does not make audio work,
    // and nothing here has observed that it does (§13): verified zero retention is still
    // UNAVAILABLE and physical speaker identity is still unenforced (#1417).
    return json({
      ok: true, code: "rollout_scope_set",
      scope: scopeResult?.scope ?? parsed.data.scope,
      subjects_withdrawn: scopeResult?.subjects_withdrawn ?? 0,
      retention_state: "default_provider_retention",
      zero_retention_state: "UNAVAILABLE",
      speaker_identity_system_enforced: false,
      live_audio_proof: "UNVERIFIED",
    });
  }
  if (parsed.data.action === "disable-live-pilot") {
    const { error } = await admin.rpc("set_paige_live_pilot_internal", {
      _actor_user_id: user.id, _tenant_id: null, _enabled: false,
      _evidence_ref: null, _inspection_id: null,
    });
    return error ? json({ code: "pilot_change_refused" }, 409) : json({ ok: true, audio_enabled: false });
  }
  if (parsed.data.action === "inspect-configured-account" || parsed.data.action === "authorize-live-pilot") {
    // The account key never leaves server memory. No caller-selected voice, host, or provider.
    const { data: profile, error: profileError } = await admin.from("paige_voice_profiles")
      .select("revision,provider,provider_voice_ref").eq("slot", "candidate").maybeSingle();
    if (profileError || !profile || profile.provider !== "elevenlabs") {
      return json({ code: "configured_candidate_unavailable", audio_enabled: false }, 409);
    }
    const observedAt = new Date().toISOString();
    // Durable attribution must exist before key resolution or any provider contact.
    const { data: audit, error: startAuditError } = await admin.from("paige_audit_log").insert({
      actor_user_id: user.id, actor_role: "super_admin",
      action: "platform.paige_voice_profile.inspect", target_type: "paige_voice_profiles",
      payload: { profile_revision: profile.revision, observed_at: observedAt, phase: "inspection_started" },
    }).select("id").single();
    if (startAuditError || !audit?.id) return json({ code: "inspection_audit_unavailable", audio_enabled: false }, 503);
    const inspection = await inspectConfiguredVoiceProvider({
      apiKey: envKey("ELEVENLABS_API_KEY"), voiceRef: profile.provider_voice_ref,
    });
    // This observation proves metadata access only, never retention. If settlement fails, the start row
    // remains for reconciliation; do not claim the metadata was durably verified.
    const { error: auditError } = await admin.from("paige_audit_log").update({
      payload: { profile_revision: profile.revision, observed_at: observedAt,
        completed_at: new Date().toISOString(), phase: "inspection_completed", inspection },
    }).eq("id", audit.id);
    if (auditError) return json({ code: "inspection_audit_unavailable", audio_enabled: false }, 503);
    if (parsed.data.action === "authorize-live-pilot") {
      const { data: tenant, error: tenantError } = await caller.rpc("current_user_tenant_id");
      if (tenantError || !tenant) return json({ code: "workspace_unresolved", audio_enabled: false }, 409);
      // A metadata read is voice access evidence, NOT a retention attestation.
      // The database writes scoped owner authorization separately and atomically.
      const { error } = await admin.rpc("set_paige_live_pilot_internal", {
        _actor_user_id: user.id, _tenant_id: tenant, _enabled: true,
        _evidence_ref: parsed.data.evidence_ref, _inspection_id: audit.id,
      });
      if (error) return json({ code: "pilot_authorization_refused", audio_enabled: false }, 409);
      return json({
        ok: true, code: "scoped_pilot_authorized", retention_state: "default_provider_retention",
        zero_retention_state: "UNAVAILABLE", speaker_identity_system_enforced: false,
        live_audio_proof: "UNVERIFIED",
      });
    }
    return json({ code: "metadata_only", profile_revision: profile.revision, observed_at: observedAt,
      inspection, audio_enabled: false, live_audio_proof: "UNVERIFIED", retention_proof: "UNVERIFIED",
      runtime_signing_key_configured: (envKey("PAIGE_LIVE_STREAM_SIGNING_KEY")?.length ?? 0) >= 32 });
  }
  // One database call owns proof validation, readiness, and profile replacement. PostgreSQL rolls
  // the whole statement back if any step fails, so transport can never be enabled by a failed
  // activation response.
  const { data: result, error: activationError } = await admin.rpc("activate_paige_voice_profile_internal", {
    _profile_id: parsed.data.profile_id, _paige_facing_name: parsed.data.paige_facing_name,
    _revision: parsed.data.revision, _provider: parsed.data.provider, _provider_voice_ref: parsed.data.provider_voice_ref,
    _speech_policy: parsed.data.speech_policy ?? { source: "provider-dashboard" },
    _effective_at: parsed.data.effective_at, _actor_user_id: user.id,
    _provider_verification_id: parsed.data.verification_id,
  });
  if (activationError) return json({ code: "canonical_provider_proof_required" }, 409);
  return json({ ok: true, paige_facing_name: result?.paige_facing_name ?? parsed.data.paige_facing_name, revision: result?.revision ?? parsed.data.revision, status: "approved" });
});
