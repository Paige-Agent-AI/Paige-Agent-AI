import { validMissionTarget, type MissionTarget, type TargetObservation } from './contract.ts';

/** Closed presentation of existing records, never a stored goal, metric or receipt. */
export type MissionTargetSnapshot = {
  mission: { id: string; title: string; revision: number; state: 'proposed' | 'active' | 'blocked' | 'paused' | 'completed' | 'stopped' };
  target: MissionTarget;
  observation: TargetObservation;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).every(k => keys.includes(k));
const instant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const decimal = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(v);
// eslint-disable-next-line no-control-regex -- record text cannot forge another projection line
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);
const unavailableReasons = ['target_invalid', 'target_paused', 'target_retired', 'wrong_workspace', 'metric_version_changed', 'period_mismatch',
  'evidence_unverified', 'binding_mismatch', 'metric_unavailable', 'historical_snapshot_unavailable', 'currency_unavailable'];

/** Pick only canonical definition fields; owner RPC audit fields never enter the view. */
export function projectMissionTarget(t: MissionTarget): MissionTarget {
  return { id: t.id, tenant_id: t.tenant_id, mission_id: t.mission_id, revision: t.revision, state: t.state, title: t.title,
    metric: { key: t.metric.key, version: t.metric.version, unit: t.metric.unit, value_kind: t.metric.value_kind, currency: t.metric.currency,
      dimensions: { ...t.metric.dimensions }, range_key: t.metric.range_key, semantics: t.metric.semantics, business_time_zone: t.metric.business_time_zone },
    period: { start: t.period.start, end: t.period.end, time_zone: t.period.time_zone }, comparison: t.comparison,
    desired_value: t.desired_value, upper_value: t.upper_value };
}

/** The existing snapshot validates this at BOTH composer and browser boundaries. */
export function validateMissionTargetSnapshot(value: unknown, tenantId: string | null | undefined, now = Date.now()): MissionTargetSnapshot | null {
  try {
    if (!tenantId || !closed(value, ['mission', 'target', 'observation'])
      || !closed(value.mission, ['id', 'title', 'revision', 'state'])
      || !closed(value.target, ['id', 'tenant_id', 'mission_id', 'revision', 'state', 'title', 'metric', 'period', 'comparison', 'desired_value', 'upper_value'])
      || !closed(value.target.metric, ['key', 'version', 'unit', 'value_kind', 'currency', 'dimensions', 'range_key', 'semantics', 'business_time_zone'])
      || !closed(value.target.period, ['start', 'end', 'time_zone'])) return null;
    const target = value.target as unknown as MissionTarget, mission = value.mission;
    if (!validMissionTarget(target) || target.tenant_id !== tenantId || !text(target.title, 180) || !text(mission.title, 180)
      || mission.id !== target.mission_id || !Number.isSafeInteger(mission.revision) || Number(mission.revision) < 1
      || !['proposed', 'active', 'blocked', 'paused', 'completed', 'stopped'].includes(String(mission.state))) return null;
    const o = value.observation;
    let observation: TargetObservation;
    if (closed(o, ['state', 'reason']) && o.state === 'unavailable' && unavailableReasons.includes(String(o.reason))) {
      observation = { state: 'unavailable', reason: o.reason as Extract<TargetObservation, { state: 'unavailable' }>['reason'] };
    } else {
      if (!closed(o, ['state', 'actual', 'variance', 'attainment', 'period_complete', 'as_of', 'source_revision_ref', 'reference_expires_at', 'caveats'])
        || !['available', 'partial'].includes(String(o.state)) || target.state !== 'active' || !decimal(o.actual)
        || !(o.variance === null || decimal(o.variance)) || typeof o.period_complete !== 'boolean'
        || !instant(o.as_of) || !instant(o.reference_expires_at) || Date.parse(o.as_of) > now + 30000
        || Date.parse(o.reference_expires_at) <= Date.parse(o.as_of)
        || typeof o.source_revision_ref !== 'string' || !/^sr_v1_[0-9a-f]{64}$/.test(o.source_revision_ref)
        || !Array.isArray(o.caveats) || o.caveats.length > 20 || !o.caveats.every(c => text(c, 1200))) return null;
      if (o.state === 'partial' ? o.variance !== null || o.attainment !== 'unknown'
        : o.variance === null || !['met', 'not_met'].includes(String(o.attainment))) return null;
      if (target.metric.value_kind !== 'decimal' && (o.actual.includes('.') || typeof o.variance === 'string' && o.variance.includes('.'))) return null;
      if (target.metric.value_kind === 'count' && !/^(0|[1-9][0-9]*)$/.test(o.actual)) return null;
      if (Date.parse(o.reference_expires_at) <= now) observation = { state: 'unavailable', reason: 'evidence_unverified' };
      else if (now > Date.parse(target.period.end) && target.metric.semantics !== 'event_timestamp_cohort') observation = { state: 'unavailable', reason: 'historical_snapshot_unavailable' };
      else observation = { state: o.state as 'available' | 'partial', actual: o.actual, variance: o.variance as string | null,
        attainment: o.attainment as 'met' | 'not_met' | 'unknown', period_complete: o.period_complete, as_of: o.as_of,
        source_revision_ref: o.source_revision_ref, reference_expires_at: o.reference_expires_at, caveats: [...o.caveats] as string[] };
    }
    return { mission: { id: target.mission_id, title: mission.title, revision: Number(mission.revision), state: mission.state as MissionTargetSnapshot['mission']['state'] },
      target: projectMissionTarget(target), observation };
  } catch { return null; }
}

export function missionTargetCurrencyDigits(currency: string | null): number | null {
  if (!currency || !/^[a-z]{3}$/.test(currency)) return null;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; }
  catch { return null; }
}

/** One exact string formatter for native target detail, Executive and model projection. */
export function formatMissionTargetValue(value: string, kind: MissionTarget['metric']['value_kind'], currency: string | null): string {
  if (kind !== 'currency_totals') return value;
  const digits = missionTargetCurrencyDigits(currency);
  if (digits === null || !/^-?(0|[1-9][0-9]*)$/.test(value)) return 'Unavailable';
  const negative = value.startsWith('-'), padded = (negative ? value.slice(1) : value).padStart(digits + 1, '0');
  const amount = digits ? padded.slice(0, -digits) + '.' + padded.slice(-digits) : padded;
  return `${currency!.toUpperCase()} ${negative ? '-' : ''}${amount}`;
}
