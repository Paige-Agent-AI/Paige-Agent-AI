import { useState } from "react";

export function useSystemsCheck() {
  const scenario = new URLSearchParams(location.search).get("scan");
  const [refreshed, setRefreshed] = useState(false);
  const [startedAt] = useState(() => new Date(Date.now() - 60_000).toISOString());
  const noCompleted = scenario === "only" || scenario === "age";
  const recorded = {
    run: { id: "run-1", started_at: "2026-08-29T12:00:00Z", completed_at: "2026-08-29T12:01:00Z", check_count: 1, pass_count: 0, fail_count: 1 },
    findings: [{
      id: "finding-1", run_id: "run-1", check_id: "payments_connection", status: "fail",
      severity_at_finding: "blocking", evidence: { provider: "Stripe", state: "disconnected" },
      paige_interpretation: "Payments cannot be verified while the connection is unavailable.",
      paige_drafted_fix: null, department_id: "finance", resolved_at: null, resolution: null,
      resolution_action_id: null, created_at: "2026-08-29T12:01:00Z",
      check_name: "Payment connection needs attention", domain: "payments", priority: 1,
    }],
  };
  return {
    run: noCompleted ? null : recorded.run,
    findings: noCompleted ? [] : recorded.findings,
    loading: scenario === "loading", isError: scenario === "error", scanPending: scenario === "age",
    scanInProgressSince: scenario === "invalid" ? "not-a-date"
      : !refreshed && ["running", "only", "loading", "error"].includes(scenario ?? "") ? startedAt : null,
    // Fixture-only re-read retires the unfinished signal; it creates no new completed result.
    refresh: () => setRefreshed(true),
  };
}
