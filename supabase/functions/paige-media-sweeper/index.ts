// paige-media-sweeper — the durable-job drainer for the media seam (cron */2).
//
// Lanes (claim_due_media_jobs, FOR UPDATE SKIP LOCKED, service-role only):
//   submission lane : created + NEVER claimed + approval cleared. Dispatches fal
//                     jobs whose authenticated-request submit didn't happen or
//                     was deferred. Sync legacy providers are NEVER dispatched
//                     here (they execute only inside the authenticated request —
//                     compliance H4); a stranded legacy 'created' row fails
//                     honestly instead.
//   poll lane       : submitted/processing + poll due → poll fal; COMPLETED →
//                     copy the asset into Paige Storage BEFORE the provider's
//                     retention expires (the copy is the whole point — provider
//                     URLs are never canonical).
//   reconcile lane  : expired/outcome_unknown + CRASHED SUBMITS (created +
//                     claimed + dead lease). With a provider_request_id:
//                     reconcile by polling. WITHOUT one: the submit's outcome is
//                     unresolvable — terminal fail, never resubmit (each submit
//                     is a fresh provider charge; anti-double-spend H1).
//
// Every pass also runs mark_exhausted_media_jobs() so out-of-attempts and
// past-window rows resolve to honest terminal states instead of claiming
// forever. The webhook remains the primary completion path; this is the
// recovery rail the owner's authorization requires.
//
// Auth: service-role bearer OR x-cron-token (the paige-inbox-triage pattern).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { falAdapter } from "../_shared/media-provider/fal.ts";
import { completeMediaJob, failMediaJob } from "../_shared/media-provider/complete.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req: Request) => {
  try {
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    let authorized = bearer.length > 0 && bearer === supabaseServiceKey;
    if (!authorized) {
      const cronToken = req.headers.get("x-cron-token") ?? "";
      if (cronToken) {
        const admin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: ok } = await admin.rpc("verify_cron_token", { _token: cronToken });
        authorized = ok === true;
      }
    }
    if (!authorized) return json({ error: "unauthorized" }, 401);

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Honest terminal states for exhausted/stale rows first.
    await admin.rpc("mark_exhausted_media_jobs").then(
      () => {},
      (e: unknown) => console.error("[media-sweeper] mark_exhausted failed:", e instanceof Error ? e.message : "unknown"),
    );
    // Then settle any holds left open by terminal jobs (never-submitted ->
    // release; submitted -> consume: the provider charge is recorded, never
    // leaked back into the pool).
    await admin.rpc("settle_media_credit_holds", { _limit: 50 }).then(
      () => {},
      (e: unknown) => console.error("[media-sweeper] settle_media_credit_holds failed:", e instanceof Error ? e.message : "unknown"),
    );

    // ── USAGE METER (owner billing supersession 2026-10-27): terminal jobs
    // whose cost was NOT covered by prepaid credits are attributed to the
    // consuming tenant in platform_usage_events (LAYER 1, the same §17 meter
    // paige-tts/stt write). Credits-covered jobs already consumed their
    // prepaid value — metering them would double-bill, so they are excluded.
    // Best-effort: a metering failure logs and retries on the next sweep; it
    // never blocks job processing. ──
    try {
      const { data: unmetered, error: unmeteredErr } = await admin
        .from("paige_media_jobs")
        .select("id,tenant_id,mode,estimated_cost_usd,actual_cost_usd,submitted_at,state")
        .in("state", ["succeeded", "failed"])
        .not("submitted_at", "is", null)
        .limit(50);
      if (unmeteredErr) throw unmeteredErr;
      for (const job of (unmetered ?? []) as Array<Record<string, unknown>>) {
        if (!job.tenant_id || typeof job.tenant_id !== "string") continue; // operator path is not a billable tenant
        const jobId = String(job.id);
        const cost = Number(job.actual_cost_usd ?? job.estimated_cost_usd) || 0;
        if (cost <= 0) continue;
        // Exclude jobs that consumed prepaid credits (any hold entry settled to consume).
        const { data: covered, error: coveredErr } = await admin
          .from("paige_media_credit_entries")
          .select("id")
          .eq("job_id", jobId)
          .eq("entry_type", "consume")
          .limit(1);
        if (coveredErr) throw coveredErr;
        if ((covered ?? []).length > 0) continue;
        // Idempotency: skip if a usage row already exists for this job.
        const { data: existing, error: existingErr } = await admin
          .from("platform_usage_events")
          .select("id")
          .eq("tenant_id", job.tenant_id)
          .eq("event_type", "media_usd")
          .contains("metadata", { job_id: jobId })
          .limit(1);
        if (existingErr) throw existingErr;
        if ((existing ?? []).length > 0) continue;
        const { error: insertErr } = await admin.from("platform_usage_events").insert({
          tenant_id: job.tenant_id,
          event_type: "media_usd",
          quantity: cost,
          unit: "usd",
          occurred_at: typeof job.submitted_at === "string" ? job.submitted_at : new Date().toISOString(),
          metadata: { job_id: jobId, mode: typeof job.mode === "string" ? job.mode : null, state: typeof job.state === "string" ? job.state : null, source: "media-sweeper" },
        });
        if (insertErr) throw insertErr;
      }
    } catch (e) {
      console.error("[media-sweeper] usage meter failed (will retry next sweep):", e instanceof Error ? e.message : "unknown");
    }

    const { data: claimed, error: claimErr } = await admin.rpc("claim_due_media_jobs", { _limit: 10 });
    if (claimErr) return json({ error: "claim_failed", detail: claimErr.message }, 500);
    const jobs = (claimed ?? []) as Record<string, unknown>[];
    if (!jobs.length) return json({ ok: true, claimed: 0 });

    const webhookUrl = `${supabaseUrl}/functions/v1/paige-media-webhook`;
    let completed = 0, failed = 0, submitted = 0, reconciled = 0;

    for (const job of jobs) {
      const jobAttempts = Number(job.attempts) ?? 1;
      const completable = { ...job, attempts: jobAttempts } as never;
      const hasRequestId = !!job.provider_request_id;
      try {
        // ── SUBMISSION-adjacent rows: state 'created', no provider request id ─
        if (job.state === "created" && !hasRequestId) {
          // Crashed submit (claimed before, attempts > 1): unresolvable — the
          // request MAY have reached fal. Terminal fail, never resubmit (H1).
          if (jobAttempts > 1) {
            await failMediaJob(
              admin,
              completable,
              "submit lease died before the provider request id was recorded; not retried to avoid double spend",
            );
            failed++;
            continue;
          }
          // Fresh dispatchable row. Sync legacy providers execute ONLY inside
          // the authenticated request (compliance H4) — strand honestly.
          if (job.provider !== "fal") {
            await failMediaJob(admin, completable, "this provider requires an authenticated request; job was not dispatched");
            failed++;
            continue;
          }
          const params = (job.params ?? {}) as Record<string, unknown>;
          const { providerRequestId } = await falAdapter.submit({
            model: String(job.model),
            mode: String(job.mode) as "image" | "image_edit" | "video",
            prompt: String(params.prompt ?? ""),
            aspectRatio: typeof params.aspect_ratio === "string" ? params.aspect_ratio : undefined,
            referenceUrls: Array.isArray(params.reference_urls) ? params.reference_urls as string[] : undefined,
            videoSeconds: typeof params.video_seconds === "number" ? params.video_seconds : undefined,
            webhookUrl,
          });
          const { data: stillLive } = await admin
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
            .eq("id", job.id)
            .eq("state", "created")
            .select("id");
          if (!stillLive?.length) {
            // Cancelled mid-submit (B3): keep it cancelled; stop the provider work.
            try {
              await falAdapter.cancel({ model: String(job.model), providerRequestId });
            } catch (e) {
              console.error("[media-sweeper] lost-race provider cancel failed:", e instanceof Error ? e.message : "unknown");
            }
            continue;
          }
          submitted++;
          continue;
        }

        // ── POLL / RECONCILE: in-flight or ambiguous, WITH a request id ──────
        if (hasRequestId) {
          const ref = { model: String(job.model), providerRequestId: String(job.provider_request_id) };
          const poll = await falAdapter.poll(ref);
          if (poll.status === "IN_QUEUE" || poll.status === "IN_PROGRESS") {
            await admin
              .from("paige_media_jobs")
              .update({
                state: poll.status === "IN_QUEUE" ? "submitted" : "processing",
                next_poll_at: new Date(Date.now() + 20_000).toISOString(),
                lease_until: null,
                claimed_at: null,
              })
              .eq("id", job.id);
            reconciled++;
            continue;
          }
          // COMPLETED: copy the asset into Paige Storage (before retention expires).
          const { artifactUrls } = await falAdapter.fetchResult(ref);
          const result = await completeMediaJob(admin, completable, artifactUrls[0]);
          if (result.state === "succeeded") completed++;
          else reconciled++;
          continue;
        }

        // ── Reconcile states WITHOUT a request id: unresolvable ──────────────
        if (job.state === "outcome_unknown" || job.state === "expired") {
          await failMediaJob(
            admin,
            completable,
            "job state is unresolvable without a provider request id; not retried to avoid double spend",
          );
          failed++;
          continue;
        }

        // Anything else (e.g. blocked/pending) releases its claim harmlessly.
        await admin.from("paige_media_jobs").update({ lease_until: null, claimed_at: null }).eq("id", job.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "sweeper failure";
        console.error("[media-sweeper] job failed:", job.id, message);
        // A poll/submit error may be transient — release the claim with a poll
        // backoff rather than failing the job outright; exhaustion is handled
        // by mark_exhausted (attempt ceiling + result window).
        await admin
          .from("paige_media_jobs")
          .update({ next_poll_at: new Date(Date.now() + 60_000).toISOString(), lease_until: null, claimed_at: null, error: message.slice(0, 500) })
          .eq("id", job.id)
          .in("state", ["created", "submitted", "processing", "outcome_unknown", "expired"]);
      }
    }

    return json({ ok: true, claimed: jobs.length, completed, failed, submitted, reconciled });
  } catch (e) {
    console.error("paige-media-sweeper error:", e);
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
});
