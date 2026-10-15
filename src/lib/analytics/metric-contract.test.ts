import { describe, expect, it } from "vitest";
import { parseMetricResult, type MetricRequestIdentity, type MetricResult } from "./metric-contract";

const now = Date.parse("2026-10-07T12:00:00Z");
const identity: MetricRequestIdentity = { metricKey: "team.active_members_current", metricVersion: "1.0.0", accountEpoch: "a3400000-0000-4000-8000-000000000011", rangeKey: "week", rangeStart: "2026-09-30T12:00:00Z", rangeEnd: "2026-10-07T12:00:00Z", dimensions: {} };
function fixture(): MetricResult {
  return {
    metric_key: identity.metricKey, metric_version: "1.0.0", owner_department: "people_talent", label: "Active team members",
    definition: "Active canonical workspace memberships now.", formula: "COUNT(active memberships)",
    range: { key: "week", start: "2026-09-30T12:00:00Z", end: "2026-10-07T12:00:00Z", bounds: "[start,end)", timezone: "UTC", semantics: "current_snapshot" },
    dimensions: {}, values: { kind: "count", count: 4 }, unit: "count", source_refs: ["public.tenant_members"],
    as_of: "2026-10-07T12:00:00Z", freshness: { queried_at: "2026-10-07T12:00:00Z", source_updated_through: "2026-10-07T11:00:00Z" },
    coverage: { state: "complete", candidate_count: 4, contributing_count: 4, excluded_count: 0 }, exclusions: [], truth_state: "LIVE", caveats: [],
    source_revision_ref: `sr_v1_${"a".repeat(64)}`, account_epoch: identity.accountEpoch, account_epoch_ref: `ae_v1_${"b".repeat(64)}`,
    evidence_ref: `aneb_v1_${"c".repeat(64)}`, reference_expires_at: "2026-10-07T12:15:00Z",
  };
}

describe("shared metric consumer boundary", () => {
  it("accepts bounded recorded diagnostic activity with matching evidence coverage", () => {
    const result = fixture();
    result.metric_key = "operations.recorded_workflow_activity";
    result.truth_state = "PARTIAL"; result.coverage = { state: "partial", candidate_count: 1, contributing_count: 1, excluded_count: 0 };
    result.range.semantics = "event_timestamp_cohort";
    result.values = { kind: "diagnostic_events", items: [{ source: "workflow_run", at: "2026-10-07T11:00:00Z", status: "failed", severity: null, retry_count: 2, completed_at: "2026-10-07T11:01:00Z", check_key: null }] };
    const request = { ...identity, metricKey: result.metric_key };
    expect(parseMetricResult(result, request, now).values).toEqual(result.values);
    expect(() => parseMetricResult({ ...result, values: { kind: "count", count: 1 } }, request, now)).toThrow();
    expect(() => parseMetricResult({ ...result, range: { ...result.range, semantics: "current_snapshot" } }, request, now)).toThrow();
    result.values.items[0].at = "2026-09-29T11:00:00Z";
    expect(() => parseMetricResult(result, request, now)).toThrow();
  });
  it("refuses raw diagnostic fields, unsupported states and oversized activity", () => {
    const result = fixture(); result.metric_key = "operations.current_system_exceptions";
    result.coverage = { state: "complete", candidate_count: 1, contributing_count: 1, excluded_count: 0 };
    const event = { source: "systems_check", at: "2026-09-29T11:00:00Z", status: "fail", severity: "blocking", retry_count: null, completed_at: null, check_key: "payment_processor_connected" };
    const request = { ...identity, metricKey: result.metric_key };
    const value = { ...result, values: { kind: "diagnostic_events", items: [event] } };
    expect(parseMetricResult(value, request, now).values).toEqual(value.values);
    for (const unsafe of [{ ...event, error: "private raw detail" }, { ...event, status: "unknown" }, { ...event, severity: null }, { ...event, retry_count: 1 }, { ...event, completed_at: "2026-10-08T11:00:00Z" }, { ...event, at: "2026-09-29T11:00:00" }, { ...event, completed_at: "2026-10-07T11:00:00" }]) {
      expect(() => parseMetricResult({ ...value, values: { kind: "diagnostic_events", items: [unsafe] } }, request, now)).toThrow();
    }
    expect(() => parseMetricResult({ ...value, values: { kind: "diagnostic_events", items: Array(21).fill(event) } }, request, now)).toThrow();
    expect(() => parseMetricResult({ ...value, coverage: { state: "complete", candidate_count: 2, contributing_count: 2, excluded_count: 0 } }, request, now)).toThrow();
    expect(() => parseMetricResult({ ...value, range: { ...value.range, semantics: "event_timestamp_cohort" } }, request, now)).toThrow();
  });
  it("accepts an evidenced current snapshot without inventing historical values", () => {
    expect(parseMetricResult(fixture(), identity, now).range.semantics).toBe("current_snapshot");
  });
  it.each(["account_epoch", "metric_key", "metric_version"] as const)("refuses a mismatched %s", field => {
    const result = fixture(); result[field] = "different";
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("refuses foreign object dimensions and stale ranges", () => {
    const result = fixture(); result.dimensions = { pipeline_id: "foreign" };
    expect(() => parseMetricResult(result, identity, now)).toThrow();
    result.dimensions = {}; result.range.key = "year";
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("does not accept unavailable measurement as a numeric zero", () => {
    const result = fixture(); result.truth_state = "UNAVAILABLE"; result.coverage.state = "unavailable";
    result.values = { kind: "count", count: 0 };
    expect(() => parseMetricResult(result, identity, now)).toThrow();
    result.values = null;
    result.coverage = { state: "unavailable", candidate_count: 4, contributing_count: 0, excluded_count: 4 };
    result.exclusions = [{ reason: "Missing measurement", count: 4 }];
    expect(parseMetricResult(result, identity, now).values).toBeNull();
  });
  it("preserves partial telemetry even when exclusions cannot quantify missing instrumentation", () => {
    const result = fixture(); result.truth_state = "PARTIAL"; result.coverage.state = "partial";
    result.caveats = ["Only recorded requests are measured; telemetry is best effort."];
    expect(parseMetricResult(result, identity, now).truth_state).toBe("PARTIAL");
    result.truth_state = "LIVE";
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("refuses expired evidence and inconsistent source coverage", () => {
    const result = fixture(); result.reference_expires_at = "2026-10-07T12:00:00Z";
    expect(() => parseMetricResult(result, identity, now)).toThrow();
    result.reference_expires_at = "2026-10-07T12:15:00Z"; result.coverage.contributing_count = 3;
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("preserves money as a decimal string and refuses unsafe numeric coercion", () => {
    const result = fixture(); result.values = { kind: "currency_totals", by_currency: [{ currency: "usd", amount_minor: "900719925474099300", record_count: 4 }], breakdown: [] };
    expect(parseMetricResult(result, identity, now).values).toEqual(result.values);
    result.values = { kind: "decimal", value: "NaN" };
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("refuses fabricated duplicate or backward trend points", () => {
    const result = fixture(); result.values = { kind: "series", points: [{ at: "2026-10-07T11:00:00Z", value: 1 }, { at: "2026-10-07T11:00:00Z", value: 2 }] };
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("rejects an unevidenced measured result or unavailable contributing rows", () => {
    const result = fixture(); result.source_refs = [];
    expect(() => parseMetricResult(result, identity, now)).toThrow();
    result.truth_state = "UNAVAILABLE"; result.coverage.state = "unavailable"; result.values = null;
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("rejects different dates under the same named range", () => {
    const result = fixture(); result.range.start = "2026-08-01T12:00:00Z"; result.range.end = "2026-08-08T12:00:00Z";
    expect(() => parseMetricResult(result, identity, now)).toThrow();
  });
  it("refuses trend points outside the evidenced interval", () => {
    const result = fixture(); result.values = { kind: "series", points: [{ at: result.range.end, value: 4 }] };
    expect(() => parseMetricResult(result, identity, now)).toThrow();
    result.values = { kind: "series", points: [{ at: result.range.start, value: 4 }] };
    expect(parseMetricResult(result, identity, now).values).toEqual(result.values);
  });
});
