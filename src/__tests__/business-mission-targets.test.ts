import { describe, expect, it } from "vitest";
import { observeMissionTarget, validMissionTarget, type MissionTarget } from "../../supabase/functions/_shared/business-mission-targets/contract";
import type { MetricRequestIdentity, MetricResult } from "../../supabase/functions/_shared/analytics-metrics/metric-contract";

const tenant = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-01-15T12:00:00Z");
function target(overrides: Partial<MissionTarget> = {}): MissionTarget {
  return {
    id: "22222222-2222-4222-8222-222222222222", tenant_id: tenant,
    mission_id: "33333333-3333-4333-8333-333333333333", revision: 1,
    title: "Grow the client base", state: "active",
    metric: { key: "business.active_clients_current", version: "1.0.0", unit: "count", value_kind: "count", currency: null, dimensions: {}, range_key: "month", semantics: "current_snapshot", business_time_zone: null },
    period: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z", time_zone: "UTC" },
    comparison: "at_least", desired_value: "10", upper_value: null, ...overrides,
  };
}
function request(t = target()): MetricRequestIdentity {
  return { metricKey: t.metric.key, metricVersion: t.metric.version, accountEpoch: tenant, dimensions: t.metric.dimensions,
    rangeKey: t.metric.range_key, rangeStart: t.period.start, rangeEnd: new Date(now).toISOString() };
}
function metric(t = target(), overrides: Partial<MetricResult> = {}): MetricResult {
  const r = request(t);
  return {
    metric_key: t.metric.key, metric_version: t.metric.version, owner_department: "business",
    label: "Active clients", definition: "Scoped active client count", formula: "Count the caller's active clients",
    range: { key: r.rangeKey, start: r.rangeStart, end: r.rangeEnd, bounds: "[start,end)", timezone: "UTC", semantics: t.metric.semantics },
    dimensions: t.metric.dimensions, values: { kind: "count", count: 12 }, unit: t.metric.unit,
    source_refs: ["public.clients"], as_of: new Date(now).toISOString(),
    freshness: { queried_at: new Date(now).toISOString(), source_updated_through: null },
    coverage: { state: "complete", candidate_count: 12, contributing_count: 12, excluded_count: 0 },
    exclusions: [], truth_state: "LIVE", caveats: [],
    source_revision_ref: "sr_v1_" + "a".repeat(64), account_epoch: tenant,
    account_epoch_ref: "ae_v1_" + "b".repeat(64), evidence_ref: "aneb_v1_" + "c".repeat(64),
    reference_expires_at: new Date(now + 15 * 60_000).toISOString(), ...overrides,
  };
}

describe("mission-linked targets consume the existing issued metric contract", () => {
  it("shows exact unit variance and current attainment without inventing a percentage", () => {
    expect(observeMissionTarget(target(), metric(), request(), now)).toMatchObject({
      state: "available", actual: "12", variance: "2", attainment: "met", period_complete: false,
    });
    expect(observeMissionTarget(target(), metric(), request(), now)).not.toHaveProperty("progress_percent");
  });
  it("treats a proven zero as zero while a missing/unsupported actual remains unavailable", () => {
    expect(observeMissionTarget(target(), metric(target(), { values: { kind: "count", count: 0 } }), request(), now)).toMatchObject({ actual: "0", variance: "-10" });
    expect(observeMissionTarget(target(), metric(target(), {
      values: null, truth_state: "UNAVAILABLE", source_refs: [],
      coverage: { state: "unavailable", candidate_count: 0, contributing_count: 0, excluded_count: 0 },
    }), request(), now)).toEqual({ state: "unavailable", reason: "metric_unavailable" });
  });
  it("displays partial actual coverage without asserting attainment or a trustworthy variance", () => {
    const partial = metric(target(), {
      truth_state: "PARTIAL", coverage: { state: "partial", candidate_count: 14, contributing_count: 12, excluded_count: 2 },
      exclusions: [{ reason: "source unavailable", count: 2 }],
    });
    expect(observeMissionTarget(target(), partial, request(), now)).toMatchObject({ state: "partial", actual: "12", variance: null, attainment: "unknown" });
  });
  it.each(["paused", "retired"] as const)("preserves the %s target record rather than presenting it as active progress", state => {
    expect(observeMissionTarget(target({ state }), metric(), request(), now)).toEqual({ state: "unavailable", reason: "target_" + state });
  });
  it("rejects a target or issued result from a different current workspace", () => {
    expect(observeMissionTarget(target({ tenant_id: "44444444-4444-4444-8444-444444444444" }), metric(), request(), now)).toEqual({ state: "unavailable", reason: "wrong_workspace" });
    expect(observeMissionTarget(target(), metric(target(), { account_epoch: "44444444-4444-4444-8444-444444444444" }), request(), now)).toEqual({ state: "unavailable", reason: "evidence_unverified" });
  });
  it("reissues expired evidence instead of treating a temporary reference as durable target truth", () => {
    expect(observeMissionTarget(target(), metric(target(), { reference_expires_at: new Date(now).toISOString() }), request(), now)).toEqual({ state: "unavailable", reason: "evidence_unverified" });
  });
  it("holds incompatible metric versions and definitions instead of silently moving a saved target", () => {
    expect(observeMissionTarget(target({ metric: { ...target().metric, version: "0.9.0" } }), metric(), request(), now)).toEqual({ state: "unavailable", reason: "metric_version_changed" });
    expect(observeMissionTarget(target(), metric(target(), { unit: "percent" }), request(), now)).toEqual({ state: "unavailable", reason: "binding_mismatch" });
    expect(observeMissionTarget(target(), metric(target(), { range: { ...metric().range, semantics: "event_timestamp_cohort" } }), request(), now)).toEqual({ state: "unavailable", reason: "binding_mismatch" });
  });
  it("rejects a different period, dimensions or future requested actual", () => {
    expect(observeMissionTarget(target(), metric(), { ...request(), rangeStart: "2025-12-01T00:00:00Z" }, now)).toEqual({ state: "unavailable", reason: "period_mismatch" });
    expect(observeMissionTarget(target(), metric(), { ...request(), rangeEnd: "2026-01-16T00:00:00Z" }, now)).toEqual({ state: "unavailable", reason: "period_mismatch" });
    expect(observeMissionTarget(target(), metric(), { ...request(), dimensions: { source: "other" } }, now)).toEqual({ state: "unavailable", reason: "binding_mismatch" });
  });
  it("cannot use today's snapshot to assert that a past goal was met", () => {
    const t = target({ period: { start: "2026-01-01T00:00:00Z", end: "2026-01-10T00:00:00Z", time_zone: "UTC" } });
    const r = { ...request(t), rangeEnd: t.period.end };
    const m = metric(t, { range: { ...metric(t).range, end: t.period.end } });
    expect(observeMissionTarget(t, m, r, now)).toEqual({ state: "unavailable", reason: "historical_snapshot_unavailable" });
  });
  it("can evaluate a finished period when the issuer supplies the actual event cohort", () => {
    const t = target({ period: { start: "2026-01-01T00:00:00Z", end: "2026-01-10T00:00:00Z", time_zone: "UTC" }, metric: { ...target().metric, semantics: "event_timestamp_cohort" } });
    const r = { ...request(t), rangeEnd: t.period.end };
    const m = metric(t, { range: { ...metric(t).range, end: t.period.end } });
    expect(observeMissionTarget(t, m, r, now)).toMatchObject({ attainment: "met", period_complete: true });
  });
  it("keeps currency totals separate and preserves integer precision beyond Number.MAX_SAFE_INTEGER", () => {
    const t = target({ desired_value: "9007199254740993001", metric: {
      ...target().metric, key: "sales.cash.recorded_received", unit: "currency_minor", value_kind: "currency_totals", currency: "kwd", semantics: "event_timestamp_cohort",
    } });
    const m = metric(t, { values: { kind: "currency_totals",
      by_currency: [{ currency: "kwd", amount_minor: "9007199254740993000", record_count: 1 }, { currency: "usd", amount_minor: "999999", record_count: 1 }],
      breakdown: [],
    } });
    expect(observeMissionTarget(t, m, request(t), now)).toMatchObject({ actual: "9007199254740993000", variance: "-1", attainment: "not_met" });
    expect(observeMissionTarget({ ...t, metric: { ...t.metric, currency: "jpy" } }, m, request(t), now)).toEqual({ state: "unavailable", reason: "currency_unavailable" });
  });
  it("handles minimize, decimal and range targets without floating-point error", () => {
    const t = target({ comparison: "at_most", desired_value: "-0.1", metric: { ...target().metric, value_kind: "decimal", unit: "ratio" } });
    expect(observeMissionTarget(t, metric(t, { values: { kind: "decimal", value: "-0.2" } }), request(t), now)).toMatchObject({ variance: "0.1", attainment: "met" });
    const range = { ...t, comparison: "within_range" as const, desired_value: "0.1", upper_value: "0.3" };
    expect(observeMissionTarget(range, metric(range, { values: { kind: "decimal", value: "0.2" } }), request(range), now)).toMatchObject({ variance: "0", attainment: "met" });
    expect(observeMissionTarget(range, metric(range, { values: { kind: "decimal", value: "0.4" } }), request(range), now)).toMatchObject({ variance: "-0.1", attainment: "not_met" });
  });
  it("refuses invalid or reversed target bounds and fractional count/money goals", () => {
    expect(validMissionTarget(target({ comparison: "within_range", desired_value: "12", upper_value: "10" }))).toBe(false);
    expect(validMissionTarget(target({ desired_value: "1.5" }))).toBe(false);
    expect(validMissionTarget(target({ desired_value: "-1" }))).toBe(false);
    expect(validMissionTarget(target({ metric: { ...target().metric, unit: "currency_minor", value_kind: "currency_totals", currency: "usd" }, desired_value: "1.1" }))).toBe(false);
  });
});
