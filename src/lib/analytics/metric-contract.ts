/** Shared consumer contract. Definitions, calculations and authority stay on the server. */
export type MetricTruth = "LIVE" | "PARTIAL" | "UNAVAILABLE";
export type MetricValues =
  | { kind: "count"; count: number }
  | { kind: "decimal"; value: string }
  | { kind: "distribution"; items: Array<{ key: string; label: string; count: number }> }
  | { kind: "series"; points: Array<{ at: string; value: number | null }> }
  | { kind: "currency_totals"; by_currency: Array<{ currency: string; amount_minor: string; record_count: number }>; breakdown: Array<{ currency: string; source: string; amount_minor: string; record_count: number }> };

export interface MetricResult {
  metric_key: string;
  metric_version: string;
  owner_department: string;
  label: string;
  definition: string;
  formula: string;
  range: { key: string; start: string; end: string; bounds: "[start,end)"; timezone: "UTC"; semantics: string };
  dimensions: Record<string, string>;
  values: MetricValues | null;
  unit: string;
  source_refs: string[];
  as_of: string;
  freshness: { queried_at: string; source_updated_through: string | null };
  coverage: { state: "complete" | "partial" | "unavailable"; candidate_count: number; contributing_count: number; excluded_count: number };
  exclusions: Array<{ reason: string; count: number }>;
  truth_state: MetricTruth;
  caveats: string[];
  source_revision_ref: string;
  account_epoch: string;
  account_epoch_ref: string;
  evidence_ref: string;
  reference_expires_at: string;
}

export interface MetricRequestIdentity {
  metricKey: string;
  metricVersion: string;
  accountEpoch: string;
  rangeKey: string;
  rangeStart: string;
  rangeEnd: string;
  dimensions: Record<string, string>;
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, n: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= n && !/[\u0000-\u001f]/.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const timestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const decimal = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(v);
const ref = (v: unknown, prefix: string) => typeof v === "string" && new RegExp(`^${prefix}_[0-9a-f]{64}$`).test(v);

function validValues(v: unknown): v is MetricValues {
  if (!record(v)) return false;
  if (v.kind === "count") return count(v.count);
  if (v.kind === "decimal") return decimal(v.value);
  if (v.kind === "distribution") return Array.isArray(v.items) && v.items.length <= 100
    && v.items.every(i => record(i) && text(i.key, 80) && text(i.label, 120) && count(i.count))
    && new Set(v.items.map(i => i.key)).size === v.items.length;
  if (v.kind === "series") return Array.isArray(v.points) && v.points.length <= 366
    && v.points.every(p => record(p) && timestamp(p.at) && (p.value === null || (typeof p.value === "number" && Number.isFinite(p.value))))
    && v.points.every((p, i, all) => i === 0 || Date.parse(p.at) > Date.parse(all[i - 1].at));
  const currencyRow = (i: unknown) => record(i) && typeof i.currency === "string" && /^[a-z]{3}$/.test(i.currency)
    && decimal(i.amount_minor) && !i.amount_minor.includes(".") && count(i.record_count);
  if (v.kind === "currency_totals") return Array.isArray(v.by_currency) && v.by_currency.length <= 20
    && v.by_currency.every(currencyRow) && new Set(v.by_currency.map(i => i.currency)).size === v.by_currency.length
    && Array.isArray(v.breakdown) && v.breakdown.length <= 100
    && v.breakdown.every(i => currencyRow(i) && record(i) && text(i.source, 80));
  return false;
}

/** Reject inconsistent, stale or differently scoped results before any presentation consumes them. */
export function parseMetricResult(value: unknown, expected: MetricRequestIdentity, now = Date.now()): MetricResult {
  const fail = (): never => { throw new Error("Measurement could not be verified for this workspace."); };
  if (!record(value) || !record(value.range) || !record(value.dimensions) || !record(value.coverage) || !record(value.freshness)) return fail();
  const c = value.coverage;
  const dimensions = value.dimensions;
  const stateMatches = (value.truth_state === "LIVE" && c.state === "complete" && c.excluded_count === 0)
    || (value.truth_state === "PARTIAL" && c.state === "partial")
    || (value.truth_state === "UNAVAILABLE" && c.state === "unavailable" && value.values === null && c.contributing_count === 0);
  if (value.metric_key !== expected.metricKey || value.metric_version !== expected.metricVersion
    || value.account_epoch !== expected.accountEpoch || value.range.key !== expected.rangeKey
    || Date.parse(String(value.range.start)) !== Date.parse(expected.rangeStart)
    || Date.parse(String(value.range.end)) !== Date.parse(expected.rangeEnd)
    || !ref(value.account_epoch_ref, "ae_v1") || !ref(value.source_revision_ref, "sr_v1") || !ref(value.evidence_ref, "aneb_v1")
    || !timestamp(value.reference_expires_at) || Date.parse(value.reference_expires_at) <= now
    || !timestamp(value.as_of) || Date.parse(value.as_of) > now + 30_000
    || !timestamp(value.range.start) || !timestamp(value.range.end) || Date.parse(value.range.start) >= Date.parse(value.range.end)
    || Date.parse(value.range.end) > Date.parse(value.as_of)
    || value.range.bounds !== "[start,end)" || value.range.timezone !== "UTC"
    || !["current_snapshot", "event_timestamp_cohort", "current_status_date_cohort", "source_readiness"].includes(String(value.range.semantics))
    || !text(value.label, 160) || !text(value.definition, 1200) || !text(value.formula, 1200) || !text(value.owner_department, 80) || !text(value.unit, 80)
    || Object.keys(dimensions).length !== Object.keys(expected.dimensions).length
    || !Object.entries(expected.dimensions).every(([k, v]) => dimensions[k] === v)
    || !Array.isArray(value.source_refs) || value.source_refs.length > 20
    || (value.truth_state !== "UNAVAILABLE" && value.source_refs.length === 0)
    || !value.source_refs.every(s => typeof s === "string" && /^[a-z0-9_.]{1,100}$/.test(s))
    || !timestamp(value.freshness.queried_at) || Date.parse(value.freshness.queried_at) !== Date.parse(String(value.as_of))
    || !(value.freshness.source_updated_through === null || timestamp(value.freshness.source_updated_through))
    || !count(c.candidate_count) || !count(c.contributing_count) || !count(c.excluded_count)
    || c.candidate_count !== c.contributing_count + c.excluded_count || !stateMatches
    || !Array.isArray(value.exclusions) || value.exclusions.length > 30
    || !value.exclusions.every(e => record(e) && text(e.reason, 160) && count(e.count))
    || value.exclusions.reduce((n, e) => n + e.count, 0) !== c.excluded_count
    || !Array.isArray(value.caveats) || value.caveats.length > 20 || !value.caveats.every(s => text(s, 1200))
    || (value.truth_state !== "UNAVAILABLE" && !validValues(value.values))) return fail();
  return value as unknown as MetricResult;
}
