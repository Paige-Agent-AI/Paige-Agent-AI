// CONTROLLED SYNTHETIC: test/review-only. No production metrics or customer content.
import type { TaskTrajectory, TrajectoryPage } from "@/operator/data/intelligenceContract";
export const syntheticTrajectory: TaskTrajectory = {
  id: "90000000-0000-4000-8000-000000000001", contract_version: 1, work_version: 5,
  category: "document_authoring", capability_key: "document_generate", thread_ref: "synthetic-thread", intent_ref: "synthetic-intent",
  work_state: "succeeded", attempt: 2, dispatch_attempt: 2, created_at: "2026-10-10T12:00:00Z", updated_at: "2026-10-10T12:04:00Z", settled_at: "2026-10-10T12:04:00Z",
  scope_consistent: true, terminal_condition: "artifact", terminal_verified: true, artifact_ref: "synthetic-artifact", receipt_conflict: false,
  history: { version: 1, complete: true, truncated: false, events: [
    { at: "2026-10-10T12:00:00Z", version: 1, state: "claimed", attempt: 1, dispatch_attempt: 0, readback_claimed: null, blocked_code: null },
    { at: "2026-10-10T12:01:00Z", version: 2, state: "blocked", attempt: 1, dispatch_attempt: 0, readback_claimed: null, blocked_code: "approval_expired" },
    { at: "2026-10-10T12:02:00Z", version: 3, state: "claimed", attempt: 2, dispatch_attempt: 0, readback_claimed: null, blocked_code: null },
    { at: "2026-10-10T12:03:00Z", version: 4, state: "claimed", attempt: 2, dispatch_attempt: 2, readback_claimed: null, blocked_code: null },
    { at: "2026-10-10T12:04:00Z", version: 5, state: "succeeded", attempt: 2, dispatch_attempt: 2, readback_claimed: true, blocked_code: null },
  ] },
  model_count: 1, models: [{ id: "synthetic-trace", created_at: "2026-10-10T12:03:00Z", provider: "synthetic-provider", model: "synthetic-model", tier: "frontier", status: "success", router_version: "trace-2", tokens_in: 10, tokens_out: 20, latency_ms: 40, cost_estimate_usd: null, cost_basis: null, route_class: "astra", route_provider: null, route_model: null, route_fallback: null }],
  receipts: [{ id: "synthetic-receipt", occurred_at: "2026-10-10T12:04:00Z", outcome: "capability_succeeded", capability_key: "document_generate", attempt: 2, llm_trace_id: null, release_id: null }],
  executions: [{ id: "synthetic-execution", capability_key: "document_generate", outcome: "executed", effective_lane: "confirm", decided_at: "2026-10-10T12:02:00Z", dispatched_at: "2026-10-10T12:03:00Z", settled_at: "2026-10-10T12:04:00Z", provider_reference_recorded: true }],
  approvals: [{ id: "synthetic-approval", status: "approved", created_at: "2026-10-10T12:01:00Z", reviewed_at: "2026-10-10T12:02:00Z" }],
  turns: [{ id: "synthetic-origin", role: "user", created_at: "2026-10-10T12:00:00Z", intent_ref: "synthetic-intent", processing_state: null }],
  evaluations: [], limits: { models: 100, receipts: 100, executions: 100, approvals: 100, turns: 100, evaluations: 100 }, limit_reached: {}, coverage: { business_outcome: "unavailable" },
};
export const syntheticTrajectoryPage = (items = [syntheticTrajectory]): TrajectoryPage => ({ contract_version: 1, observed_at: "2026-10-10T12:05:00Z", items, next_cursor: null });
