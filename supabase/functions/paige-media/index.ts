// paige-media — the governed Vibe Studio media seam (owner build authorization
// 2026-09-12; implements docs/VIBE-MEDIA-PROVIDER-DUE-DILIGENCE.md).
//
// THE SEAM. One front door for every governed media generation: estimate →
// approval boundary → budget ladder → idempotent durable job → provider
// dispatch → (webhook | sweeper) completion → asset in Paige Storage → library
// row with rich media metadata → Rail receipt. fal.ai is the primary provider;
// the four existing image providers remain reachable through their PROVEN
// generate-image executor (invoked with the CALLER'S JWT — compliance H4 — so
// its auth/role/tenant/storage/library/memory tail runs unchanged).
//
// AUTH (compliance H2): the tenant is DERIVED SERVER-SIDE from the verified JWT
// via resolveTenantForUser — a body-supplied tenant_id is ignored entirely
// (§59: the auth subject is always auth.uid(); user_roles admin is
// tenant-AGNOSTIC and never authorizes cross-tenant action).
//
// FAIL-CLOSED LADDER (owner ruling): music → truthful unavailable; video →
// flag + per-job approval + daily completed cap; fal → secret present AND the
// owner's prepaid provider ceiling set; every job → explicit media budget
// ceiling + accrual ladder (media fails closed on unknown); premium/above-
// allowance → confirmation. Nothing spends on a hope.
//
// NO DEPENDENT CALLS EXIST YET: until the owner sets FAL_KEY and the prepaid
// ceiling, fal submissions return truthful needs_config — this function was
// built and verified read-only per the authorization.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { resolveTenantForUser } from "../_shared/tenant-for-user.ts";
import { recordCapabilityRun } from "../_shared/capability-record.ts";
import { getMediaAdapter, allMediaAdapters } from "../_shared/media-provider/registry.ts";
import { falAdapter } from "../_shared/media-provider/fal.ts";
import {
  loadMediaConfig,
  resolveMediaCeiling,
  MEDIA_CREDIT_PACKS,
} from "../_shared/media-provider/config.ts";
import {
  decideMediaBudget,
  decidePlatformSpendGuard,
  readMediaAccrual,
  readPlatformMediaAccrual,
  resolveApprovalPolicy,
} from "../_shared/media-provider/budget.ts";
import {
  estimateCredits,
  holdMediaCredits,
} from "../_shared/media-provider/credits.ts";
import { failMediaJob } from "../_shared/media-provider/complete.ts";
import { NeedsConfigError } from "../_shared/provider-types.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // ── AUTH: user JWT → role gate → SERVER-DERIVED tenant (H2) ──────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const authed = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await authed.auth.getUser();
    if (uErr || !user) return json({ error: "Unauthorized" }, 401);
    const { data: roleRows } = await authed.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (roleRows || []).map((r: { role: string }) => r.role);
    if (!roles.some((r: string) => r === "admin" || r === "super_admin")) {
      return json({ error: "Admin access required." }, 403);
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const resolved = await resolveTenantForUser(admin, user.id);
    if (!resolved.tenantId) {
      return json({ error: "No active workspace for this account — open a workspace first." }, 403);
    }
    const tenantId = resolved.tenantId;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    const config = await loadMediaConfig(admin);
    const ceilingUsd = await resolveMediaCeiling(admin, tenantId, config.dailyCeilingUsd);

    // ── capabilities: the truthful surface state (all 18 states' server side) ─
    if (action === "capabilities") {
      const providers = allMediaAdapters().map((a) => {
        const caps = a.getCapabilities();
        return {
          provider: caps.provider,
          execution: caps.execution,
          configured: caps.configured,
          models: caps.models,
          license: a.getLicenseClass(),
          retention: a.getRetentionPolicy(),
        };
      });
      const { data: videoDone } = await admin.rpc("media_video_completed_today", { _tenant: tenantId });
      return json({
        providers,
        music: { available: false, status: "unavailable", note: "Music generation is deferred from this release — no music provider is connected." },
        video: {
          available: config.videoEnabled && falAdapter.isConfigured() && config.providerCeilingUsd !== null,
          enabled: config.videoEnabled,
          provider_configured: falAdapter.isConfigured(),
          provider_ceiling_set: config.providerCeilingUsd !== null,
          completed_today: videoDone ?? 0,
          daily_limit: config.videoDailyLimit,
          note: config.videoEnabled
            ? "Video generation is approval-gated; every job shows its estimated cost before it runs."
            : "Video generation is switched off during the controlled beta.",
        },
        budget: {
          ceiling_set: ceilingUsd !== null,
          ceiling_usd: ceilingUsd,
          accrued_today_usd: await readMediaAccrual(
            (n: string, a: Record<string, unknown>) => admin.rpc(n, a),
            tenantId,
          ),
          draft_allowance_usd: config.draftAllowanceUsd,
          platform_spend_ceiling_usd: config.platformSpendCeilingUsd,
        },
        credits: await (async () => {
          // The billing read self-heals the month (lazy mint) and carries the
          // notices the Vibe surface needs — one RPC, the same truth Billing sees.
          // Called with the CALLER's client: get_workspace_media_usage is R22
          // owner-only keyed on auth.uid(), so a service-role call reads as
          // owner_only by design (the same reason the Billing hook calls it
          // from the user's session).
          const { data, error } = await authed.rpc("get_workspace_media_usage");
          if (error) return { readable: false, reason: error.message?.slice(0, 120) ?? "read failed" };
          const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
          if (!row || row.usage_state !== "ok") return { readable: false, reason: "usage_unavailable" };
          const allowance = Number(row.allowance_monthly) || 0;
          const total = Number(row.total_remaining) || 0;
          const consumed = Math.max(0, allowance - Number(row.included_remaining || 0));
          const pct = allowance > 0 ? Math.round((consumed / allowance) * 100) : null;
          return {
            readable: true,
            credit_usd: config.creditUsd,
            allowance_monthly: allowance,
            included_remaining: Number(row.included_remaining) || 0,
            purchased_remaining: Number(row.purchased_remaining) || 0,
            total_remaining: total,
            month: row.month ?? null,
            consumed_this_month: consumed,
            allowance_pct_used: pct,
            notice_band: pct == null ? null : pct >= 100 ? 100 : pct >= 80 ? 80 : pct >= 50 ? 50 : null,
          };
        })(),
        packs: MEDIA_CREDIT_PACKS,
      });
    }

    // ── estimate: cost + approval preview WITHOUT creating a job ─────────────
    if (action === "estimate") {
      const model = String(body?.model ?? "");
      const adapter = falAdapter;
      const catalog = adapter.getCapabilities().models;
      const entry = catalog.find((m) => m.id === model);
      if (!entry) return json({ error: `Unknown media model "${model}".` }, 400);
      const videoSeconds = typeof body?.video_seconds === "number" ? body.video_seconds : undefined;
      const estimate = adapter.estimateCost({ mode: entry.mode, model: entry.id, videoSeconds });
      if (!estimate) return json({ error: "No estimate available for that model." }, 400);
      const policy = resolveApprovalPolicy({
        mode: entry.mode,
        tier: entry.tier,
        estimatedCostUsd: estimate.estimatedCostUsd,
        draftAllowanceUsd: config.draftAllowanceUsd,
      });
      return json({
        model: entry.id,
        mode: entry.mode,
        tier: entry.tier,
        estimated_cost_usd: estimate.estimatedCostUsd,
        basis: estimate.basis,
        approval: policy,
        license: adapter.getLicenseClass(),
      });
    }

    // ── submit: the full fail-closed ladder, then the durable job ────────────
    if (action === "submit") {
      const prompt = String(body?.prompt ?? "").trim();
      if (prompt.length < 4) return json({ error: "Describe what you want to create." }, 400);
      const model = String(body?.model ?? "");
      const aspectRatio = ["1:1", "2:3", "3:2", "16:9", "9:16"].includes(String(body?.aspect_ratio))
        ? String(body.aspect_ratio)
        : undefined;
      const videoSeconds = typeof body?.video_seconds === "number" ? Math.max(1, Math.min(12, Math.round(body.video_seconds))) : undefined;
      const intent = body?.intent === "final" ? "final" : "draft";
      // Reference assets (image_edit): marketing_content ids resolved SERVER-SIDE
      // through the tenant-scoped read — caller names ids, never urls.
      const referenceIds: string[] = Array.isArray(body?.reference_content_ids)
        ? body.reference_content_ids.filter((v: unknown) => typeof v === "string").slice(0, 4)
        : [];

      // Music is owner-locked OFF — truthful denial on explicit music intent
      // (prompt text alone never blocks an image job; a video brief that asks
      // for music is served as video without an audio track).
      if (String(body?.mode_hint ?? "") === "music") {
        return json({ error: "Music generation is deferred from this release — no music provider is connected.", unavailable: "music" }, 403);
      }

      // fal catalog drives mode derivation (§18: the model decides, not a picker).
      const catalog = falAdapter.getCapabilities().models;
      let entry = catalog.find((m) => m.id === model);
      let provider: "fal" | "gemini" | "openai" | "replicate" | "ideogram" = "fal";

      // Legacy image providers stay first-class (owner: preserve them). Their
      // model field is '<provider>:auto'; the executor picks the concrete model.
      if (!entry && /^(gemini|openai|replicate|ideogram):/.test(model)) {
        const legacyName = model.split(":")[0] as "gemini" | "openai" | "replicate" | "ideogram";
        const legacy = getMediaAdapter(legacyName);
        if (!legacy?.isConfigured()) {
          return json({
            error: `The ${legacyName} image provider isn't configured on this account.`,
            needs_config: true,
          });
        }
        provider = legacyName;
        entry = {
          id: model,
          label: model,
          mode: "image",
          tier: "standard",
          estCostPerUnitUsd: legacyName === "replicate" ? 0.04 : 0.03,
          unit: "image",
        };
      }
      if (!entry) return json({ error: `Unknown media model "${model}".` }, 400);

      // Image edits need reference assets; plain image jobs reject them.
      if (entry.mode === "image_edit" && referenceIds.length === 0) {
        return json({ error: "Image editing needs at least one reference asset." }, 400);
      }

      // Video gates: flag → daily cap → provider config (fail closed, in order).
      if (entry.mode === "video") {
        if (!config.videoEnabled) {
          return json({ error: "Video generation is switched off during the controlled beta.", unavailable: "video" }, 403);
        }
        const { data: done } = await admin.rpc("media_video_completed_today", { _tenant: tenantId });
        if ((done ?? 0) >= config.videoDailyLimit) {
          return json({
            error: `This workspace already completed ${done} of its ${config.videoDailyLimit} daily video job${config.videoDailyLimit > 1 ? "s" : ""}. The limit resets at UTC midnight.`,
            limit_reached: true,
          }, 429);
        }
      }

      // fal spend gates: secret + the owner's prepaid provider ceiling.
      if (provider === "fal") {
        if (!falAdapter.isConfigured()) {
          return json({
            error: "Media generation isn't switched on yet — the fal provider key (FAL_KEY) isn't set.",
            needs_config: true,
          });
        }
        if (config.providerCeilingUsd === null) {
          return json({
            error: "Provider spend is gated until the owner sets the prepaid provider ceiling (media_provider_ceiling_usd).",
            needs_ceiling: true,
          });
        }
      }

      const estimate = falAdapter.estimateCost({ mode: entry.mode, model: entry.id, videoSeconds })
        ?? { estimatedCostUsd: entry.estCostPerUnitUsd, basis: "estimate: curated price table", unit: entry.unit as "image" | "second" };

      // Budget ladder (media: explicit ceiling + fail-closed on unknown).
      const accrued = await readMediaAccrual((n: string, a: Record<string, unknown>) => admin.rpc(n, a), tenantId);
      const budget = decideMediaBudget({
        accruedUsd: accrued,
        ceilingUsd,
        mode: entry.mode,
        tier: entry.tier,
        estimatedCostUsd: estimate.estimatedCostUsd,
      });
      if (budget.verdict === "deny") {
        await recordCapabilityRun(admin, {
          tenantId,
          actorId: user.id,
          capabilityKey: entry.mode === "video" ? "vibe_media_video" : "vibe_media_image",
          outcome: "capability_refused",
          detail: { reason: budget.gate, explanation: budget.explanation, model: entry.id },
        });
        return json({ error: budget.explanation, budget_denied: true, gate: budget.gate }, 429);
      }

      const policy = resolveApprovalPolicy({
        mode: entry.mode,
        tier: entry.tier,
        estimatedCostUsd: estimate.estimatedCostUsd,
        draftAllowanceUsd: config.draftAllowanceUsd,
      });

      // Resolve reference asset urls (tenant-scoped) for edit jobs.
      let referenceUrls: string[] | undefined;
      if (referenceIds.length) {
        const { data: refs, error: refErr } = await admin
          .from("marketing_content")
          .select("id, image_url")
          .eq("tenant_id", tenantId)
          .in("id", referenceIds);
        if (refErr) return json({ error: "Couldn't read the reference assets." }, 500);
        referenceUrls = (refs ?? []).map((r: { image_url: string | null }) => r.image_url).filter((u: string | null): u is string => !!u);
        if (!referenceUrls.length) return json({ error: "The reference assets couldn't be found in this workspace." }, 404);
      }

      // Idempotency: caller-minted request id (stable across retries of ONE
      // intentional request; a fresh request mints a fresh id).
      const requestId = typeof body?.request_id === "string" && body.request_id.length >= 8
        ? body.request_id.slice(0, 64)
        : crypto.randomUUID();
      const idempotencyKey = `vibe-media:${tenantId}:${user.id}:${requestId}`;

      const promptHash = await sha256Hex(prompt);
      const params = {
        prompt,
        aspect_ratio: aspectRatio,
        quality_tier: entry.tier,
        intent,
        reference_content_ids: referenceIds,
        video_seconds: entry.mode === "video" ? (videoSeconds ?? 5) : undefined,
      };

      // Create the job. An existing idempotency key returns the prior job —
      // a double-clicked submit is one job, never two.
      const { data: existing } = await admin
        .from("paige_media_jobs")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) return json({ job: existing, idempotent_replay: true });

      const { data: job, error: insertErr } = await admin
        .from("paige_media_jobs")
        .insert({
          tenant_id: tenantId,
          actor_id: user.id,
          mode: entry.mode,
          provider,
          model: entry.id,
          params,
          state: policy.approvalRequired ? "blocked" : "created",
          approval_state: policy.approvalRequired ? "pending" : "not_required",
          idempotency_key: idempotencyKey,
          estimated_cost_usd: estimate.estimatedCostUsd,
          budget_decision: { ...budget.decision, policy: policy.reason },
          video_seconds: entry.mode === "video" ? (videoSeconds ?? 5) : null,
          prompt_hash: promptHash,
        })
        .select()
        .single();
      if (insertErr || !job) {
        // A concurrent submit with the SAME key lost the unique race — that is
        // the documented replay, not an error (S1).
        if (insertErr?.code === "23505") {
          const { data: winner } = await admin
            .from("paige_media_jobs")
            .select("*")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (winner) return json({ job: winner, idempotent_replay: true });
        }
        return json({ error: "Couldn't create the media job." }, 500);
      }

      if (policy.approvalRequired) {
        return json({ job, awaiting_approval: true, reason: policy.reason, estimate });
      }
      return await dispatchJob(admin, job, { authHeader, webhookUrl: `${supabaseUrl}/functions/v1/paige-media-webhook` }, config);
    }

    // ── approve / reject: the approval boundary is SERVER-HELD state ─────────
    if (action === "approve" || action === "reject") {
      const jobId = String(body?.job_id ?? "");
      if (!jobId) return json({ error: "job_id is required." }, 400);
      const { data: job } = await admin.from("paige_media_jobs").select("*").eq("id", jobId).maybeSingle();
      if (!job || job.tenant_id !== tenantId) return json({ error: "Job not found." }, 404);
      if (job.approval_state !== "pending") return json({ error: "This job isn't awaiting approval." }, 409);

      if (action === "reject") {
        const { data: updated } = await admin
          .from("paige_media_jobs")
          .update({ approval_state: "rejected", state: "cancelled", completed_at: new Date().toISOString() })
          .eq("id", jobId)
          .eq("approval_state", "pending")
          .select()
          .single();
        return json({ job: updated });
      }

      // Approve: re-check the daily video cap at approval time (M6) and the
      // budget (the world may have changed since the estimate).
      if (job.mode === "video") {
        const { data: done } = await admin.rpc("media_video_completed_today", { _tenant: tenantId });
        if ((done ?? 0) >= config.videoDailyLimit) {
          return json({ error: `Daily video limit already reached (${done}/${config.videoDailyLimit}); resets at UTC midnight.`, limit_reached: true }, 429);
        }
      }
      const accrued = await readMediaAccrual((n: string, a: Record<string, unknown>) => admin.rpc(n, a), tenantId);
      const budget = decideMediaBudget({
        accruedUsd: accrued,
        ceilingUsd,
        mode: job.mode,
        tier: (job.params?.quality_tier === "premium" ? "premium" : "standard"),
        estimatedCostUsd: job.estimated_cost_usd ?? 0,
      });
      if (budget.verdict === "deny") return json({ error: budget.explanation, budget_denied: true, gate: budget.gate }, 429);

      const { data: updated, error: upErr } = await admin
        .from("paige_media_jobs")
        .update({ approval_state: "approved", state: "created", claimed_at: null, lease_until: null })
        .eq("id", jobId)
        .eq("approval_state", "pending")
        .eq("state", "blocked")
        .select()
        .single();
      if (upErr || !updated) return json({ error: "Couldn't approve the job (it may have been cancelled)." }, 409);
      return await dispatchJob(admin, updated, { authHeader, webhookUrl: `${supabaseUrl}/functions/v1/paige-media-webhook` }, config);
    }

    // ── cancel: propagate to the provider where a request exists ─────────────
    if (action === "cancel") {
      const jobId = String(body?.job_id ?? "");
      const { data: job } = await admin.from("paige_media_jobs").select("*").eq("id", jobId).maybeSingle();
      if (!job || job.tenant_id !== tenantId) return json({ error: "Job not found." }, 404);
      if (["succeeded", "failed", "cancelled"].includes(job.state)) {
        return json({ job, already_terminal: true });
      }
      // Terminal-bound guarded transition wins exactly once.
      const { data: updated, error: upErr } = await admin
        .from("paige_media_jobs")
        .update({ state: "cancelled", approval_state: "rejected", completed_at: new Date().toISOString(), lease_until: null })
        .eq("id", jobId)
        .not("state", "in", "(succeeded,failed,cancelled)")
        .select()
        .single();
      if (upErr || !updated) return json({ error: "Couldn't cancel the job." }, 500);

      // The reservation returns to the workspace's pool on cancel (idempotent).
      const { releaseMediaCredits } = await import("../_shared/media-provider/credits.ts");
      await releaseMediaCredits(
        (n: string, a: Record<string, unknown>) => admin.rpc(n, a),
        tenantId,
        jobId,
        "cancelled by user",
      ).then(() => {}, (e: unknown) => console.error("[paige-media] credit release failed:", e instanceof Error ? e.message : "unknown"));

      // Best-effort provider cancellation (fal only); a failed cancel of an
      // already-terminal-at-provider job is recorded, never hidden.
      if (job.provider === "fal" && job.provider_request_id) {
        try {
          await falAdapter.cancel({ model: job.model, providerRequestId: job.provider_request_id });
        } catch (e) {
          console.error("[paige-media] provider cancel failed:", e instanceof Error ? e.message : "unknown");
        }
      }
      return json({ job: updated });
    }

    // ── status / list: tenant-scoped reads ───────────────────────────────────
    if (action === "status") {
      const jobId = String(body?.job_id ?? "");
      const { data: job } = await admin.from("paige_media_jobs").select("*").eq("id", jobId).maybeSingle();
      if (!job || job.tenant_id !== tenantId) return json({ error: "Job not found." }, 404);
      return json({ job });
    }
    if (action === "list") {
      const limit = Math.max(1, Math.min(50, Number(body?.limit) || 20));
      const { data: jobs, error } = await admin
        .from("paige_media_jobs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ error: "Couldn't list media jobs." }, 500);
      return json({ jobs });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("paige-media error:", e);
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
});

/**
 * Dispatch one claimable job ('created' + approval cleared).
 *
 * ASYNC (fal): stamp the claim BEFORE the provider call (anti-double-spend H1 —
 * a crashed submit is unresolvable and routes to reconcile, never resubmit),
 * submit, record provider_request_id + submitted_at (the budget bucket).
 * SYNC (legacy four): execute inside THIS authenticated request, forwarding the
 * caller's JWT to generate-image (its auth runs natively — compliance H4). The
 * sweeper never dispatches sync providers.
 */
async function dispatchJob(
  admin: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
  opts: { authHeader: string; webhookUrl: string },
  config: { platformSpendCeilingUsd: number; creditUsd: number },
): Promise<Response> {
  const jobId = String(job.id);
  const provider = String(job.provider);
  const model = String(job.model);
  const params = (job.params ?? {}) as Record<string, unknown>;

  // Guarded claim: exactly one dispatcher moves this job out of 'created'.
  const { data: claimed, error: claimErr } = await admin
    .from("paige_media_jobs")
    .update({ claimed_at: new Date().toISOString(), lease_until: new Date(Date.now() + 5 * 60_000).toISOString(), attempts: (Number(job.attempts) || 0) + 1 })
    .eq("id", jobId)
    .eq("state", "created")
    .in("approval_state", ["approved", "not_required"])
    .select()
    .single();
  if (claimErr || !claimed) {
    return json({ job, dispatched: false, note: "Job is not dispatchable (already claimed, awaiting approval, or terminal)." });
  }

  // ── PLATFORM SPEND GUARD (owner correction 2026-09-12): the enforced
  // platform-wide daily cap, actually metered (media_spend_today_all). ──
  const platformAccrued = await readPlatformMediaAccrual((n: string, a: Record<string, unknown>) => admin.rpc(n, a));
  const guard = decidePlatformSpendGuard({
    platformAccruedUsd: platformAccrued,
    platformCeilingUsd: config.platformSpendCeilingUsd,
    estimatedCostUsd: Number(job.estimated_cost_usd) || 0,
  });
  if (!guard.ok) {
    await failMediaJob(admin, { ...job, attempts: claimed.attempts } as never, guard.explanation ?? "platform media spend guard");
    return json({ job: { ...job, state: "failed", error: guard.explanation }, platform_guard: true, error: guard.explanation }, 429);
  }

  // ── CREDIT GATE: reserve the estimate BEFORE any provider call (owner rule:
  // no unbounded overage, no provider-cost leakage). Insufficient credits fail
  // the job truthfully with the balance — never a silent negative. ──
  const creditsNeeded = estimateCredits(Number(job.estimated_cost_usd) || 0, config.creditUsd);
  const hold = await holdMediaCredits((n: string, a: Record<string, unknown>) => admin.rpc(n, a), String(job.tenant_id), jobId, creditsNeeded, Number(job.estimated_cost_usd) || undefined);
  if (!hold.ok) {
    const message = hold.insufficient
      ? `Media credits needed: this job requires about ${creditsNeeded} credits and ${hold.balance ?? 0} remain in this workspace's allowance. Add Media Credits in Settings → Billing to continue.`
      : `Media credit reservation failed: ${hold.error ?? "unknown"}. The job was not sent.`;
    await failMediaJob(admin, { ...job, attempts: claimed.attempts } as never, message);
    return json({ job: { ...job, state: "failed", error: message }, credits_insufficient: hold.insufficient === true, error: message }, 402);
  }

  if (provider === "fal") {
    try {
      const { providerRequestId } = await falAdapter.submit({
        model,
        mode: String(job.mode) as "image" | "image_edit" | "video",
        prompt: String(params.prompt ?? ""),
        aspectRatio: typeof params.aspect_ratio === "string" ? params.aspect_ratio : undefined,
        referenceUrls: Array.isArray(params.reference_urls) ? params.reference_urls as string[] : undefined,
        videoSeconds: typeof params.video_seconds === "number" ? params.video_seconds : undefined,
        webhookUrl: opts.webhookUrl,
      });
      const { data: updated } = await admin
        .from("paige_media_jobs")
        .update({
          state: "submitted",
          provider_request_id: providerRequestId,
          submitted_at: new Date().toISOString(),
          next_poll_at: new Date(Date.now() + 15_000).toISOString(),
          lease_until: null,
          claimed_at: null,
          error: null,
        })
        .eq("id", jobId)
        .eq("state", "created")
        .select()
        .single();
      if (!updated) {
        // Cancelled mid-submit (B3): keep it cancelled and best-effort stop the
        // provider work so the just-minted spend cannot orphan into a file.
        try {
          await falAdapter.cancel({ model, providerRequestId });
        } catch (e) {
          console.error("[paige-media] lost-race provider cancel failed:", e instanceof Error ? e.message : "unknown");
        }
        return json({ job: { ...job, state: "cancelled" }, dispatched: false, cancelled_mid_submit: true });
      }
      return json({ job: updated, dispatched: true });
    } catch (e) {
      // NeedsConfig → honest failure. Anything else: the submit MAY have reached
      // fal (ambiguous) — the row keeps its claim stamp and the reconcile lane
      // resolves it; it is never blindly resubmitted.
      const known = e instanceof NeedsConfigError;
      const message = e instanceof Error ? e.message : "submit failed";
      if (known) {
        await failMediaJob(admin, { ...job, attempts: claimed.attempts } as never, `provider not configured: ${message}`);
        return json({ job: { ...job, state: "failed", error: message }, needs_config: true });
      }
      // Definitive auth/validation errors (4xx we recognize) fail now; network
      // ambiguity routes to reconcile via the retained claim.
      if (/fal rejected the credential|fal submit 4\d\d/.test(message)) {
        await failMediaJob(admin, { ...job, attempts: claimed.attempts } as never, message);
        return json({ job: { ...job, state: "failed", error: message } });
      }
      await admin
        .from("paige_media_jobs")
        .update({ state: "outcome_unknown", error: message.slice(0, 500) })
        .eq("id", jobId)
        .in("state", ["created"]);
      return json({ job: { ...job, state: "outcome_unknown", error: message }, reconciling: true });
    }
  }

  // Legacy sync provider: execute inside the authenticated request. Accrual
  // starts NOW (N3): a provider spend that later fails still counts today.
  if (provider !== "fal") {
    await admin
      .from("paige_media_jobs")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("state", "created");
  }

  const legacy = getMediaAdapter(provider);
  if (!legacy) {
    await failMediaJob(admin, { ...job, attempts: claimed.attempts } as never, `unknown provider ${provider}`);
    return json({ job: { ...job, state: "failed" }, error: `unknown provider ${provider}` });
  }
  try {
    const result = await legacy.execute({
      tenantId: String(job.tenant_id),
      prompt: String(params.prompt ?? ""),
      aspectRatio: typeof params.aspect_ratio === "string" ? params.aspect_ratio : undefined,
      provider: provider as "gemini" | "openai" | "replicate" | "ideogram",
      model,
      reuseContentId: typeof params.reuse_content_id === "string" ? params.reuse_content_id : null,
      callerJwt: opts.authHeader.replace(/^Bearer\s+/i, "").trim(),
    });
    const { data: updated } = await admin
      .from("paige_media_jobs")
      .update({
        state: "succeeded",
        completed_at: new Date().toISOString(),
        content_id: result.contentId,
        submitted_at: new Date().toISOString(),
        error: null,
        lease_until: null,
        claimed_at: null,
      })
      .eq("id", jobId)
      .in("state", ["created"])
      .select()
      .single();
    await recordCapabilityRun(admin, {
      tenantId: String(job.tenant_id),
      actorId: (job.actor_id as string | null) ?? null,
      capabilityKey: "vibe_media_image",
      outcome: "capability_succeeded",
      detail: { provider, model: result.model, mode: job.mode, estimated_cost_usd: job.estimated_cost_usd, content_id: result.contentId },
    });
    return json({ job: updated ?? { ...job, state: "succeeded", content_id: result.contentId }, asset_url: result.artifactUrl, dispatched: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "generation failed";
    await failMediaJob(admin, { ...job, attempts: claimed.attempts } as never, message);
    return json({ job: { ...job, state: "failed", error: message }, error: message });
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
