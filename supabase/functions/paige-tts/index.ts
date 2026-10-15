// paige-tts: per-message chat playback through the ONE server-resolved Paige Voice Profile.
// A caller supplies text only. Provider identity, voice reference, tuning source, and immutable
// profile revision stay server-side and cannot be overridden by a browser request.
//
// FLOW
//   1. §9 GATE — resolve the tenant FROM the JWT (authed.rpc("current_user_tenant_id")), NEVER a
//      body tenant_id. Any authenticated workspace member may play back a message (playback is
//      benign; no role gate).
//   2. Resolve the approved profile through the service-only config-as-data RPC.
//   3. PLAN one attempt for that bound revision. No unapproved fallback or request override.
//   4. §14 CACHE + SYNTH — for each attempt: key = SHA-256(provider:model:voice:text), path =
//      <tenantId>/<hash>.mp3 in the PRIVATE, tenant-scoped `tts-cache` bucket (§9 — never cross-tenant,
//      never cross-provider). HIT → return stored bytes (zero cost), meter cache_hit:true. MISS →
//      RESERVE first (INT-324: every uncached attempt, whichever provider, reserves through the one
//      reserve_paige_voice_cost_internal seam before any provider call; a refusal ends the request),
//      then ElevenLabs (buffered bytes) or OpenAI (streamed + tee). Release ONLY on a typed
//      pre-dispatch NeedsConfigError; commit once the provider answered OK (before streaming); a
//      failed commit is 503 tts_cost_settlement_unavailable; any other failure stays reserved. On
//      that attempt's failure, LOUD-log and fall to the NEXT attempt (§32). The cache key + meter
//      reflect the provider that ACTUALLY rendered — never the intended one (§13).
//   5. §17 METER — chars to platform_usage_events { event_type:"tts_char", unit:"char" }, service-role,
//      with the true provider/voice/model + a fell_back flag (§13/§17 honest).
//   6. §13 HONEST DEGRADE — NEITHER provider keyed → 503 { error:"tts_not_configured" }; every keyed
//      attempt errored → 502 { error:"tts_synth_failed" }. NEVER a fake/empty audio body.
//      A refused cost reservation returns the ONE code its semantic identity proves (INT-321,
//      _shared/voice-cost-refusal.ts): 429 tts_tenant_cost_limit (+ reset_at only when the
//      canonical function supplied it) · 503 tts_platform_cost_limit · 503 tts_emergency_disabled ·
//      503 tts_workspace_voice_disabled · 503 tts_not_configured · 503 tts_voice_profile_changed
//      (a profile-revision race; retryable) · else 503 tts_cost_limit_unavailable.
//      A failed profile resolve is 503 tts_not_configured only when the resolver PROVED there is no
//      usable profile; a resolver call that merely failed is 503 voice_profile_unavailable (retryable).
//
// verify_jwt=true (config.toml): a normal authenticated fetch from the chat UI. The Authorization
// header carries the caller's session; the tenant is derived server-side from it.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import {
  planTtsSynthesis,
  resolveProfileVoice,
  ttsCacheKey,
  synthesizeSpeechStream,
} from "../_shared/tts-router.ts";
import { elevenlabsTts } from "../_shared/elevenlabs.ts";
import { NeedsConfigError } from "../_shared/provider-types.ts";
import {
  classifyVoiceCostRefusal,
  classifyVoiceProfileFailure,
  voiceCostRefusalBody,
} from "../_shared/voice-cost-refusal.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CACHE_BUCKET = "tts-cache";
const MAX_TEXT_CHARS = 4096; // OpenAI TTS hard limit; cap here so a long message never 400s at OpenAI.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, Idempotency-Key",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const audioHeaders = {
  ...corsHeaders,
  "Content-Type": "audio/mpeg",
  "Cache-Control": "no-store", // the mp3 is tenant-private; the durable cache is our Storage bucket
};

/** Best-effort background work that must outlive the streamed response (cache upload + meter). Uses
 *  the edge runtime's waitUntil when present so the write completes after we return; else awaits. */
function runAfter(p: Promise<void>): void {
  const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
  if (wu) wu(p.catch((e) => console.error("[paige-tts] background task failed:", (e as Error)?.message)));
  else void p.catch((e) => console.error("[paige-tts] background task failed:", (e as Error)?.message));
}

/** §17 meter — chars to platform_usage_events (service-role, tenant-scoped). Never throws into the
 *  request path; a metering failure is logged, not surfaced. A NULL tenantId is the operator/
 *  platform-owner path (§9 — the Super Admin is not a billable tenant, and platform_usage_events
 *  .tenant_id is NOT NULL REFERENCES tenants): we SKIP the meter and log it honestly (§13), never
 *  misattribute operator playback to a real tenant nor FK-violate on a fabricated sentinel. */
async function meterChars(
  admin: ReturnType<typeof createClient>,
  tenantId: string | null,
  chars: number,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!tenantId) {
    console.log("[paige-tts] operator/platform playback — tenant meter skipped (not a billable tenant, §9/§13)", { chars, ...meta });
    return;
  }
  try {
    const { error } = await admin.from("platform_usage_events").insert({
      tenant_id: tenantId,
      event_type: "tts_char",
      quantity: chars,
      unit: "char",
      metadata: meta,
    });
    if (error) console.error("[paige-tts] meter insert failed", { code: error.code, message: error.message, tenantId });
  } catch (e) {
    console.error("[paige-tts] meter insert threw", (e as Error)?.message);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    // ── §9 GATE: authenticate + derive tenant FROM the JWT, never the body ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthenticated" }, 401);
    const authed = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await authed.auth.getUser();
    if (uErr || !user) return json({ error: "unauthenticated" }, 401);

    const { data: resolvedTenant, error: tErr } = await authed.rpc("current_user_tenant_id");
    if (tErr) {
      console.error("[paige-tts] tenant resolve failed:", tErr.message);
      return json({ error: "workspace_unresolved" }, 500);
    }
    const tenantId = String(resolvedTenant ?? "").trim();

    // ── §9/§51 OPERATOR TIER: platform STAFF (super_admin AND scoped platform_admin) legitimately
    // have NO tenant of their own, so current_user_tenant_id() is null for them — exactly like the
    // operator's chat (paige-ai-chat tolerates a null persona tenant rather than 400ing). Mirror
    // that here: when there is no tenant, resolve the platform path INSTEAD of hard-400ing, but ONLY
    // for real platform staff. Gate on is_platform_admin() (owner ⊂ admin) — the SAME authority the
    // UI uses to admit them: PaigeWorkspace mounts PaigePlatformDesk (the chat + this audio button)
    // for `isPlatformStaff` (= is_platform_admin), so a scoped platform_admin can REACH playback and
    // must not be 400'd here (a super_admin-only gate would strand them — the Codex #386 catch).
    // A GENUINE non-staff caller with no tenant is an anomaly and STILL gets the honest 400 — §9 is
    // TIGHTENED, not loosened, for real tenants. Operator playback uses a PLATFORM-scoped cache
    // prefix (never a tenant's folder) + base voice + no tenant meter (below).
    let isOperator = false;
    if (!tenantId) {
      const { data: isStaff, error: staffErr } = await authed.rpc("is_platform_admin");
      if (staffErr) {
        console.error("[paige-tts] is_platform_admin check failed:", staffErr.message);
        return json({ error: "workspace_unresolved" }, 500);
      }
      if (isStaff !== true) return json({ error: "workspace_unresolved" }, 400);
      isOperator = true;
      console.log("[paige-tts] operator/platform-staff playback (no tenant) — resolving platform context (§9/§51)");
    }

    // Storage prefix (§9): a tenant's audio lives under `<tenantId>/`; the operator's under the
    // platform-owned `_platform/` prefix — never cross into a real tenant's folder. Meter target:
    // the real tenant, or null for the operator (skip — not a billable tenant, see meterChars).
    const storagePrefix = isOperator ? "_platform" : tenantId;
    const meterTenantId: string | null = isOperator ? null : tenantId;

    // ── Body ──
    const body = await req.json().catch(() => ({}));
    const text = String(body?.text ?? "").trim();
    if (body?.voice_id != null || body?.voiceId != null) return json({ error: "voice_override_not_allowed" }, 400);
    if (!text) return json({ error: "empty_text" }, 400);
    const capped = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // ── Resolve the one approved server profile. No tenant playbook value or request field can
    // choose a provider voice. The returned object is internal and is never included in the response.
    const { data: profile, error: profileError } = await admin.rpc("resolve_paige_voice_profile_internal", {
      _session_started_at: new Date().toISOString(),
    });
    const profileRecord = profile && typeof profile === "object"
      ? profile as Record<string, unknown>
      : null;
    const resolvedVoice = profileRecord && !profileError
      ? resolveProfileVoice({
        provider: profileRecord.provider,
        provider_voice_ref: profileRecord.provider_voice_ref,
        revision: profileRecord.revision,
        approved: profileRecord.approved,
        active: profileRecord.active,
      })
      : null;
    if (!resolvedVoice) {
      // INT-321: a resolver that PROVED there is no usable profile is configuration
      // (tts_not_configured, the client disables playback); a resolver call that merely failed is
      // transient (voice_profile_unavailable, the client offers a retry). Never sticky on a blip.
      const failure = classifyVoiceProfileFailure(profileError, profileRecord !== null);
      console.error("[paige-tts] approved Paige Voice Profile unavailable", { sqlstate: profileError?.code ?? null, code: failure.code });
      return json({ error: failure.code }, failure.status);
    }
    const voiceSource = `paige_profile:${resolvedVoice.profileRevision}`;

    // ── Plan exactly one approved profile transport. Fallback is a separately approved profile
    // revision selected by the resolver, never an implicit second attempt here. ──
    const plan = planTtsSynthesis(resolvedVoice);
    if (!plan.ok) {
      // needs_config = the selected profile's provider is not configured. Honest 503 — MessageAudioButton keys its disabled
      // state off this exact code (§37), so it must not change.
      console.error("[paige-tts] selected Paige Voice Profile transport is not configured — honest needs_config degrade");
      return json({ error: "tts_not_configured" }, 503);
    }

    // The one selected attempt owns this request. Cache and metering include its profile revision;
    // provider identity never appears in the browser response.
    let lastErr: string | null = null;
    for (let i = 0; i < plan.attempts.length; i++) {
      const attempt = plan.attempts[i];
      const usedVoice = attempt.provider === "elevenlabs" ? attempt.voiceId : attempt.voice;
      const fellBack = i > 0;
      const cacheKey = await ttsCacheKey(capped, attempt.provider, usedVoice, attempt.model);
      const cachePath = `${storagePrefix}/${cacheKey}.mp3`; // §9 tenant-scoped (or _platform for the operator); provider is in the key

      // ── §14 CACHE LOOKUP (per-attempt key) — a HIT returns immediately ──
      try {
        const { data: cached } = await admin.storage.from(CACHE_BUCKET).download(cachePath);
        if (cached) {
          const buf = await cached.arrayBuffer();
          console.log("[paige-tts] cache HIT", { scope: storagePrefix, provider: attempt.provider, profile_revision: attempt.profileRevision, bytes: buf.byteLength });
          runAfter(meterChars(admin, meterTenantId, capped.length, {
            provider: attempt.provider, profile_revision: attempt.profileRevision, model: attempt.model,
            voice_source: voiceSource, fell_back: fellBack, cache_hit: true,
          }));
          return new Response(buf, { headers: audioHeaders });
        }
      } catch {
        // Not cached — fall through to synth. Never fatal.
      }

      // ── INT-324: reserve BEFORE EITHER provider. Every uncached attempt — ElevenLabs or OpenAI —
      // reserves a conservative cost upper bound atomically through the ONE canonical seam before
      // transport. Cache hits above never reserve. Concurrent calls serialize on the platform row,
      // exact-cap is allowed, and only a provably pre-dispatch failure releases its reservation. ──
      const requestRef = crypto.randomUUID();
      const { data: reservation, error: reservationError } = await admin.rpc("reserve_paige_voice_cost_internal", {
        _actor_user_id: user.id,
        _tenant_id: meterTenantId,
        _profile_revision: attempt.profileRevision,
        _request_ref: requestRef,
        _character_count: capped.length,
      });
      const reservationId = reservation && typeof reservation === "object" && typeof (reservation as Record<string, unknown>).reservation_id === "string"
        ? String((reservation as Record<string, unknown>).reservation_id) : null;
      if (reservationError || !reservationId) {
        // INT-321: name WHICH refusal by the function's semantic identity (tenant and platform
        // caps share SQLSTATE 54000). Nothing after this returns audio or tries another
        // provider: a refused reservation ends the request, so no path can spend past the cap.
        const refusal = classifyVoiceCostRefusal(reservationError);
        console.error("[paige-tts] provider cost reservation refused", {
          provider: attempt.provider,
          sqlstate: reservationError?.code ?? null,
          identity: refusal.identity,
          code: refusal.code,
          reset_proven: refusal.resetAt !== null,
        });
        return json(voiceCostRefusalBody(refusal), refusal.status);
      }
      // Only a typed missing-key failure is provably pre-dispatch: both adapters resolve the key
      // before fetch (the ElevenLabs adapter, and openaiSpeech via openaiKey()). Every network, HTTP,
      // body-read, or empty-audio failure is ambiguous after dispatch and must remain reserved so
      // retries cannot exceed real provider spend.
      const releaseIfPreDispatch = async (e: unknown) => {
        if (e instanceof NeedsConfigError) {
          await admin.rpc("settle_paige_voice_cost_internal", { _reservation_id: reservationId, _actor_user_id: user.id, _outcome: "released" });
        }
      };
      // Commit once the provider answered OK. A failed commit leaves the reservation counting
      // against the cap: failing safe may over-count, but can never permit unrecorded spend.
      const commit = async (): Promise<boolean> => {
        const { error: settleError } = await admin.rpc("settle_paige_voice_cost_internal", { _reservation_id: reservationId, _actor_user_id: user.id, _outcome: "committed" });
        if (settleError) {
          console.error("[paige-tts] provider cost settlement failed closed", { provider: attempt.provider, code: settleError.code });
          return false;
        }
        return true;
      };

      if (attempt.provider === "elevenlabs") {
        let res: Awaited<ReturnType<typeof elevenlabsTts>>;
        try {
          res = await elevenlabsTts({ text: capped, voiceId: attempt.voiceId, modelId: attempt.model });
        } catch (e) {
          await releaseIfPreDispatch(e);
          lastErr = (e as Error)?.message ?? "elevenlabs_error";
          console.error("[paige-tts] selected provider attempt failed:", lastErr);
          continue;
        }
        const bytes = res.artifact_bytes;
        if (!bytes || bytes.length === 0) {
          // Defensive only: the adapter already rejects empty bodies. Keep the reservation counted
          // because the request crossed the provider boundary.
          lastErr = "elevenlabs_empty_bytes";
          continue;
        }
        if (!(await commit())) return json({ error: "tts_cost_settlement_unavailable" }, 503);
        runAfter((async () => {
          const { error: upErr } = await admin.storage.from(CACHE_BUCKET).upload(cachePath, bytes, { contentType: "audio/mpeg", upsert: true });
          if (upErr) console.error("[paige-tts] EL cache upload failed", { message: upErr.message, scope: storagePrefix });
          await meterChars(admin, meterTenantId, capped.length, { provider: "elevenlabs", profile_revision: attempt.profileRevision, model: attempt.model, voice_source: voiceSource, fell_back: fellBack, cache_hit: false });
        })());
        return new Response(bytes, { headers: audioHeaders });
      }

      // ── OpenAI attempt — keep the STREAMING tee path (progressive playback) ──
      let openaiResp: Response;
      try {
        openaiResp = await synthesizeSpeechStream({ model: attempt.model, voice: attempt.voice }, capped);
      } catch (e) {
        await releaseIfPreDispatch(e);
        lastErr = (e as Error)?.message ?? "openai_error";
        console.error("[paige-tts] OpenAI attempt failed:", lastErr);
        continue;
      }
      const srcBody = openaiResp.body;
      if (!srcBody) {
        // Defensive only: openaiSpeech already rejects a body-less response. Keep the reservation
        // counted because the request crossed the provider boundary.
        lastErr = "openai_no_body";
        console.error("[paige-tts] OpenAI returned no body");
        continue;
      }
      // The provider answered OK, so the spend happened: commit BEFORE streaming. A failed commit
      // returns no audio and frees the provider connection (§13: never unrecorded spend).
      if (!(await commit())) {
        await srcBody.cancel().catch(() => {});
        return json({ error: "tts_cost_settlement_unavailable" }, 503);
      }

      const [clientStream, cacheStream] = srcBody.tee();

      // Background: drain the cache branch, upload to the tenant-scoped path (upsert), then meter.
      runAfter(
        (async () => {
          const chunks: Uint8Array[] = [];
          const reader = cacheStream.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          let total = 0;
          for (const c of chunks) total += c.length;
          const bytes = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { bytes.set(c, off); off += c.length; }
          const { error: upErr } = await admin.storage
            .from(CACHE_BUCKET)
            .upload(cachePath, bytes, { contentType: "audio/mpeg", upsert: true });
          if (upErr) console.error("[paige-tts] cache upload failed", { message: upErr.message, scope: storagePrefix });
          else console.log("[paige-tts] cache STORED", { scope: storagePrefix, provider: "openai", profile_revision: attempt.profileRevision, bytes: bytes.length });
          await meterChars(admin, meterTenantId, capped.length, {
            provider: "openai", profile_revision: attempt.profileRevision, model: attempt.model,
            voice_source: voiceSource, fell_back: fellBack, cache_hit: false,
          });
        })(),
      );

      // Stream the mp3 to the client immediately (progressive — the <audio> plays as it arrives).
      return new Response(clientStream, { headers: audioHeaders });
    }

    // Every configured attempt errored — honest, never a fake audio body (§13/§32).
    console.error("[paige-tts] all TTS attempts failed:", lastErr);
    return json({ error: "tts_synth_failed" }, 502);
  } catch (e) {
    console.error("[paige-tts] unhandled error:", (e as Error)?.message);
    return json({ error: "tts_internal_error" }, 500);
  }
});
