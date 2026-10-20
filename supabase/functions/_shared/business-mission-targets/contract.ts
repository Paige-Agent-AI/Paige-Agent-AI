import { currentMetricVersion, parseMetricResult, type MetricRequestIdentity, type MetricResult } from "../analytics-metrics/metric-contract.ts";

/** Shared Game Plan record contract. Reads/writes remain caller-authorized domain RPCs. */
export interface MissionTarget {
  id: string;
  tenant_id: string;
  mission_id: string;
  revision: number;
  title: string;
  state: "active" | "paused" | "retired";
  metric: {
    key: string;
    version: string;
    unit: string;
    value_kind: "count" | "decimal" | "currency_totals";
    currency: string | null;
    dimensions: Record<string, string>;
    range_key: "week" | "month" | "quarter" | "year";
    semantics: MetricResult["range"]["semantics"];
    business_time_zone: string | null;
  };
  period: { start: string; end: string; time_zone: string };
  comparison: "at_least" | "at_most" | "within_range";
  desired_value: string;
  upper_value: string | null;
}

export type TargetObservation =
  | { state: "unavailable"; reason: "target_invalid" | "target_paused" | "target_retired" | "wrong_workspace" | "metric_version_changed" | "period_mismatch" | "evidence_unverified" | "binding_mismatch" | "metric_unavailable" | "historical_snapshot_unavailable" | "currency_unavailable" }
  | {
      state: "available" | "partial";
      actual: string;
      variance: string | null;
      attainment: "met" | "not_met" | "unknown";
      period_complete: boolean;
      as_of: string;
      source_revision_ref: string;
      reference_expires_at: string;
      caveats: string[];
    };

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal = (value: unknown): value is string => typeof value === "string" && value.length <= 64 && DECIMAL.test(value);
const date = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function parts(value: string): { integer: bigint; scale: number } {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return { integer: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length };
}

function aligned(left: string, right: string): [bigint, bigint, number] {
  const a = parts(left), b = parts(right), scale = Math.max(a.scale, b.scale);
  return [a.integer * 10n ** BigInt(scale - a.scale), b.integer * 10n ** BigInt(scale - b.scale), scale];
}

function renderDecimal(integer: bigint, scale: number): string {
  const negative = integer < 0n;
  const digits = (negative ? -integer : integer).toString().padStart(scale + 1, "0");
  const value = scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits;
  const trimmed = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return negative && integer !== 0n ? "-" + trimmed : trimmed;
}

/** Difference between compatible issued scalar actuals and an approved target, never metric production. */
function subtract(left: string, right: string): string {
  const [a, b, scale] = aligned(left, right);
  return renderDecimal(a - b, scale);
}

const compare = (left: string, right: string) => {
  const [a, b] = aligned(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
};

export function validMissionTarget(target: MissionTarget): boolean {
  if (!target || !UUID.test(target.id) || !UUID.test(target.tenant_id) || !UUID.test(target.mission_id)
    || !Number.isSafeInteger(target.revision) || target.revision < 1
    || typeof target.title !== "string" || target.title.trim().length < 3 || target.title.length > 180
    || !["active", "paused", "retired"].includes(target.state) || !target.metric || !target.period
    || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(target.metric.key)
    || !/^\d+\.\d+\.\d+$/.test(target.metric.version)
    || typeof target.metric.unit !== "string" || !target.metric.unit.trim() || target.metric.unit.length > 80
    || !["count", "decimal", "currency_totals"].includes(target.metric.value_kind)
    || !["week", "month", "quarter", "year"].includes(target.metric.range_key)
    || !["current_snapshot", "event_timestamp_cohort", "current_status_date_cohort", "source_readiness"].includes(target.metric.semantics)
    || !target.metric.dimensions || Array.isArray(target.metric.dimensions)
    || typeof target.metric.dimensions !== "object"
    || Object.keys(target.metric.dimensions).length > 20
    || !Object.entries(target.metric.dimensions).every(([key, value]) => /^[a-z][a-z0-9_]{0,79}$/.test(key) && typeof value === "string" && value.length <= 120)
    || !date(target.period.start) || !date(target.period.end) || Date.parse(target.period.start) >= Date.parse(target.period.end)
    || !["at_least", "at_most", "within_range"].includes(target.comparison) || !decimal(target.desired_value)
    || (target.comparison === "within_range"
      ? !decimal(target.upper_value) || compare(target.desired_value, target.upper_value) > 0
      : target.upper_value !== null)) return false;
  try {
    if (typeof target.period.time_zone !== "string" || target.period.time_zone.length > 100) return false;
    new Intl.DateTimeFormat("en-US", { timeZone: target.period.time_zone }).format(0);
  } catch { return false; }
  if (target.metric.key === "sales.receivables.overdue_current") {
    try {
      if (typeof target.metric.business_time_zone !== "string") return false;
      new Intl.DateTimeFormat("en-US", { timeZone: target.metric.business_time_zone }).format(0);
    } catch { return false; }
  } else if (target.metric.business_time_zone !== null) return false;
  if (target.metric.value_kind === "currency_totals") {
    if (target.metric.unit !== "currency_minor" || !/^[a-z]{3}$/.test(target.metric.currency ?? "")
      || target.desired_value.includes(".") || target.upper_value?.includes(".")) return false;
  } else if (target.metric.currency !== null) return false;
  if (target.metric.value_kind === "count" && (!/^(0|[1-9][0-9]*)$/.test(target.desired_value)
    || (target.upper_value !== null && !/^(0|[1-9][0-9]*)$/.test(target.upper_value)))) return false;
  return true;
}

/** Presentation only: authorization and issuance happen in the incumbent domain/Analytics ports. */
export function observeMissionTarget(target: MissionTarget, issuedValue: unknown, request: MetricRequestIdentity, now = Date.now()): TargetObservation {
  const unavailable = (reason: Extract<TargetObservation, { state: "unavailable" }>["reason"]): TargetObservation => ({ state: "unavailable", reason });
  if (!validMissionTarget(target)) return unavailable("target_invalid");
  if (target.state !== "active") return unavailable(target.state === "paused" ? "target_paused" : "target_retired");
  if (request.accountEpoch !== target.tenant_id) return unavailable("wrong_workspace");
  if (target.metric.version !== currentMetricVersion(target.metric.key)) return unavailable("metric_version_changed");
  if (request.metricKey !== target.metric.key || request.metricVersion !== target.metric.version
    || request.rangeKey !== target.metric.range_key
    || Object.keys(request.dimensions).length !== Object.keys(target.metric.dimensions).length
    || !Object.entries(target.metric.dimensions).every(([key, value]) => request.dimensions[key] === value)) return unavailable("binding_mismatch");
  const start = Date.parse(target.period.start), end = Date.parse(target.period.end);
  if (Date.parse(request.rangeStart) !== start || Date.parse(request.rangeEnd) > end
    || Date.parse(request.rangeEnd) > now || Date.parse(request.rangeEnd) <= start
    || (now >= end && Date.parse(request.rangeEnd) !== end)) return unavailable("period_mismatch");
  let metric: MetricResult;
  try { metric = parseMetricResult(issuedValue, request, now); }
  catch { return unavailable("evidence_unverified"); }
  if (metric.unit !== target.metric.unit || metric.range.semantics !== target.metric.semantics) return unavailable("binding_mismatch");
  if ((metric.business_time_zone?.zone ?? null) !== target.metric.business_time_zone) return unavailable("binding_mismatch");
  if (metric.truth_state === "UNAVAILABLE" || !metric.values) return unavailable("metric_unavailable");
  // Current snapshots/status cohorts cannot prove what a past period's actual was.
  if (now > end && metric.range.semantics !== "event_timestamp_cohort") return unavailable("historical_snapshot_unavailable");
  if (metric.values.kind !== target.metric.value_kind) return unavailable("binding_mismatch");
  let actual: string;
  if (metric.values.kind === "count") actual = String(metric.values.count);
  else if (metric.values.kind === "decimal") actual = metric.values.value;
  else if (metric.values.kind === "currency_totals") {
    const row = metric.values.by_currency.find(item => item.currency === target.metric.currency);
    if (!row) return unavailable("currency_unavailable");
    actual = row.amount_minor;
  } else return unavailable("binding_mismatch");
  const complete = metric.truth_state === "LIVE" && metric.coverage.state === "complete";
  let variance: string | null = null;
  let met = false;
  if (complete) {
    if (target.comparison === "at_least") { variance = subtract(actual, target.desired_value); met = compare(actual, target.desired_value) >= 0; }
    else if (target.comparison === "at_most") { variance = subtract(target.desired_value, actual); met = compare(actual, target.desired_value) <= 0; }
    else if (target.upper_value !== null) {
      met = compare(actual, target.desired_value) >= 0 && compare(actual, target.upper_value) <= 0;
      variance = met ? "0" : compare(actual, target.desired_value) < 0 ? subtract(actual, target.desired_value) : subtract(target.upper_value, actual);
    }
  }
  return {
    state: complete ? "available" : "partial", actual, variance,
    attainment: complete ? met ? "met" : "not_met" : "unknown",
    period_complete: Date.parse(request.rangeEnd) === end,
    as_of: metric.as_of, source_revision_ref: metric.source_revision_ref,
    reference_expires_at: metric.reference_expires_at, caveats: metric.caveats,
  };
}
