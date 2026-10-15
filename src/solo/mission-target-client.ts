import { currentMetricVersion, parseMetricResult, type MetricRequestIdentity, type MetricResult } from "@/lib/analytics/metric-contract";
import { observeMissionTarget, validMissionTarget, type MissionTarget, type TargetObservation } from "../../supabase/functions/_shared/business-mission-targets/contract";
import type { MissionTargetTool } from "../../supabase/functions/_shared/business-mission-targets/native";

type Reply = { data: unknown; error: unknown };
export interface TargetCaller {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<Reply>;
  functions: { invoke(name: string, options: { body: unknown }): PromiseLike<Reply> };
}
export interface TargetScope {
  actorId: string;
  tenantId: string;
  missionId: string;
  /** Retired permanently on unmount, actor/workspace changes or an A-B-A incarnation. */
  current(): boolean;
}
type ReadFailure = { kind: "scope_changed" | "refused" | "unavailable" };
export type TargetList = ReadFailure | { kind: "ready"; targets: MissionTarget[]; totalCount: number; hasMore: boolean };
export type TargetMutation =
  | { kind: "verified"; target: MissionTarget; receipt: { id: string; requestKey: string; revision: number; operation: string }; railRecorded: boolean }
  | { kind: "refused" | "uncertain" | "scope_changed"; mayHavePersisted: boolean; code: string };
export type TargetActual = ReadFailure | { kind: "ready"; metric: MetricResult; request: MetricRequestIdentity; observation: TargetObservation };
export type TargetMetricRead = ReadFailure | { kind: "ready"; metric: MetricResult; request: MetricRequestIdentity };
export type TargetVersion = { target: MissionTarget; reason: string; at: string;
  receipt: { id: string; requestKey: string; operation: "target_create" | "target_revise" | "target_transition" } | null };
export type TargetHistory = ReadFailure | { kind: "ready"; versions: TargetVersion[]; totalCount: number; hasMore: boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const safeCode = (v: unknown) => typeof v === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(v) ? v : "MISSION_TARGET_UNAVAILABLE";
const refusedError = (v: unknown) => object(v) && (v.code === "42501" || v.code === "28000" || /MISSION_(?:OWNER_REQUIRED|UNAUTHENTICATED)/.test(String(v.message)));
const same = (a: unknown, b: unknown): boolean => {
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => same(a[k], b[k]));
  return a === b;
};

async function scopeCheck(caller: TargetCaller, scope: TargetScope): Promise<"current" | "scope_changed" | "refused"> {
  if (!scope.current()) return "scope_changed";
  if (![scope.actorId, scope.tenantId, scope.missionId].every(uuid)) return "refused";
  const actor = await caller.auth.getUser();
  if (!scope.current()) return "scope_changed";
  if (actor.error || actor.data.user?.id !== scope.actorId) return "refused";
  const tenant = await caller.rpc("current_user_tenant_id", {});
  if (!scope.current()) return "scope_changed";
  return !tenant.error && tenant.data === scope.tenantId ? "current" : "refused";
}

/** Closed native projection of the existing domain record, never a second record model/store. */
function projectTarget(value: unknown, scope: TargetScope): MissionTarget | null {
  if (!object(value) || !validMissionTarget(value as unknown as MissionTarget)
    || value.tenant_id !== scope.tenantId || value.mission_id !== scope.missionId) return null;
  const t = value as unknown as MissionTarget;
  return { id: t.id, tenant_id: t.tenant_id, mission_id: t.mission_id, revision: t.revision, state: t.state, title: t.title,
    metric: { key: t.metric.key, version: t.metric.version, unit: t.metric.unit, value_kind: t.metric.value_kind, currency: t.metric.currency,
      dimensions: { ...t.metric.dimensions }, range_key: t.metric.range_key, semantics: t.metric.semantics, business_time_zone: t.metric.business_time_zone },
    period: { start: t.period.start, end: t.period.end, time_zone: t.period.time_zone }, comparison: t.comparison, desired_value: t.desired_value, upper_value: t.upper_value };
}

export async function readMissionTargets(caller: TargetCaller, scope: TargetScope, offset = 0): Promise<TargetList> {
  try {
    const initial = await scopeCheck(caller, scope);
    if (initial !== "current") return { kind: initial };
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return { kind: "unavailable" };
    const r = await caller.rpc("list_business_mission_targets", { p_mission_id: scope.missionId, p_limit: 40, p_offset: offset });
    const current = await scopeCheck(caller, scope);
    if (current !== "current") return { kind: current };
    if (r.error) return { kind: refusedError(r.error) ? "refused" : "unavailable" };
    if (!object(r.data) || r.data.resolved_tenant_id !== scope.tenantId || !Array.isArray(r.data.targets)
      || !Number.isSafeInteger(r.data.total_count) || Number(r.data.total_count) < r.data.targets.length
      || typeof r.data.has_more !== "boolean" || r.data.targets.length > 40) return { kind: "unavailable" };
    const targets = r.data.targets.map(t => projectTarget(t, scope));
    if (targets.some(t => !t) || new Set(targets.map(t => t?.id)).size !== targets.length
      || r.data.has_more !== (offset + targets.length < Number(r.data.total_count))) return { kind: "unavailable" };
    return { kind: "ready", targets: targets as MissionTarget[], totalCount: Number(r.data.total_count), hasMore: r.data.has_more };
  } catch { return { kind: scope.current() ? "unavailable" : "scope_changed" }; }
}

export async function readMissionTargetHistory(caller: TargetCaller, scope: TargetScope, targetId: string, offset = 0): Promise<TargetHistory> {
  try {
    const initial = await scopeCheck(caller, scope);
    if (initial !== "current") return { kind: initial };
    if (!uuid(targetId) || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return { kind: "unavailable" };
    // Verify this target belongs to the selected Play before reading any history.
    const selected = await caller.rpc("get_business_mission_target", { p_target_id: targetId });
    if (!scope.current()) return { kind: "scope_changed" };
    if (selected.error || !projectTarget(selected.data, scope)) return { kind: selected.error && refusedError(selected.error) ? "refused" : "unavailable" };
    const r = await caller.rpc("list_business_mission_target_versions", { p_target_id: targetId, p_limit: 20, p_offset: offset });
    const current = await scopeCheck(caller, scope);
    if (current !== "current") return { kind: current };
    if (r.error) return { kind: refusedError(r.error) ? "refused" : "unavailable" };
    if (!object(r.data) || r.data.resolved_tenant_id !== scope.tenantId || r.data.target_id !== targetId || !Array.isArray(r.data.versions)
      || r.data.versions.length > 20 || !Number.isSafeInteger(r.data.total_count) || Number(r.data.total_count) < r.data.versions.length
      || r.data.has_more !== (offset + r.data.versions.length < Number(r.data.total_count))) return { kind: "unavailable" };
    const versions: TargetVersion[] = [];
    for (const row of r.data.versions) {
      if (!object(row) || !object(row.definition) || typeof row.revision_reason !== "string" || row.revision_reason.length > 1200
        || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return { kind: "unavailable" };
      const target = projectTarget({ ...row.definition, id: targetId, tenant_id: scope.tenantId, mission_id: scope.missionId, revision: row.revision, state: row.state }, scope);
      if (!target || versions.some(v => v.target.revision === target.revision)
        || versions.length > 0 && versions[versions.length - 1].target.revision <= target.revision) return { kind: "unavailable" };
      let receipt: TargetVersion["receipt"] = null;
      if (row.receipt != null) {
        if (!object(row.receipt) || !uuid(row.receipt.id) || !uuid(row.receipt.request_key)
          || row.receipt.target_id !== targetId || row.receipt.mission_id !== scope.missionId
          || row.receipt.revision !== target.revision || row.receipt.state !== target.state
          || !["target_create", "target_revise", "target_transition"].includes(String(row.receipt.operation))) return { kind: "unavailable" };
        receipt = { id: row.receipt.id, requestKey: row.receipt.request_key, operation: row.receipt.operation as NonNullable<TargetVersion["receipt"]>["operation"] };
      }
      versions.push({ target, reason: row.revision_reason, at: row.created_at, receipt });
    }
    return { kind: "ready", versions, totalCount: Number(r.data.total_count), hasMore: r.data.has_more };
  } catch { return { kind: scope.current() ? "unavailable" : "scope_changed" }; }
}

function decodeMutation(value: unknown, scope: TargetScope, tool: MissionTargetTool, args: Record<string, unknown>): TargetMutation {
  const uncertain = (): TargetMutation => ({ kind: "uncertain", mayHavePersisted: true, code: "MISSION_TARGET_WRITE_OUTCOME_UNKNOWN" });
  if (!object(value)) return uncertain();
  if (value.success === false && value.verified === false && typeof value.code === "string") {
    return value.mutationMayHavePersisted === false
      ? { kind: "refused", mayHavePersisted: false, code: safeCode(value.code) } : uncertain();
  }
  if (value.success !== true || value.verified !== true || typeof value.railRecorded !== "boolean") return uncertain();
  const target = projectTarget(value.target, scope), receipt = value.receipt;
  const operation = tool === "mission_target_transition" ? "target_transition" : args.target_id == null ? "target_create" : "target_revise";
  if (!target || !object(receipt) || !uuid(receipt.id) || receipt.requestKey !== args.request_key
    || receipt.revision !== target.revision || receipt.operation !== operation
    || (args.target_id != null && target.id !== args.target_id)
    || target.revision !== (args.target_id == null ? 1 : Number(args.expected_target_revision) + 1)
    || (tool === "mission_target_transition" && target.state !== args.to_state)) return uncertain();
  if (tool === "mission_target_save") {
    if (!object(args.definition)) return uncertain();
    const expected = { ...args.definition, title: typeof args.definition.title === "string" ? args.definition.title.trim() : args.definition.title };
    if (!same(expected, { title: target.title, metric: target.metric, period: target.period, comparison: target.comparison,
      desired_value: target.desired_value, upper_value: target.upper_value })) return uncertain();
  }
  return { kind: "verified", target, receipt: { id: receipt.id, requestKey: String(receipt.requestKey), revision: target.revision, operation }, railRecorded: value.railRecorded };
}

/** Exact original args/request key only; the UI must retain them before invoking. No automatic retry. */
export async function mutateMissionTarget(caller: TargetCaller, scope: TargetScope, tool: MissionTargetTool, args: Record<string, unknown>): Promise<TargetMutation> {
  let sent = false;
  try {
    const initial = await scopeCheck(caller, scope);
    if (initial !== "current") return { kind: initial, mayHavePersisted: false, code: "MISSION_OWNER_REQUIRED" };
    if (args.mission_id !== scope.missionId || !uuid(args.request_key)) return { kind: "refused", mayHavePersisted: false, code: "MISSION_TARGET_ARGUMENTS_INVALID" };
    sent = true;
    const r = await caller.functions.invoke("business-mission-action", { body: { tool, args } });
    const current = await scopeCheck(caller, scope);
    if (current !== "current") return { kind: current === "refused" ? "scope_changed" : current, mayHavePersisted: true, code: "ACTIVE_ACCOUNT_CHANGED" };
    if (!r.error) return decodeMutation(r.data, scope, tool, args);
    let body: unknown;
    const context = object(r.error) && object(r.error.context) ? r.error.context : null;
    try { body = context && typeof context.json === "function" ? await context.json() : null; } catch { body = null; }
    if (!scope.current()) return { kind: "scope_changed", mayHavePersisted: true, code: "ACTIVE_ACCOUNT_CHANGED" };
    const prewrite = ["MISSION_UNAUTHENTICATED", "MISSION_TENANT_NOT_RESOLVED", "MISSION_ACTION_UNAVAILABLE", "MISSION_ACTION_INVALID", "BAD_JSON", "METHOD_NOT_ALLOWED"];
    if (object(body) && body.mutationMayHavePersisted !== true && prewrite.includes(String(body.code))) {
      return { kind: "refused", mayHavePersisted: false, code: safeCode(body.code) };
    }
    return decodeMutation(body, scope, tool, args);
  } catch {
    return { kind: scope.current() ? sent ? "uncertain" : "refused" : "scope_changed", mayHavePersisted: sent,
      code: sent ? "MISSION_TARGET_WRITE_OUTCOME_UNKNOWN" : "MISSION_OWNER_REQUIRED" };
  }
}

/** Shared native target read of the incumbent issuer/resolver, including definition selection. */
export async function readMissionTargetMetric(caller: TargetCaller, scope: TargetScope, query: {
  metricKey: string; rangeKey: MetricRequestIdentity["rangeKey"]; rangeStart: string; rangeEnd: string; dimensions?: Record<string, string>;
}, clock = Date.now): Promise<TargetMetricRead> {
  try {
    const initial = await scopeCheck(caller, scope);
    if (initial !== "current") return { kind: initial };
    const selected = await caller.rpc("get_business_mission", { p_mission_id: scope.missionId });
    if (!scope.current()) return { kind: "scope_changed" };
    if (selected.error) return { kind: refusedError(selected.error) ? "refused" : "unavailable" };
    if (!object(selected.data) || !object(selected.data.mission) || selected.data.mission.id !== scope.missionId) return { kind: "unavailable" };
    if (!Number.isFinite(Date.parse(query.rangeStart)) || !Number.isFinite(Date.parse(query.rangeEnd))
      || Date.parse(query.rangeEnd) > clock() || Date.parse(query.rangeStart) >= Date.parse(query.rangeEnd)) return { kind: "unavailable" };
    const request: MetricRequestIdentity = { ...query, metricVersion: currentMetricVersion(query.metricKey), accountEpoch: scope.tenantId, dimensions: query.dimensions ?? {} };
    const issued = await caller.rpc("issue_analytics_evidence_bundle", { p_metric_key: request.metricKey, p_metric_version: request.metricVersion,
      p_account_epoch: scope.tenantId, p_range_key: request.rangeKey, p_range_start: request.rangeStart, p_range_end: request.rangeEnd, p_dimensions: request.dimensions });
    if (!scope.current()) return { kind: "scope_changed" };
    if (issued.error) return { kind: refusedError(issued.error) ? "refused" : "unavailable" };
    const first = parseMetricResult(issued.data, request, clock());
    const resolved = await caller.rpc("resolve_analytics_evidence_reference", { p_evidence_ref: first.evidence_ref });
    const current = await scopeCheck(caller, scope);
    if (current !== "current") return { kind: current };
    if (resolved.error) return { kind: refusedError(resolved.error) ? "refused" : "unavailable" };
    const metric = parseMetricResult(resolved.data, request, clock());
    if (metric.evidence_ref !== first.evidence_ref || metric.source_revision_ref !== first.source_revision_ref || metric.as_of !== first.as_of) return { kind: "unavailable" };
    return { kind: "ready", metric, request };
  } catch { return { kind: scope.current() ? "unavailable" : "scope_changed" }; }
}

/** Target evaluation only. Metric production and authoritative values remain exclusively in Analytics. */
export async function readMissionTargetActual(caller: TargetCaller, scope: TargetScope, target: MissionTarget, clock = Date.now): Promise<TargetActual> {
  if (!scope.current()) return { kind: "scope_changed" };
  if (!projectTarget(target, scope) || target.metric.version !== currentMetricVersion(target.metric.key)) return { kind: "unavailable" };
  const result = await readMissionTargetMetric(caller, scope, { metricKey: target.metric.key, rangeKey: target.metric.range_key,
    rangeStart: target.period.start, rangeEnd: new Date(Math.min(clock(), Date.parse(target.period.end))).toISOString(), dimensions: target.metric.dimensions }, clock);
  return result.kind === "ready" ? { ...result, observation: observeMissionTarget(target, result.metric, result.request, clock()) } : result;
}
