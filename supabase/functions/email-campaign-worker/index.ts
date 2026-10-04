// Marketing email dispatcher (E1, owner rulings 2026-10-04). pg_cron wakes it every minute with an
// x-cron-token (migration 20270547000000); a service-role bearer is also accepted.
//
// Each tick:
//   1. Claims a batch of one due campaign (email_campaign_dispatch_claim). The database has already
//      expired stale leases to outcome_unknown, blocked a campaign whose business, postal address or
//      approved sender is no longer valid, re-checked every recipient's eligibility and applied the
//      500-a-day ceiling. Only leased recipients come back.
//   2. Opens the dispatch's durable-work envelope (idempotent) and sends each recipient through the
//      ONE send seam, send-message (sender resolution, pre-send checks, suppression, provider adapter,
//      messages + audit). There is no second sending implementation here (owner ruling 2).
//   3. Records each recipient's outcome. Anything that might have reached the provider without an
//      answer is outcome_unknown and is never resent (owner ruling 6).
//   4. Settles finished campaigns and moves every open envelope to match its campaign, writing one
//      aggregated lifecycle event to the Rail per terminal or blocked state (owner ruling 19).
//
// It never decides who receives what: the approved, frozen version and its snapshot decide.
import { adminClient, corsHeaders, isAuthorizedInternalCaller, json } from "../_shared/systems-check-http.ts";
import { recordCapabilityRun, stableRunId } from "../_shared/capability-record.ts";
import { type Envelope, mapSendResult, planEnvelope, renderCampaignEmail } from "./logic.ts";

const RAIL_CAPABILITY = "marketing_email_campaign";
const BATCH_SIZE = 25;
const CONCURRENCY = 5;
const SEND_TIMEOUT_MS = 25_000;
const TICK_BUDGET_MS = 40_000;
const ENVELOPE_LEASE_SECONDS = 3600;

type Admin = ReturnType<typeof adminClient>;

type Claim = {
  campaign: { id: string; tenant_id: string; version_id: string; approved_by: string | null; kind?: string; name?: string } | null;
  blocked?: string;
  waiting?: string;
  content?: { subject: string; preheader: string; body_html: string };
  sender?: { mode: "managed" | "connector"; connector_id?: string; from_address?: string };
  postal_address?: string;
  business_name?: string | null;
  recipients?: Array<{ id: string; client_id: string | null; email: string }>;
};

async function sendOne(claim: Claim, r: { id: string; client_id: string | null; email: string }) {
  const url = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/send-message`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({
        channel: "email",
        to: r.email,
        subject: claim.content!.subject,
        body: renderCampaignEmail({
          bodyHtml: claim.content!.body_html,
          preheader: claim.content!.preheader,
          businessName: claim.business_name ?? null,
          postalAddress: claim.postal_address ?? "",
        }),
        contact_id: r.client_id ?? undefined,
        // The approved sender only: a selected connector, or none (Paige's managed identity).
        connector_id: claim.sender?.mode === "connector" ? claim.sender.connector_id : undefined,
        marketing: true,
        idempotency_key: `ecr:${r.id}`,
      }),
    });
    const body = await resp.json().catch(() => null);
    return mapSendResult(resp.status, body);
  } catch (e) {
    return mapSendResult(null, null, (e as Error)?.name === "AbortError" ? "send_timeout" : ((e as Error)?.message ?? "send_threw"));
  } finally {
    clearTimeout(timer);
  }
}

async function record(admin: Admin, recipientId: string, o: ReturnType<typeof mapSendResult>) {
  const { error } = await admin.rpc("email_campaign_dispatch_record", {
    p_recipient_id: recipientId,
    p_outcome: o.outcome,
    p_provider_message_id: o.providerMessageId ?? null,
    p_message_id: o.messageId ?? null,
    p_skip_reason: o.skipReason ?? null,
    p_error: o.error ?? null,
  });
  // A lost record leaves the lease to expire into outcome_unknown, which is the honest state.
  if (error) console.error("[email-campaign-worker] record failed", { recipientId, reason: error.message });
}

async function sendBatch(admin: Admin, claim: Claim) {
  const counts = { sent: 0, failed: 0, outcome_unknown: 0, skipped: 0 };
  const queue = [...(claim.recipients ?? [])];
  const lanes = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const outcome = await sendOne(claim, r);
      await record(admin, r.id, outcome);
      counts[outcome.outcome]++;
    }
  });
  await Promise.all(lanes);
  return counts;
}

async function moveEnvelope(admin: Admin, e: Envelope) {
  const plan = planEnvelope(e);
  if (plan.heartbeat) {
    const { error } = await admin.rpc("heartbeat_paige_durable_work", {
      _work_id: e.work_id, _server_idempotency_key: e.work_key, _lease_seconds: ENVELOPE_LEASE_SECONDS,
    });
    if (error) console.error("[email-campaign-worker] heartbeat failed", { version: e.version_id, reason: error.message });
    return { version_id: e.version_id, action: "heartbeat", ok: !error };
  }
  for (const step of plan.steps) {
    const { error } = await admin.rpc("transition_paige_durable_work", {
      _work_id: e.work_id,
      _server_idempotency_key: e.work_key,
      _new_status: step.status,
      _terminal_outcome: step.terminalOutcome ?? null,
      _safe_summary: step.safeSummary ?? null,
      _blocked_reason: step.blockedReason ?? null,
      _error_code: step.errorCode ?? null,
      _lease_seconds: ENVELOPE_LEASE_SECONDS,
      _reconciled: step.reconciled,
    });
    if (error) {
      console.error("[email-campaign-worker] envelope transition failed", { version: e.version_id, to: step.status, reason: error.message });
      return { version_id: e.version_id, action: step.status, ok: false };
    }
  }
  if (plan.rail && plan.steps.length) {
    await recordCapabilityRun(admin, {
      tenantId: e.tenant_id,
      actorId: e.approved_by,
      capabilityKey: RAIL_CAPABILITY,
      outcome: plan.rail.outcome,
      // One Rail row per version and outcome, however many ticks observe it.
      runId: await stableRunId([RAIL_CAPABILITY, e.tenant_id, e.version_id, plan.rail.outcome, e.blocked_reason ?? ""]),
      detail: plan.rail.detail,
    });
  }
  return { version_id: e.version_id, action: plan.steps.map((s) => s.status).join(">") || "none", ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const admin = adminClient();
  if (!(await isAuthorizedInternalCaller(req, admin))) return json(401, { error: "unauthorized" });

  const started = Date.now();
  const totals = { batches: 0, sent: 0, failed: 0, outcome_unknown: 0, skipped: 0 };
  const notes: Array<Record<string, unknown>> = [];

  while (Date.now() - started < TICK_BUDGET_MS) {
    const { data, error } = await admin.rpc("email_campaign_dispatch_claim", { p_limit: BATCH_SIZE });
    if (error) {
      console.error("[email-campaign-worker] claim failed", { reason: error.message });
      notes.push({ claim_error: error.message });
      break;
    }
    const claim = (data ?? { campaign: null }) as Claim;
    if (!claim.campaign) break;

    // Durable work refuses an inactive business, and there is nothing to track for one.
    if (claim.blocked !== "business_inactive") {
      const opened = await admin.rpc("email_campaign_dispatch_open", { p_version_id: claim.campaign.version_id });
      if (opened.error) console.error("[email-campaign-worker] envelope open failed", { version: claim.campaign.version_id, reason: opened.error.message });
    }

    if (claim.blocked) {
      // Now 'blocked', so it cannot be claimed again: move on to the next due campaign.
      notes.push({ campaign_id: claim.campaign.id, blocked: claim.blocked });
      continue;
    }
    if (claim.waiting || !claim.recipients?.length) {
      // At the daily ceiling, or another worker holds the rest of the batch. Settle what may be
      // finished and stop rather than claim the same campaign again in a loop.
      notes.push({ campaign_id: claim.campaign.id, waiting: claim.waiting ?? "nothing_leased" });
      await admin.rpc("email_campaign_dispatch_settle", { p_campaign_id: claim.campaign.id });
      break;
    }

    const counts = await sendBatch(admin, claim);
    totals.batches++;
    totals.sent += counts.sent;
    totals.failed += counts.failed;
    totals.outcome_unknown += counts.outcome_unknown;
    totals.skipped += counts.skipped;
    await admin.rpc("email_campaign_dispatch_settle", { p_campaign_id: claim.campaign.id });
  }

  const envelopes: Array<Record<string, unknown>> = [];
  const { data: open, error: openErr } = await admin.rpc("email_campaign_dispatch_open_envelopes", { p_limit: 50 });
  if (openErr) {
    console.error("[email-campaign-worker] envelope list failed", { reason: openErr.message });
  } else {
    for (const e of (open ?? []) as Envelope[]) {
      // A campaign with nothing left in flight settles here too (e.g. every lease expired unanswered).
      if (e.is_current && (e.campaign_status === "scheduled" || e.campaign_status === "sending")
          && e.totals.planned === 0 && e.totals.sending === 0) {
        const { data: settled } = await admin.rpc("email_campaign_dispatch_settle", { p_campaign_id: e.campaign_id });
        const s = settled as { status?: string; settled?: boolean } | null;
        if (s?.settled) {
          e.campaign_status = s.status ?? e.campaign_status;
          e.version_state = "sent";
        }
      }
      envelopes.push(await moveEnvelope(admin, e));
    }
  }

  return json(200, { ...totals, notes, envelopes, elapsed_ms: Date.now() - started });
});
