/** LOCAL SYNTHETIC metadata only; never imported by production src or its build inputs. */
import { useState } from "react";
import type { EvalRun, IntelligenceMetrics, IntelligenceRead, IntelligenceTrace, ReadState, TrajectoryRequest, TrajectoryPage } from "@/operator/data/intelligenceContract";
import { syntheticTrajectory, syntheticTrajectoryPage } from "@/test/fixtures/trajectory";
import canonical from "@/test/fixtures/canonical-trajectory.json";
const TRACE = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const CASE = "33333333-3333-4333-8333-333333333333";
function read<T>(data: T, state: string, refresh: () => void): ReadState<T> {
  return { data: state === "loading" ? undefined : data, loading: state === "loading", fetching: state === "loading", error: state === "error" || state === "unavailable", unavailable: state === "unavailable", updatedAt: 1791604800000, refresh };
}
export function useIntelligence(): IntelligenceRead {
  const params = new URLSearchParams(location.search);
  const [state, setState] = useState(params.get("state") ?? "populated");
  const [request, setRequest] = useState<TrajectoryRequest | null>(null);
  const empty = state === "empty";
  const metrics: IntelligenceMetrics = empty ? {} : {
    traces: { total: 14, cost_estimate_usd: 0.184, avg_latency_ms: 430, error_count: 2, needs_config: 1, tokens_in: 8500, tokens_out: 1200,
      by_provider: [{ provider: "Synthetic hosted adapter A", count: 9, cost_estimate_usd: 0.12 }, { provider: "Synthetic hosted adapter B", count: 5, cost_estimate_usd: 0.064 }], by_tier: [{ tier: "operational", count: 14, cost_estimate_usd: 0.184 }],
      by_status: [{ status: "ok", count: 11 }, { status: "error", count: 2 }, { status: "needs_config", count: 1 }] },
    evals: { runs: 1, runs_all: 1, avg_pass_rate: 0.5 }, roster: { total: 3, enabled: 2, auto_disabled: 1, invocations: 14 }, memory: { total: 2, rated: 1 },
  };
  const traces: IntelligenceTrace[] = empty ? [] : [{
    id: TRACE, created_at: "2026-10-10T04:00:00Z", tenant_label: "Synthetic test workspace", agent_id: "Synthetic trajectory observer",
    provider: "Synthetic hosted adapter", model: "Synthetic test model", job_kind: "synthetic-evidence-check", modality: "text", tier: "operational",
    status: "error", tokens_in: 850, tokens_out: null, latency_ms: 430, cost_estimate_usd: null, error_class: "synthetic_test_failure",
    account_type: "standalone", parent_name: null, working_context_label: null,
  }];
  const runs: EvalRun[] = empty ? [] : [{
    id: RUN, dataset_id: CASE, target_kind: "trace_batch", target_version: "synthetic-v1", status: "complete", scorer_set: ["exact_match"],
    case_count: 2, scored_count: 2, degraded_count: 0, aggregate_score: 0.5, pass_rate: 0.5, prev_run_id: null,
    created_at: "2026-10-10T04:00:00Z", completed_at: "2026-10-10T04:00:01Z", dataset_status: "active", result_count: 1,
    results: [{ id: CASE, case_id: CASE, source_trace_id: TRACE, scorer: "exact_match", scorer_kind: "deterministic", score: 0, passed: false, status: "scored", judge_model: null, cost_estimate_usd: null }],
  }];
  const refresh = () => setState("populated");
  const task = { ...syntheticTrajectory, models: syntheticTrajectory.models.map(m=>({ ...m,id:TRACE })),
    ...(state==='partial' ? { terminal_verified:false, history:{ ...syntheticTrajectory.history,complete:false,truncated:true } } : {}) };
  // Snapshot emitted by the actual canonical local completion + Operator SQL proof.
  // This is controlled synthetic source evidence, never an authenticated production read.
  const tasks=state==='canonical' ? canonical.page as unknown as TrajectoryPage : syntheticTrajectoryPage(empty ? [] : [task]);
  return { subject: "synthetic-operator", epoch: 1, access: state === "denied" ? "denied" : "allowed", retryAccess: refresh,
    metrics: read(metrics, state, refresh), traces: read(traces, state, refresh), evals: read(runs, state, refresh),
    trajectories:read(tasks,state,refresh),selectedTrajectory:read(state==='canonical' ? tasks : syntheticTrajectoryPage(state==='unlinked'||empty ? [] : [task]),state,refresh),
    trajectoryRequest:request,inspectTrajectory:setRequest,pageTrajectories:()=>setRequest(null) };
}
