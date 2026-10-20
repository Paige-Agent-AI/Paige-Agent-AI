// Synthetic evidence for hermetic component/contract tests and the development-only walkthrough.
// Never imported by product entry points.
import type { BusinessOperatingSnapshot, DomainSnapshot, SnapshotDomain } from "../../../supabase/functions/_shared/paige-context/snapshot";

export const TEST_REVIEW_TENANT = "10000000-0000-4000-8000-000000000001";
const period = { key: "last_7_days" as const, basis: "rolling" as const, label: "Last 7 days", start: "2026-10-06T04:00:00.000Z", end: "2026-10-13T04:00:00.000Z", timezone: "America/New_York" };
function domain(key: SnapshotDomain, patch: Partial<DomainSnapshot>): DomainSnapshot {
  return { domain: key, owner: key === "payments" || key === "sales_pipeline" ? "sales" : key, period,
    as_of: "2026-10-13T14:00:00.000Z", coverage: "full", freshness: "live_read", headline: [], risks: [], changes: [],
    outcomes: [], upcoming: [], goal_links: [], sources: [{ system: "canonical records", adapter: "synthetic-test" }], ...patch };
}
export const TEST_BUSINESS_REVIEW: BusinessOperatingSnapshot = {
  version: 1, tenant_id: TEST_REVIEW_TENANT, actor_id: "test-owner", account_shape: "solo", period,
  composed_at: "2026-10-13T14:00:00.000Z", requested: ["payments", "sales_pipeline", "operations", "clients", "campaigns"],
  domains: {
    payments: { status: "available", data: domain("payments", { headline: [{ key: "payments.recorded_cash", label: "Cash recorded as received", value: 125000, unit: "currency_minor", currency: "USD", basis: "in_period", window_note: "Completed-day activity through October 13 at 00:00 UTC, exclusive. Last completed UTC day: October 12." }], risks: [{ kind: "receivables", summary: "USD 300.00 is overdue right now", severity: "watch" }] }) },
    sales_pipeline: { status: "available", data: domain("sales_pipeline", { headline: [{ key: "sales_pipeline.open_value", label: "Open pipeline value", value: 420000, unit: "currency_minor", currency: "USD", basis: "point_in_time" }], risks: [{ kind: "pipeline", summary: "2 open opportunities older than 30 days", severity: "watch" }], changes: [{ summary: "Opportunities created up 2 versus the previous 7 days." }] }) },
    operations: { status: "available", data: domain("operations", { coverage: "partial", coverage_note: "Two figures could not be read; shown figures are complete.", headline: [{ key: "operations.findings", label: "Unresolved findings", value: 4, unit: "count", basis: "point_in_time" }], risks: [{ kind: "readiness", summary: "2 blocking operating findings", severity: "act" }] }) },
    clients: { status: "available", data: domain("clients", { headline: [{ key: "clients.active", label: "Active clients", value: 0, unit: "count", basis: "point_in_time" }] }) },
    campaigns: { status: "unavailable", reason: "not_connected", data: null },
  }, degradation: [{ source: "campaigns", status: "unavailable", reason: "not_connected" }],
  budget: { adapters_run: 4, timed_out: [], truncated: [] },
};
