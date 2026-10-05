// pg_cron sweeper — recovers orphaned paige_workflow_runs.
//
// Triggered every minute. Two distinct jobs:
//   1. QUEUED rows older than 60s → re-dispatch via shared dispatcher (isRetry=true).
//   2. RUNNING rows with provider='langgraph_bridge' older than 60s →
//      poll MMA OS langgraph-bridge `get_run` verb. If terminal, flip the row
//      to succeeded/failed. If still running, just bump last_dispatched_at so
//      we don't re-poll for another minute. This replaces the previous
//      "blind re-dispatch after 5 min" behavior that caused duplicate runs.
//   3. RUNNING rows on other providers older than 5 min → re-dispatch.
//
// Hard cap of 20 rows per sweep to stay inside the function budget.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { dispatchWorkflowRun } from "../_shared/workflowDispatch.ts";
import { isServiceDispatchDirectFunctionAllowed } from "../_shared/marketplace-authority-containment.ts";
import { contactHintsFromPayload, emitAutomationRail } from "../_shared/railAutomation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_URL = Deno.env.get("PAIGE_OS_LANGGRAPH_BRIDGE_URL") ?? "";
const BRIDGE_KEY = Deno.env.get("PAIGE_OS_LANGGRAPH_BRIDGE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Execution bounds (explicit, not implicit) ──────────────────────────────
// MAX_PICKS bounds EACH of the three passes; MAX_TOTAL_WORK bounds the whole
// sweep, so one invocation can never exceed a known ceiling. Before this, three
// independent LIMIT 20 queries meant an unstated real bound of 60 units of work.
const MAX_PICKS = 20;
const MAX_TOTAL_WORK = 20;
const MAX_RETRIES = 5;

// Workflow entry points. A registry row must never name one of these as its
// direct_edge_function target (requirement 14).
const RE_ENTRANT_TARGETS = new Set([
  "dispatch-queued-workflow-runs",
  "trigger-workflow",
]);

// ── Fail-closed activation gate (§13, readiness requirement 9) ─────────────
// Workflow execution has NO budget/cost control and NO Trust Compass consult on
// this path (both reported as missing contracts, neither invented here). Until
// those exist, execution stays BLOCKED by construction rather than by the
// absence of a cron schedule — an absent schedule is not a safety property, it
// is an accident that a single migration could reverse.
//
// §58: this deliberately gates a previously ungated dispatcher. It removes no
// working behaviour — paige_workflow_runs has never held a row — but it is an
// explicit, owner-visible block, not a silent one. Activation contract is in the
// PR body; flipping this flag alone is NOT sufficient to activate.
const EXECUTION_ENABLED = (Deno.env.get("WORKFLOW_EXECUTION_ENABLED") ?? "").toLowerCase() === "true";

// The sweeper runs as a privileged service-role job. It must only ever be
// callable by the scheduler/operator, never by an arbitrary caller who happens
// to know the URL — previously this handler had NO caller check at all.
function callerIsTrusted(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token.length > 0 && token === SERVICE_ROLE_KEY;
}
// LangSmith run states: 'pending' | 'running' | 'success' | 'error' | 'timeout' | 'interrupted'
const TERMINAL_OK = new Set(["success", "completed"]);
const TERMINAL_FAIL = new Set(["error", "failed", "timeout", "interrupted", "cancelled"]);

async function pollLangGraphBridgeRun(
  threadId: string | null,
  runId: string | null,
): Promise<{ status: string | null; output?: unknown; error?: string | null } | null> {
  if (!BRIDGE_URL || !BRIDGE_KEY || !runId) return null;
  try {
    const res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BRIDGE_KEY}`,
      },
      body: JSON.stringify({
        verb: "get_run",
        thread_id: threadId,
        run_id: runId,
      }),
    });
    const txt = await res.text();
    let body: any = null;
    try { body = JSON.parse(txt); } catch { /* */ }
    if (!res.ok) {
      return { status: null, error: `bridge_${res.status}: ${txt.slice(0, 200)}` };
    }
    // Bridge response shape (best-effort): { ok, run: { status, output, error } } or flat.
    const status = body?.run?.status ?? body?.status ?? null;
    const output = body?.run?.output ?? body?.output ?? body?.run ?? body;
    const error = body?.run?.error ?? body?.error ?? null;
    return { status, output, error };
  } catch (e) {
    return { status: null, error: (e as Error).message.slice(0, 200) };
  }
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!callerIsTrusted(req)) {
    return jsonRes({ ok: false, code: "unauthorized" }, 401);
  }

  if (!EXECUTION_ENABLED) {
    // Honest refusal, not a silent no-op: the caller is told the sweep did not run
    // and exactly why, so a green cron row can never be mistaken for work done.
    return jsonRes({
      ok: false,
      code: "workflow_execution_disabled",
      reason: "Workflow execution is gated off. No run was claimed, dispatched, or polled.",
      missing_contracts: ["budget_or_cost_control", "trust_compass_autonomy_consult"],
    }, 503);
  }

  const now = Date.now();
  const queuedCutoff = new Date(now - 60_000).toISOString();           // > 60s queued
  const bridgePollCutoff = new Date(now - 60_000).toISOString();       // > 60s running for bridge polling
  const runningStallCutoff = new Date(now - 5 * 60_000).toISOString(); // > 5min running for re-dispatch

  // Query errors were previously DISCARDED — a failed select returned data:null,
  // the sweep processed zero rows, and the response still said ok:true. A broken
  // sweeper was indistinguishable from an idle one (§13, requirement 15).
  const queryErrors: string[] = [];

  // 1. Queued rows needing first dispatch / retry.
  const { data: queuedRows, error: queuedErr } = await admin
    .from("paige_workflow_runs")
    .select("id, registry_id, status, payload, retry_count, created_at, last_dispatched_at")
    .eq("status", "queued")
    .lt("created_at", queuedCutoff)
    .lt("retry_count", MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(MAX_PICKS);

  if (queuedErr) queryErrors.push(`queued: ${queuedErr.message}`);

  // 2. Running rows on langgraph_bridge needing completion check.
  const { data: bridgeRunning, error: bridgeErr } = await admin
    .from("paige_workflow_runs")
    .select("id, registry_id, status, payload, n8n_execution_id, langgraph_thread_id, retry_count, last_dispatched_at, paige_workflow_registry!inner(provider, label, tenant_id)")
    .eq("status", "running")
    .eq("paige_workflow_registry.provider", "langgraph_bridge")
    .lt("last_dispatched_at", bridgePollCutoff)
    .order("last_dispatched_at", { ascending: true })
    .limit(MAX_PICKS);

  if (bridgeErr) queryErrors.push(`bridge_running: ${bridgeErr.message}`);

  // 3. Running rows on OTHER providers stalled > 5min (re-dispatch).
  const { data: otherStalled, error: stalledErr } = await admin
    .from("paige_workflow_runs")
    .select("id, registry_id, status, payload, retry_count, last_dispatched_at, paige_workflow_registry!inner(provider)")
    .eq("status", "running")
    .neq("paige_workflow_registry.provider", "langgraph_bridge")
    .lt("last_dispatched_at", runningStallCutoff)
    .lt("retry_count", MAX_RETRIES)
    .order("last_dispatched_at", { ascending: true })
    .limit(MAX_PICKS);

  if (stalledErr) queryErrors.push(`other_stalled: ${stalledErr.message}`);

  // A sweep that could not read its work queue has not swept. Refuse loudly
  // rather than returning a confident empty result.
  if (queryErrors.length > 0) {
    return jsonRes({ ok: false, code: "queue_read_failed", errors: queryErrors }, 500);
  }

  const results: Array<Record<string, unknown>> = [];

  // ----- Pass 2: completion polling for langgraph_bridge -----
  for (const r of bridgeRunning ?? []) {
    const poll = await pollLangGraphBridgeRun(
      (r as any).langgraph_thread_id ?? null,
      (r as any).n8n_execution_id ?? null,
    );
    if (!poll) {
      results.push({ run_id: r.id, mode: "bridge_poll", status: "skipped" });
      continue;
    }
    const stamp = new Date().toISOString();
    if (poll.status && TERMINAL_OK.has(poll.status)) {
      await admin.from("paige_workflow_runs").update({
        status: "succeeded",
        result: poll.output as never,
        completed_at: stamp,
        last_dispatched_at: stamp,
      }).eq("id", r.id);
      // Rail (owner_ops) — the async bridge run has genuinely COMPLETED (§13: only on
      // real terminal success). Its automation.fired was emitted at dispatch time
      // (paige-mcp), so this pairs it. Best-effort + non-blocking; skips without a client.
      {
        const reg = (r as any).paige_workflow_registry ?? {};
        const hints = contactHintsFromPayload((r as any).payload ?? {});
        await emitAutomationRail(admin, {
          tenantId: reg?.tenant_id ?? null,
          contactId: hints.contactId, email: hints.email, phone: hints.phone,
          workflowName: reg?.label ?? null,
          phase: "completed", refTable: "paige_workflow_runs", refId: r.id,
        });
      }
      results.push({ run_id: r.id, mode: "bridge_poll", status: "succeeded" });
    } else if (poll.status && TERMINAL_FAIL.has(poll.status)) {
      await admin.from("paige_workflow_runs").update({
        status: "failed",
        error: poll.error ?? `langgraph_${poll.status}`,
        result: poll.output as never,
        completed_at: stamp,
        last_dispatched_at: stamp,
      }).eq("id", r.id);
      results.push({ run_id: r.id, mode: "bridge_poll", status: "failed", error: poll.error ?? poll.status });
    } else {
      // Still running — just bump last_dispatched_at so we wait another 60s before re-polling.
      await admin.from("paige_workflow_runs").update({
        last_dispatched_at: stamp,
      }).eq("id", r.id);
      results.push({ run_id: r.id, mode: "bridge_poll", status: "still_running", remote_status: poll.status });
    }
  }

  // ----- Pass 1 + 3: dispatch queued + re-dispatch other stalled rows -----
  const toDispatch = [...(queuedRows ?? []), ...(otherStalled ?? [])].slice(0, MAX_TOTAL_WORK);
  if (toDispatch.length > 0) {
    const regIds = Array.from(new Set(toDispatch.map((r: any) => r.registry_id).filter(Boolean)));
    // Eligibility is re-read HERE, at dispatch time. Previously the registry was
    // read without is_active/tenant_id, so a workflow disabled after its run was
    // queued would still execute, and the run's tenant was never established.
    const { data: regs, error: regErr } = await admin
      .from("paige_workflow_registry")
      .select("id, key, provider, is_active, tenant_id, n8n_webhook_url, needs_n8n_link, langgraph_graph_id, direct_function_name")
      .in("id", regIds);
    if (regErr) {
      return jsonRes({ ok: false, code: "registry_read_failed", error: regErr.message }, 500);
    }
    const regMap = new Map<string, any>((regs ?? []).map((r: any) => [r.id, r]));

    for (const r of toDispatch) {
      const runId = r.id as string;
      const reg = regMap.get((r as any).registry_id);
      const fromStatus = (r as any).status as string;

      const terminate = async (error: string) => {
        await admin.from("paige_workflow_runs").update({
          status: "failed",
          error,
          completed_at: new Date().toISOString(),
          last_dispatched_at: new Date().toISOString(),
        }).eq("id", runId);
        results.push({ run_id: runId, mode: "dispatch", status: "failed", error });
      };

      if (!reg) { await terminate("registry_row_missing"); continue; }

      // Requirement 2/3 — only an explicitly ENABLED workflow may be claimed. A
      // draft/disabled/retired registry row terminates its queued run truthfully
      // instead of executing it.
      if (reg.is_active !== true) { await terminate("workflow_not_active"); continue; }

      // Requirement 14 — re-entrancy bound. A registry row that names a workflow
      // entry point as its direct target would loop this dispatcher against
      // itself. Refuse structurally rather than relying on a depth counter that
      // nothing currently increments.
      if (
        reg.provider === "direct_edge_function" &&
        RE_ENTRANT_TARGETS.has(String(reg.direct_function_name ?? ""))
      ) {
        await terminate(`re_entrant_target_refused:${reg.direct_function_name}`);
        continue;
      }
      // INT-310 dispatch allowlist: this sweeper dispatches with the SERVICE ROLE, so a direct target
      // that is not allowlisted ends in an honest terminal state here, before it is ever claimed.
      if (reg.provider === "direct_edge_function" && !isServiceDispatchDirectFunctionAllowed(reg.direct_function_name)) {
        await terminate("direct_function_not_allowlisted");
        continue;
      }

      // Requirements 4 + 5 — ATOMIC CLAIM. A compare-and-swap on the row's own
      // status is the claim: only the dispatcher whose UPDATE actually matched
      // (rows returned) owns this run. Two concurrent sweeps therefore cannot
      // both dispatch it, and a re-entrant sweep cannot re-dispatch a run it
      // already moved. Previously the row was SELECTed and dispatched with no
      // claim at all, so overlapping invocations duplicated every dispatch.
      // This uses only statuses the existing CHECK already permits
      // ('queued','running','succeeded','failed','cancelled') — no schema change.
      const claimStamp = new Date().toISOString();
      let claimQuery = admin
        .from("paige_workflow_runs")
        .update({ status: "running", last_dispatched_at: claimStamp })
        .eq("id", runId)
        .eq("status", fromStatus);
      if (fromStatus === "running") {
        // A stalled re-dispatch does NOT change status, so status alone is not a
        // claim. The timestamp is: only the sweep that sees the OLD
        // last_dispatched_at wins. (Safe here — a running row always has one.)
        // Deliberately NOT applied to 'queued': a fresh run has
        // last_dispatched_at NULL, and a NULL comparison would match nothing,
        // making first dispatch permanently unclaimable.
        claimQuery = claimQuery.lt("last_dispatched_at", claimStamp);
      }
      const { data: claimed, error: claimErr } = await claimQuery.select("id");
      if (claimErr) {
        results.push({ run_id: runId, mode: "claim", status: "error", error: claimErr.message });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        // Someone else won the race, or the row moved on. Not an error.
        results.push({ run_id: runId, mode: "claim", status: "not_claimed" });
        continue;
      }

      const out = await dispatchWorkflowRun({
        runId,
        provider: reg.provider,
        n8nWebhookUrl: reg.n8n_webhook_url,
        needsN8nLink: reg.needs_n8n_link,
        langgraphGraphId: reg.langgraph_graph_id,
        directFunctionName: reg.direct_function_name,
        payload: ((r as any).payload as Record<string, unknown>) ?? {},
        isRetry: true,
        // The §118/§200 platform-owner provider gate in workflowDispatch is keyed
        // on callerTenantId. Omitting it BYPASSES that gate — which this sweeper
        // previously did for every row. Passing the run's OWN registry tenant
        // means a tenant-scoped row can no longer reach platform-owner-only
        // providers just because a cron job, rather than a user, dispatched it.
        callerTenantId: reg.tenant_id ?? null,
      });
      results.push({
        run_id: runId,
        mode: fromStatus === "queued" ? "first_dispatch" : "redispatch",
        workflow_key: reg.key,
        status: out.status,
        error: out.error ?? null,
      });
    }
  }

  // Requirement 12/13 — bounded retry with an EXPLICIT terminal state. Rows at or
  // past MAX_RETRIES were previously just filtered out of every query: they sat
  // in 'queued' forever, invisible, with nothing recording that they had been
  // abandoned. The existing status CHECK has no dedicated dead-letter value, so
  // the terminal state used is 'failed' with a dead_letter error marker; a true
  // dead-letter column is reported as a missing schema contract, not invented.
  const { data: exhausted, error: exhaustedErr } = await admin
    .from("paige_workflow_runs")
    .select("id")
    .eq("status", "queued")
    .gte("retry_count", MAX_RETRIES)
    .limit(MAX_TOTAL_WORK);
  if (!exhaustedErr) {
    for (const row of exhausted ?? []) {
      await admin.from("paige_workflow_runs").update({
        status: "failed",
        error: `dead_letter: retry_count >= ${MAX_RETRIES}`,
        completed_at: new Date().toISOString(),
      }).eq("id", row.id).eq("status", "queued");
      results.push({ run_id: row.id, mode: "dead_letter", status: "failed" });
    }
  }

  // §13 — ok reflects what actually happened. A sweep in which any unit of work
  // errored is not an ok sweep, even though the rest of it succeeded.
  const errored = results.filter((x) => x.status === "error" || x.error).length;
  return jsonRes({
    ok: errored === 0,
    queued_picked: queuedRows?.length ?? 0,
    bridge_polled: bridgeRunning?.length ?? 0,
    other_stalled: otherStalled?.length ?? 0,
    errored,
    results,
  });
});
