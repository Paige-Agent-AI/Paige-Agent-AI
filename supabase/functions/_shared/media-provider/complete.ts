/**
 * Media job completion — the ONE tail every completion path shares (webhook and
 * sweeper both land here). Idempotent by job id: a job already terminal is a
 * no-op, so duplicate provider callbacks are harmless (owner authorization:
 * "make webhook handling idempotent").
 *
 * The tail, in order:
 *   1. fetch the provider artifact BYTES (bounded 30s / 25MB — the
 *      generate-image fetchUrlBytes precedent);
 *   2. upload to the paige-generated bucket under the tenant prefix (the
 *      provider URL is NEVER the canonical asset source);
 *   3. file to the EXISTING marketing_content library via save_marketing_content
 *      (p_meta carries the rich media metadata — one asset database);
 *   4. mark the job succeeded + completed_at (verified write before "done" —
 *      durable contract honest-state rule);
 *   5. record the Rail receipt via record_capability_run (correlated to the job).
 *
 * On any failure the job does NOT read succeeded: a fetch/storage failure marks
 * `outcome_unknown` when the provider says COMPLETED (the asset exists at the
 * provider; reconcile = retry the copy), `failed` only for definitive errors.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { recordCapabilityRun } from "../capability-record.ts";
import { idempotencyKey } from "../durable-job/mod.ts";
import { COMMERCIAL_USE_DISCLOSURE, MEDIA_NON_TERMINAL_STATES as NON_TERMINAL_STATES, MEDIA_TERMINAL_STATES } from "./mod.ts";
import { consumeMediaCredits, estimateCredits, releaseMediaCredits } from "./credits.ts";
import { linkStudioArtifact } from "./studio-link.ts";

export interface CompletableJob {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  /** Present once the provider accepted the request — the release/consume pivot. */
  submitted_at: string | null;
  mode: string;
  provider: string;
  model: string;
  params: Record<string, unknown> | null;
  estimated_cost_usd: number | null;
  content_id: string | null;
  prompt_hash: string | null;
  video_seconds: number | null;
  state: string;
  attempts: number | null;
}

/** Read the configured credit value (media_credit_usd) — same key the seam reads. */
async function readCreditUsd(admin: SupabaseClient): Promise<number> {
  try {
    const { data } = await admin
      .from("admin_app_settings")
      .select("value")
      .eq("key", "media_credit_usd")
      .maybeSingle();
    const n = Number((data as { value?: unknown } | null)?.value);
    return Number.isFinite(n) && n > 0 ? n : 0.01;
  } catch {
    return 0.01;
  }
}

async function fetchArtifactBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`fetching provider artifact failed (${resp.status})`);
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 25 * 1024 * 1024) throw new Error("provider artifact exceeded the 25MB cap");
    const contentType = resp.headers.get("content-type") ?? (url.includes(".mp4") ? "video/mp4" : "image/png");
    return { bytes: new Uint8Array(buf), contentType };
  } finally {
    clearTimeout(t);
  }
}

function extFor(contentType: string, mode: string): string {
  if (contentType.includes("mp4") || mode === "video") return "mp4";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg")) return "jpg";
  return "png";
}

const TERMINAL_STATES = new Set(MEDIA_TERMINAL_STATES);

/** Deterministic attempt correlation (the durable-job contract's idempotencyKey helper). */
function jobAttemptId(job: CompletableJob): string {
  return idempotencyKey("vibe-media", job.id, String(job.attempts ?? 1));
}

/**
 * Complete one job. Returns the updated state so callers can log truthfully.
 * `admin` MUST be a service-role client.
 *
 * ATOMIC GUARDED COMPLETION (M1): the terminal transition runs as a guarded
 * UPDATE (`WHERE state IN (non-terminal)`) WITH `.select()` so a concurrent
 * webhook-vs-sweeper double copy resolves to exactly one winner — the loser
 * sees zero rows and reports the winner's state instead of double-filing.
 */
export async function completeMediaJob(
  admin: SupabaseClient,
  job: CompletableJob,
  artifactUrl: string,
): Promise<{ state: string; contentId: string | null; storagePath: string | null; error?: string }> {
  // Idempotency: terminal jobs are returned as-is (duplicate callbacks).
  if (TERMINAL_STATES.has(job.state)) {
    return { state: job.state, contentId: job.content_id, storagePath: null };
  }

  const prompt = typeof job.params?.prompt === "string" ? (job.params.prompt as string) : "";

  // CLAIM-FIRST (S2): exclusively claim the completion before any side effect.
  // The winner moves to 'processing' with a poll deadline (a completer that
  // dies mid-copy self-heals through the poll lane); the loser stops here with
  // the winner's truth — no double storage upload, no double library row.
  const { data: claimedCompletion, error: claimErr } = await admin
    .from("paige_media_jobs")
    .update({ state: "processing", next_poll_at: new Date(Date.now() + 60_000).toISOString() })
    .eq("id", job.id)
    .in("state", NON_TERMINAL_STATES)
    .is("content_id", null)
    .select("id");
  if (claimErr) throw new Error(`completion claim failed: ${claimErr.message}`);
  if (!claimedCompletion?.length) {
    return { state: job.state === "succeeded" ? "succeeded" : "processing", contentId: job.content_id, storagePath: null };
  }

  try {
    const { bytes, contentType } = await fetchArtifactBytes(artifactUrl);
    const stamp = Date.now();
    const rand = crypto.randomUUID().slice(0, 8);
    const path = `${job.tenant_id}/${stamp}-${rand}.${extFor(contentType, job.mode)}`;

    const { error: upErr } = await admin.storage.from("paige-generated").upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
    const { data: pub } = admin.storage.from("paige-generated").getPublicUrl(path);
    const publicUrl = pub?.publicUrl ?? null;
    if (!publicUrl) throw new Error("storage returned no public url");

    // File to the ONE asset library. p_meta carries the rich media metadata the
    // owner's authorization requires — provider/model/license/cost/retention/
    // review state/publish eligibility. reuse_content_id stacks versions.
    const meta = {
      media_job_id: job.id,
      provider: job.provider,
      model: job.model,
      mode: job.mode,
      prompt_hash: job.prompt_hash,
      cost_estimate_usd: job.estimated_cost_usd,
      cost_actual_usd: null,
      license_class: "provider_and_model_terms",
      commercial_use: "conditional",
      commercial_use_disclosure: COMMERCIAL_USE_DISCLOSURE,
      retention_policy: "copied_to_paige_storage_on_completion",
      moderation_result: null,
      review_state: "review_ready",
      publish_eligible: false,
      publish_note: "Social publishing becomes available after this account's Social connection and publishing path are verified.",
    };
    const title = prompt.slice(0, 60) + (prompt.length > 60 ? "…" : "") || "Generated media";
    const { data: contentId, error: saveErr } = await admin.rpc("save_marketing_content", {
      p_kind: job.mode === "video" ? "video" : "image",
      p_title: title,
      p_image_url: publicUrl,
      p_image_path: path,
      p_size: typeof job.params?.aspect_ratio === "string" ? job.params.aspect_ratio : null,
      p_brief: prompt.slice(0, 500),
      p_meta: meta,
      // A Studio refine names the canvas image (verified at submit): the result becomes its next
      // version instead of a separate image.
      p_id: typeof job.params?.reuse_content_id === "string" ? job.params.reuse_content_id : null,
      p_tenant_id: job.tenant_id,
    });
    if (saveErr) throw new Error(`library save failed: ${saveErr.message}`);

    // Verified write BEFORE "done": the asset is in OUR storage and the job row
    // transitions only now (the claim above already made this completer the
    // exclusive owner of the transition).
    const { error: jobErr } = await admin
      .from("paige_media_jobs")
      .update({
        state: "succeeded",
        completed_at: new Date().toISOString(),
        content_id: (contentId as string) ?? null,
        error: null,
        lease_until: null,
        claimed_at: null,
      })
      .eq("id", job.id)
      .in("state", NON_TERMINAL_STATES);
    if (jobErr) throw new Error(`job terminal update failed: ${jobErr.message}`);

    await recordCapabilityRun(admin, {
      tenantId: job.tenant_id,
      actorId: job.actor_id,
      capabilityKey: job.mode === "video" ? "vibe_media_video" : "vibe_media_image",
      outcome: "capability_succeeded",
      correlation: { jobAttemptId: jobAttemptId(job) },
      detail: {
        provider: job.provider,
        model: job.model,
        mode: job.mode,
        estimated_cost_usd: job.estimated_cost_usd,
        storage_path: path,
        content_id: (contentId as string) ?? null,
      },
    });

    await linkStudioArtifact(admin, job, (contentId as string) ?? null);

    // CREDIT RECONCILIATION: convert the hold into a consume for the actual
    // draw (idempotent per job; a low estimate is clamped honestly by the RPC).
    // credit_usd is config-as-data — read it the same way the seam does.
    const creditUsd = await readCreditUsd(admin);
    const consumed = await consumeMediaCredits(
      (n: string, a: Record<string, unknown>) => admin.rpc(n, a),
      job.tenant_id,
      job.id,
      estimateCredits(Number(job.estimated_cost_usd) || 0, creditUsd),
    );
    if (!consumed.ok && consumed.error && consumed.error !== "no_open_hold") {
      console.error("[media-complete] credit consume failed:", consumed.error);
    }

    return { state: "succeeded", contentId: (contentId as string) ?? null, storagePath: path };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown completion failure";
    // The copy failed AFTER the provider completed — the asset exists at the
    // provider: outcome_unknown, reconcile by retrying the copy (never blind-fail).
    const { error: markErr } = await admin
      .from("paige_media_jobs")
      .update({ state: "outcome_unknown", error: message.slice(0, 500), lease_until: null })
      .eq("id", job.id)
      .in("state", NON_TERMINAL_STATES);
    if (markErr) console.error("[media-complete] outcome_unknown mark failed:", markErr.message);

    await recordCapabilityRun(admin, {
      tenantId: job.tenant_id,
      actorId: job.actor_id,
      capabilityKey: job.mode === "video" ? "vibe_media_video" : "vibe_media_image",
      outcome: "capability_outcome_unknown",
      correlation: { jobAttemptId: jobAttemptId(job) },
      detail: { provider: job.provider, model: job.model, mode: job.mode, reason: message.slice(0, 200) },
    });
    return { state: "outcome_unknown", contentId: null, storagePath: null, error: message };
  }
}

/** Mark a job definitively failed (definitive provider error / exhausted attempts). */
export async function failMediaJob(
  admin: SupabaseClient,
  job: CompletableJob,
  reason: string,
): Promise<void> {
  // CREDIT SETTLEMENT (anti-leakage): a job that VERIFIABLY never reached the
  // provider releases its reservation; a job that was submitted CONSUMES it —
  // fal already charged, and returning those credits would leak provider cost
  // into the platform. The RPC's own state gate is the authority; this mirrors
  // it so the attempt is honest even if the job row raced.
  if (job.submitted_at == null) {
    const released = await releaseMediaCredits(
      (n: string, a: Record<string, unknown>) => admin.rpc(n, a),
      job.tenant_id,
      job.id,
      `job failed: ${reason.slice(0, 120)}`,
    );
    if (!released.ok && released.error) {
      console.error("[media-complete] credit release failed:", released.error);
    }
  } else {
    const consumed = await consumeMediaCredits(
      (n: string, a: Record<string, unknown>) => admin.rpc(n, a),
      job.tenant_id,
      job.id,
      estimateCredits(Number(job.estimated_cost_usd) || 0, await readCreditUsd(admin)),
    );
    if (!consumed.ok && consumed.error) {
      console.error("[media-complete] credit consume on failure failed:", consumed.error);
    }
  }
  const { error } = await admin
    .from("paige_media_jobs")
    .update({ state: "failed", error: reason.slice(0, 500), completed_at: new Date().toISOString(), lease_until: null, claimed_at: null })
    .eq("id", job.id)
    .in("state", NON_TERMINAL_STATES);
  if (error) console.error("[media-complete] fail mark failed:", error.message);

  await recordCapabilityRun(admin, {
    tenantId: job.tenant_id,
    actorId: job.actor_id,
    capabilityKey: job.mode === "video" ? "vibe_media_video" : "vibe_media_image",
    outcome: "capability_failed",
    correlation: { jobAttemptId: jobAttemptId(job) },
    detail: { provider: job.provider, model: job.model, mode: job.mode, reason: reason.slice(0, 200) },
  });
}

/** Helper for the sweeper/webhook to build a service client once. */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
