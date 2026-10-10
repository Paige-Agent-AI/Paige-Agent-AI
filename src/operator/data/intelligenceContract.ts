/** Metadata only. Mirrors the existing Operator RPCs and the additive eval projection. */
export type Breakdown = { provider?: string; tier?: string; status?: string; modality?: string; count: number; cost_estimate_usd?: number | null };
export type IntelligenceMetrics = {
  traces?: { total?: number | null; window_days?: number | null; tokens_in?: number | null; tokens_out?: number | null; cost_estimate_usd?: number | null; avg_latency_ms?: number | null; error_count?: number | null; needs_config?: number | null; by_provider?: Breakdown[]; by_tier?: Breakdown[]; by_status?: Breakdown[] } | null;
  doctrine_flags?: number | null;
  evals?: { runs?: number | null; runs_all?: number | null; avg_pass_rate?: number | null; results?: number | null; passed?: number | null } | null;
  roster?: { total?: number | null; enabled?: number | null; auto_disabled?: number | null; invocations?: number | null; invocations_all?: number | null } | null;
  memory?: { total?: number | null; window?: number | null; rated?: number | null; by_modality?: Breakdown[] } | null;
};
export type IntelligenceTrace = {
  id: string; created_at: string; tenant_label: string | null; agent_id: string | null;
  provider: string | null; model: string | null; job_kind: string | null; modality: string | null;
  tier: string | null; status: string | null; tokens_in: number | null; tokens_out: number | null;
  latency_ms: number | null; cost_estimate_usd: number | null; error_class: string | null;
  account_type: string | null; parent_name: string | null; working_context_label: string | null;
};
export type EvalResult = {
  id: string; case_id: string | null; source_trace_id: string | null; scorer: string;
  scorer_kind: string; score: number | null; passed: boolean | null; status: string;
  judge_model: string | null; cost_estimate_usd: number | null;
};
export type EvalRun = {
  id: string; dataset_id: string | null; target_kind: string | null; target_version: string | null;
  status: string; scorer_set: string[] | null; case_count: number; scored_count: number;
  degraded_count: number; aggregate_score: number | null; pass_rate: number | null;
  prev_run_id: string | null; created_at: string; completed_at: string | null;
  dataset_status: string | null; results: EvalResult[]; result_count: number;
};
export type ReadState<T> = {
  data?: T; loading: boolean; fetching: boolean; error: boolean; unavailable?: boolean;
  updatedAt: number; refresh: () => void;
};
export type IntelligenceRead = {
  subject: string | null; epoch: number; access: "checking" | "allowed" | "denied" | "error";
  retryAccess: () => void; metrics: ReadState<IntelligenceMetrics>;
  traces: ReadState<IntelligenceTrace[]>; evals: ReadState<EvalRun[]>;
  trajectories: ReadState<TrajectoryPage>; selectedTrajectory: ReadState<TrajectoryPage>;
  trajectoryRequest: TrajectoryRequest | null;
  inspectTrajectory: (request: TrajectoryRequest | null) => void;
  pageTrajectories: (cursor: TrajectoryPage['next_cursor']) => void;
};
export type TrajectoryRequest = { workId: string } | { traceId: string };
export type TrajectoryHistory = { version: number; complete: boolean; truncated: boolean; events: {
  at: string; version: number; state: string; attempt: number; dispatch_attempt: number;
  readback_claimed: boolean | null; blocked_code: string | null;
}[] };
export type TaskTrajectory = {
  id: string; contract_version: number; work_version: number; category: string; capability_key: string;
  thread_ref: string | null; intent_ref: string; work_state: string; attempt: number; dispatch_attempt: number;
  created_at: string; updated_at: string; settled_at: string | null; scope_consistent: boolean;
  terminal_condition: 'artifact' | 'read_only' | 'unavailable'; terminal_verified: boolean;
  artifact_ref: string | null; receipt_conflict: boolean; history: TrajectoryHistory;
  model_count: number; models: { id: string; created_at: string; provider: string | null; model: string | null;
    tier: string | null; status: string; router_version: string | null; tokens_in: number | null; tokens_out: number | null;
    latency_ms: number | null; cost_estimate_usd: number | null; cost_basis: string | null;
    route_class: string | null; route_provider: string | null; route_model: string | null; route_fallback: boolean | null;
  }[];
  receipts: { id: string; occurred_at: string; outcome: string; capability_key: string; attempt: number | null; llm_trace_id: string | null; release_id: string | null }[];
  executions: { id: string; capability_key: string; outcome: string; effective_lane: string; decided_at: string; dispatched_at: string | null; settled_at: string | null; provider_reference_recorded: boolean }[];
  approvals: { id: string; status: string; created_at: string; reviewed_at: string | null }[];
  turns: { id: string; role: string; created_at: string; intent_ref: string | null; processing_state: string | null }[];
  evaluations: { id: string; run_id: string; source_trace_id: string; scorer: string; status: string; score: number | null; passed: boolean | null; created_at: string }[];
  limits: Record<string, number>; limit_reached: Record<string, boolean>; coverage: Record<string, string>;
};
export type TrajectoryPage = { contract_version: number; observed_at: string; items: TaskTrajectory[]; next_cursor: { at: string; id: string } | null };
export type Recommendation = {
  kind: "improvement" | "opportunity"; problem: string; target: string; evidence: string;
  freshness: string; confidence: string; assumptions: string; capability: string;
  value: string; economics: string; dependencies: string; risks: string;
  acceptance: string; nextAction: string; owner: string;
};
export const newRecommendation = (kind: Recommendation["kind"]): Recommendation => ({
  kind, problem: "", target: "", evidence: "", freshness: "", confidence: "",
  assumptions: "", capability: "", value: "", economics: "", dependencies: "",
  risks: "", acceptance: "", nextAction: "", owner: kind === "opportunity" ? "Platform Marketing" : "Platform Operations",
});
export function recommendationErrors(draft: Recommendation): string[] {
  return (["problem", "target", "evidence", "freshness", "confidence", "assumptions", "capability",
    "value", "economics", "dependencies", "risks", "acceptance", "nextAction", "owner"] as const)
    .filter((key) => !draft[key].trim());
}
export function recommendationDocument(draft: Recommendation) {
  if (recommendationErrors(draft).length) throw new Error("Complete the evidence and review fields first.");
  return {
    workstream: "INT-280", status: "LOCAL_DRAFT", authority: "No approval, submission or execution",
    proposal: draft, handoffs: { demandValidation: "Platform Marketing", feasibilityAndDelivery: "Platform Operations", synthesis: "PAIGE Intelligence" },
  };
}
export const displayNumber = (n: number | null | undefined, unit = "") =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit}` : "—";
export const displayPercent = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
export const displayCost = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }) : "—";
