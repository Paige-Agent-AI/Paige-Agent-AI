import { currentMetricVersion } from '../../analytics-metrics/metric-contract.ts';
import { readBusinessMetricEvidence, type MetricCaller } from '../../analytics-metrics/read.ts';
import { observeMissionTarget, validMissionTarget, type MissionTarget, type TargetObservation } from '../../business-mission-targets/contract.ts';
import { projectMissionTarget, type MissionTargetSnapshot } from '../../business-mission-targets/presentation.ts';
import { contextAvailable, contextDegraded, type ContextSourceResult } from '../mod.ts';
import type { DomainSnapshot, DomainSnapshotAdapter } from '../snapshot.ts';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const missionStates = ['proposed', 'active', 'blocked', 'paused', 'completed', 'stopped'];
const targetStates = ['active', 'paused', 'retired'];
const countShape = (value: unknown, states: string[], extra: string[] = []): value is Record<string, number> => object(value)
  && Object.keys(value).length === states.length + 1 + extra.length
  && ['total', ...states, ...extra].every(k => count(value[k]))
  && states.reduce((sum, state) => sum + Number(value[state]), 0) === value.total
  && extra.every(k => Number(value[k]) <= Number(value.total));
export const GAME_PLAN_ADAPTER_ID = 'game_plan.canonical_targets.v1';

/** Read-only projection of canonical Mission records and the one Analytics issuer. */
export function createGamePlanSnapshotAdapter(caller: MetricCaller, scope: { tenantId: string | null }, clock = Date.now): DomainSnapshotAdapter {
  return { domain: 'game_plan', owner: 'business_missions', async read(ctx): Promise<ContextSourceResult<DomainSnapshot>> {
    const gap = (reason: string) => contextDegraded<DomainSnapshot>(reason);
    if (!scope.tenantId || ctx.identity.tenantId !== scope.tenantId) return gap('mission_review_scope_mismatch');
    if (ctx.signal?.aborted) return gap('mission_review_aborted');
    try {
      const result = await caller.rpc('get_business_mission_review');
      if (result.error) return gap(['42501', '28000'].includes(result.error.code ?? '') ? 'mission_owner_required' : 'mission_review_unavailable');
      const data = result.data;
      if (!object(data) || data.resolved_tenant_id !== scope.tenantId || typeof data.as_of !== 'string' || !Number.isFinite(Date.parse(data.as_of))
        || !countShape(data.mission_counts, missionStates, ['without_targets']) || !countShape(data.target_counts, targetStates)
        || data.sample_limit !== 6 || !Array.isArray(data.targets) || data.targets.length !== Math.min(6, data.target_counts.total)
        || data.has_more !== (data.targets.length < data.target_counts.total)) return gap('mission_review_invalid');
      const targets: MissionTargetSnapshot[] = [];
      const seen = new Set<string>();
      for (const row of data.targets) {
        if (!object(row) || !object(row.mission) || !object(row.target) || !validMissionTarget(row.target as unknown as MissionTarget)
          || row.target.tenant_id !== scope.tenantId || row.mission.id !== row.target.mission_id
          || typeof row.mission.title !== 'string' || row.mission.title.trim().length < 3 || row.mission.title.length > 180
          || !Number.isSafeInteger(row.mission.revision) || Number(row.mission.revision) < 1 || !missionStates.includes(String(row.mission.state))
          || seen.has(String(row.target.id))) return gap('mission_review_invalid');
        seen.add(String(row.target.id));
        const target = projectMissionTarget(row.target as unknown as MissionTarget);
        targets.push({ mission: { id: target.mission_id, title: row.mission.title, revision: Number(row.mission.revision), state: row.mission.state as MissionTargetSnapshot['mission']['state'] },
          target, observation: { state: 'unavailable', reason: 'metric_unavailable' } });
      }
      const observe = async (row: MissionTargetSnapshot) => {
        const target = row.target;
        let observation: TargetObservation;
        if (target.state !== 'active') observation = { state: 'unavailable', reason: target.state === 'paused' ? 'target_paused' : 'target_retired' };
        else if (target.metric.version !== currentMetricVersion(target.metric.key)) observation = { state: 'unavailable', reason: 'metric_version_changed' };
        else if (Object.keys(target.metric.dimensions).length) observation = { state: 'unavailable', reason: 'binding_mismatch' };
        else {
          const end = Math.min(clock(), Date.parse(target.period.end));
          if (end <= Date.parse(target.period.start)) observation = { state: 'unavailable', reason: 'period_mismatch' };
          else {
            const evidence = await readBusinessMetricEvidence(caller, scope, { metric_key: target.metric.key, period: 'custom', range_key: target.metric.range_key,
              range_start: target.period.start, range_end: new Date(end).toISOString() }, clock);
            observation = evidence.status === 'available' ? observeMissionTarget(target, evidence.metric, evidence.request, clock())
              : { state: 'unavailable', reason: 'evidence_unverified' };
          }
        }
        row.observation = observation;
      };
      for (let start = 0; start < targets.length; start += 4) {
        if (ctx.signal?.aborted) return gap('mission_review_aborted');
        await Promise.all(targets.slice(start, start + 4).map(observe));
      }
      const current = await caller.rpc('current_user_tenant_id');
      if (current.error || current.data !== scope.tenantId || ctx.signal?.aborted) return gap('mission_review_scope_changed');
      const headlines: DomainSnapshot['headline'] = [
        { key: 'game_plan.plays', label: 'Saved Strategic Plays', value: data.mission_counts.total, unit: 'count', basis: 'point_in_time' },
        { key: 'game_plan.active_plays', label: 'Active Strategic Plays', value: data.mission_counts.active, unit: 'count', basis: 'point_in_time' },
        { key: 'game_plan.plays_without_targets', label: 'Plays without numeric targets', value: data.mission_counts.without_targets, unit: 'count', basis: 'point_in_time' },
        { key: 'game_plan.targets', label: 'Saved numeric targets', value: data.target_counts.total, unit: 'count', basis: 'point_in_time' },
        { key: 'game_plan.active_targets', label: 'Active numeric targets', value: data.target_counts.active, unit: 'count', basis: 'point_in_time' },
      ];
      const notes: string[] = [];
      if (data.has_more) notes.push(`Showing ${targets.length} of ${data.target_counts.total} targets; totals include all records.`);
      if (targets.some(t => t.observation.state !== 'available')) notes.push('Some sampled actuals are partial or unavailable; no attainment is inferred.');
      // Direction, lifecycle and measured attainment never assert execution or business causation.
      notes.push('Strategy quality and executed work are not measured here; saved Play states are not execution proof.');
      const risks: DomainSnapshot['risks'] = targets.flatMap(row => row.observation.state === 'available' && row.observation.attainment === 'not_met'
        ? [{ kind: 'target_variance', summary: `${row.target.title}: ${row.observation.period_complete ? 'outside its saved target' : 'outside its saved target so far'}.`, severity: 'watch' as const, reference: row.target.mission_id }] : []);
      return contextAvailable({ domain: 'game_plan', owner: 'business_missions', period: { ...ctx.period }, as_of: data.as_of,
        freshness: 'live_read', coverage: 'partial', coverage_note: notes.join(' '), headline: headlines,
        changes: [], outcomes: [], risks, upcoming: [], goal_links: [...new Set(targets.map(t => t.target.mission_id))].map(mission_id => ({ mission_id, relation: 'context' as const })),
        mission_targets: targets, sources: [{ system: 'business_missions', adapter: GAME_PLAN_ADAPTER_ID }, { system: 'analytics', adapter: 'analytics.metric_read' }] });
    } catch { return gap('mission_review_unavailable'); }
  } };
}
