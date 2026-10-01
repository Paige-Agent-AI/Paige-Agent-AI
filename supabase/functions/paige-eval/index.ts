// paige-eval — §34 Layer 2 (Quality/Evals), Slice 1. Paige's internal "Evals" department (NOT
// Braintrust): score a target (a dataset of cases, or a batch of real paige_llm_trace rows) with a
// set of scorers and record a run + per-case results. This is how a change to Paige's intelligence is
// measured as BETTER or WORSE on real data — the L1 traces are the substrate this scores over.
//
// SHIPS INERT / OPT-IN: this endpoint exists and is directly invokable by an admin JWT (or the
// service-role headless agent), but NOTHING auto-triggers it — no cron, no wire into paige-deep-research.
// An eval only runs when a caller POSTs here.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//   Request: {
//     dataset_id?: uuid,                          // score a dataset's cases (paige_eval_case)  ─┐ one of
//     trace_selector?: { job_kind?, task_id?, since?, limit? },  // OR score real trace rows    ─┘ these
//     scorers: string[],                          // REQUIRED — deterministic names and/or "rubric_judge"
//     rubric?: string,                            // rubric applied to trace-batch cases (for rubric_judge)
//     target?: { kind?, ref?, version? },         // optional target metadata (derived from dataset otherwise)
//     prev_run_id?: uuid,                         // baseline run to compare aggregate against (regression)
//     tenant_id?: uuid                            // REQUIRED for a service-role caller; IGNORED for a JWT
//                                                 // caller unless super_admin (tenant derived from session, §9)
//   }
//   200 { ok:true, ...EvalResult }                              — scored (something produced a real score)
//   200 { ok:false, needs_config:true, ...EvalResult }          — nothing scored (honest degrade, §13/§31)
//   4xx { error }                                               — bad input / auth / scope
//
// ── DOCTRINE ─────────────────────────────────────────────────────────────────
//   §9  — a JWT caller can ONLY eval for their OWN tenant: tenantId from current_user_tenant_id(),
//         body.tenant_id IGNORED (except super_admin). Trace rows are filtered to the resolved tenant,
//         so NO cross-tenant trace can ever be scored. A platform/golden dataset (tenant_id NULL) is
//         runnable only by a platform actor (super_admin / service-role).
//   §13/§31 — HONEST throughout: aggregate_score is NULL when nothing scored (never 0-coerced); a run
//         that produced no real score is status 'needs_config', not a fabricated pass. The gate/scorers
//         never throw into this handler.
//   §17 — the rubric_judge scorer routes through routedChatCompletion("plan") = Claude reasoning tier by
//         construction — a quality JUDGMENT never runs on an open model. judge_model is logged per result.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { runEval, type EvalCase } from "../_shared/eval/gate.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRACE_LIMIT = 200;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "A bearer token is required." });
    const token = authHeader.slice("Bearer ".length).trim();
    // §9 defense-in-depth (the #361 paige-orchestrator pattern): trust the service path ONLY on an EXACT
    // match to the real service-role key — not on a decodable `role` claim. This removes the latent
    // verify_jwt=false escalation coupling: even if this fn were ever set verify_jwt=false, a forged
    // {role:"service_role"} token can't equal the secret. Paige's headless agent sends this literal key.
    const isServiceRole = token === supabaseServiceKey;

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json(400, { error: "Request body must be JSON." }); }

    // ── inputs ────────────────────────────────────────────────────────────────────────────────
    const datasetId = UUID_RE.test(str(body.dataset_id)) ? str(body.dataset_id) : null;
    const traceSelector = (body.trace_selector && typeof body.trace_selector === "object")
      ? body.trace_selector as Record<string, unknown> : null;
    // Human thumbs feedback (§34-L2 feedback channel) — response_quality_feedback rows
    // as self-contained labeled eval cases, TENANT-SCOPED. No trace join needed.
    const feedbackSelector = (body.feedback_selector && typeof body.feedback_selector === "object")
      ? body.feedback_selector as Record<string, unknown> : null;
    if (!datasetId && !traceSelector && !feedbackSelector) return json(400, { error: "Provide dataset_id, trace_selector, or feedback_selector." });

    const scorers = Array.isArray(body.scorers) ? body.scorers.filter((s) => typeof s === "string" && s.trim()) as string[] : [];
    if (scorers.length === 0) return json(400, { error: "scorers[] is required (deterministic names and/or 'rubric_judge')." });
    const requestRubric = str(body.rubric).slice(0, 4000);
    const prevRunId = UUID_RE.test(str(body.prev_run_id)) ? str(body.prev_run_id) : null;
    const targetOverride = (body.target && typeof body.target === "object") ? body.target as Record<string, unknown> : {};

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // ── §9 tenant resolution — JWT caller can ONLY eval for THEIR OWN tenant ─────────────────────
    let resolvedTenant: string | null = null;
    let actorUserId: string | null = null;
    let isPlatformActor = false; // service-role or super_admin — may run platform/golden datasets
    if (isServiceRole) {
      resolvedTenant = str(body.tenant_id);
      if (!UUID_RE.test(resolvedTenant)) return json(400, { error: "A service-role caller must pass a valid tenant_id." });
      isPlatformActor = true;
    } else {
      const authed = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: uErr } = await authed.auth.getUser();
      if (uErr || !user) return json(401, { error: uErr?.message || "Could not verify this session." });
      actorUserId = user.id;
      const { data: roleRows } = await authed.from("user_roles").select("role").eq("user_id", user.id);
      const roles = (roleRows || []).map((r: Record<string, unknown>) => r.role);
      if (!roles.some((r) => r === "admin" || r === "super_admin")) {
        return json(403, { error: "Admin access required." });
      }
      isPlatformActor = roles.includes("super_admin");
      const { data: activeTenant } = await authed.rpc("current_user_tenant_id");
      // super_admin may target an explicit tenant; everyone else is pinned to their own (§9 — body not trusted).
      resolvedTenant = (isPlatformActor && UUID_RE.test(str(body.tenant_id))) ? str(body.tenant_id) : str(activeTenant);
      if (!UUID_RE.test(str(resolvedTenant))) return json(403, { error: "No tenant is in scope for this session." });
    }

    // ── build the cases + target from the dataset OR the trace selector ──────────────────────────
    let cases: EvalCase[] = [];
    let targetKind = str(targetOverride.kind) || null;
    let targetRef = str(targetOverride.ref) || null;
    const targetVersion = str(targetOverride.version) || null;
    // The tenant stamp for the run + results: a golden dataset (tenant_id NULL) stamps NULL; everything
    // else stamps the resolved tenant. This keeps §9: a platform/golden eval never lands on a tenant row.
    let effectiveTenant: string | null = resolvedTenant;

    if (datasetId) {
      const { data: ds, error: dsErr } = await admin
        .from("paige_eval_dataset")
        .select("id, tenant_id, target_kind, target_ref")
        .eq("id", datasetId)
        .maybeSingle();
      if (dsErr) return json(500, { error: `Failed to load dataset: ${dsErr.message}` });
      if (!ds) return json(404, { error: "Dataset not found." });

      // §9 scope: a tenant-owned dataset is runnable only by that tenant; a golden (NULL) dataset only
      // by a platform actor (super_admin / service-role). Admin client bypasses RLS, so enforce here.
      const dsTenant = (ds as Record<string, unknown>).tenant_id as string | null;
      if (dsTenant === null) {
        if (!isPlatformActor) return json(403, { error: "This is a platform dataset; only the operator can run it." });
        effectiveTenant = null;
      } else if (dsTenant !== resolvedTenant) {
        return json(403, { error: "This dataset belongs to another tenant." });
      } else {
        effectiveTenant = resolvedTenant;
      }

      targetKind = targetKind || (str((ds as Record<string, unknown>).target_kind) || null);
      targetRef = targetRef || (str((ds as Record<string, unknown>).target_ref) || null);

      const { data: caseRows, error: cErr } = await admin
        .from("paige_eval_case")
        .select("id, input, expected, rubric, source_trace_id")
        .eq("dataset_id", datasetId)
        .order("created_at", { ascending: true })
        .limit(MAX_TRACE_LIMIT);
      if (cErr) return json(500, { error: `Failed to load cases: ${cErr.message}` });
      cases = (caseRows || []).map((r: Record<string, unknown>) => ({
        caseId: (r.id as string) ?? null,
        sourceTraceId: (r.source_trace_id as string) ?? null,
        // Slice 1 does NOT execute a target: a case's stored `input` jsonb IS the produced output the
        // scorers judge; `expected` is the gold reference; `rubric` (or the request rubric) drives the judge.
        output: r.input,
        expected: r.expected,
        rubric: (typeof r.rubric === "string" && r.rubric.trim()) ? (r.rubric as string) : (requestRubric || undefined),
      }));
    } else if (traceSelector) {
      // Score REAL trace rows — ALWAYS filtered to the resolved tenant, so no cross-tenant trace is scorable.
      targetKind = targetKind || "trace_batch";
      const jobKind = str(traceSelector.job_kind);
      targetRef = targetRef || (jobKind || "traces");
      let q = admin
        .from("paige_llm_trace")
        .select("id, output_excerpt, job_kind, task_id, created_at")
        .eq("tenant_id", resolvedTenant);
      if (jobKind) q = q.eq("job_kind", jobKind);
      if (str(traceSelector.task_id)) q = q.eq("task_id", str(traceSelector.task_id)); // task_id is a text column
      const since = str(traceSelector.since);
      if (since && !Number.isNaN(Date.parse(since))) q = q.gte("created_at", since); // skip a malformed `since` rather than 500
      const limit = Math.max(1, Math.min(Math.floor(num(traceSelector.limit, 50)), MAX_TRACE_LIMIT));
      q = q.order("created_at", { ascending: false }).limit(limit);
      const { data: traceRows, error: tErr } = await q;
      if (tErr) return json(500, { error: `Failed to load traces: ${tErr.message}` });
      cases = (traceRows || []).map((r: Record<string, unknown>) => ({
        caseId: null,
        sourceTraceId: (r.id as string) ?? null,
        output: r.output_excerpt,
        expected: undefined,
        rubric: requestRubric || undefined,
      }));
      effectiveTenant = resolvedTenant;
    } else if (feedbackSelector) {
      // Human thumbs feedback as self-contained labeled cases — ALWAYS filtered to the
      // resolved tenant (the admin client bypasses RLS, so §9 is enforced here in code,
      // exactly like the trace path). message_content = output, user_prompt = input,
      // correction_note = expected reference, rating = the human label (human_label scorer).
      targetKind = targetKind || "feedback_batch";
      targetRef = targetRef || "response_quality_feedback";
      let q = admin
        .from("response_quality_feedback")
        .select("id, message_content, user_prompt, correction_note, rating, created_at")
        .eq("tenant_id", resolvedTenant);
      const rating = str(feedbackSelector.rating);
      if (rating === "positive" || rating === "negative") q = q.eq("rating", rating);
      const since = str(feedbackSelector.since);
      if (since && !Number.isNaN(Date.parse(since))) q = q.gte("created_at", since);
      const limit = Math.max(1, Math.min(Math.floor(num(feedbackSelector.limit, 50)), MAX_TRACE_LIMIT));
      q = q.order("created_at", { ascending: false }).limit(limit);
      const { data: fbRows, error: fErr } = await q;
      if (fErr) return json(500, { error: `Failed to load feedback: ${fErr.message}` });
      cases = (fbRows || []).map((r: Record<string, unknown>) => ({
        caseId: null,
        sourceTraceId: null,
        output: r.message_content,
        expected: (typeof r.correction_note === "string" && r.correction_note.trim()) ? r.correction_note : undefined,
        rubric: requestRubric || undefined,
        label: (r.rating as string) ?? null,
      }));
      effectiveTenant = resolvedTenant;
    }

    // ── open the run row (status 'running') ──────────────────────────────────────────────────────
    let prevAggregateScore: number | null = null;
    if (prevRunId) {
      const { data: prev } = await admin
        .from("paige_eval_run")
        .select("aggregate_score, tenant_id")
        .eq("id", prevRunId)
        .maybeSingle();
      // Only compare against a baseline in the same tenant scope (§9).
      const p = prev as Record<string, unknown> | null;
      if (p && (p.tenant_id as string | null) === effectiveTenant && typeof p.aggregate_score === "number") {
        prevAggregateScore = p.aggregate_score as number;
      }
    }

    const { data: runRow, error: runErr } = await admin
      .from("paige_eval_run")
      .insert({
        tenant_id: effectiveTenant,
        dataset_id: datasetId,
        target_kind: targetKind,
        target_ref: targetRef,
        target_version: targetVersion,
        status: "running",
        scorer_set: scorers,
        case_count: cases.length,
        prev_run_id: prevRunId,
        created_by: actorUserId,
      })
      .select("id")
      .single();
    if (runErr || !runRow) return json(500, { error: `Failed to open eval run: ${runErr?.message}` });
    const runId = (runRow as Record<string, unknown>).id as string;

    // ── run the bounded eval (never throws) ──────────────────────────────────────────────────────
    const result = await runEval({
      runId,
      tenantId: effectiveTenant,
      target: { kind: targetKind || "unknown", ref: targetRef || "", version: targetVersion || undefined },
      cases,
      scorers,
      parentTraceId: null,
      prevAggregateScore,
    });

    // ── persist per-case results (tenant stamped explicitly, source_trace_id linked) ──────────────
    if (result.results.length) {
      // Results are flat across cases; re-walk cases×scorers in the SAME order runEval produced them so
      // each result maps back to its case's ids for stamping (the gate returns them in this exact order).
      const rows: Record<string, unknown>[] = [];
      let idx = 0;
      for (const c of cases.slice(0, result.caseCount)) {
        for (const _ of scorers) {
          const r = result.results[idx];
          if (!r) break;
          rows.push({
            run_id: runId,
            tenant_id: effectiveTenant,
            case_id: c.caseId ?? null,
            source_trace_id: c.sourceTraceId ?? null,
            scorer: r.scorer,
            scorer_kind: r.scorerKind,
            score: r.score,
            passed: r.passed,
            status: r.status,
            rationale: r.rationale ?? null,
            judge_model: r.judgeModel ?? null,
            cost_estimate_usd: typeof r.costUsd === "number" ? r.costUsd : null,
          });
          idx++;
        }
      }
      if (rows.length) {
        const { error: resErr } = await admin.from("paige_eval_result").insert(rows);
        if (resErr) console.error("[paige-eval] result insert failed (non-blocking):", resErr.message);
      }
    }

    // ── close the run: 'needs_config' when nothing scored (honest), else 'complete' ───────────────
    const finalStatus = result.degraded ? "needs_config" : "complete";
    const { error: updErr } = await admin
      .from("paige_eval_run")
      .update({
        status: finalStatus,
        case_count: result.caseCount, // honest: cases ACTUALLY processed (< inserted count if the cost cap tripped)
        scored_count: result.scoredCount,
        degraded_count: result.degradedCount,
        aggregate_score: result.aggregateScore, // NULL when nothing scored — never 0-coerced (§31)
        pass_rate: result.passRate,
        cost_estimate_usd: result.costUsd,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (updErr) console.error("[paige-eval] run close failed (non-blocking):", updErr.message);

    // `result` already carries `runId` — `runEval` sets it from the same `opts.runId` passed in
    // above (gate.ts:155), so the two are provably the same value and the explicit one was dead:
    // the spread always overwrote it (TS2783/TS2785). Dropping it changes no output byte.
    //
    // Left alone until now because the deno ratchet inherited it as a baseline diagnostic. It stops
    // being inheritable when this function's BASE leg is UNCLASSIFIED — deno reported 3 errors and
    // the gate parsed 4 — at which point nothing is credited and the head must be clean on its own.
    // A gate that cannot read its own baseline correctly refuses to grade rather than guessing,
    // which is the right failure direction and is what surfaced this.
    const payload = { ...result };
    return json(200, result.degraded ? { ok: false, needs_config: true, ...payload } : { ok: true, ...payload });
  } catch (e) {
    console.error("[paige-eval] unhandled:", e);
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
