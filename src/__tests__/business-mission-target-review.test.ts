// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createGamePlanSnapshotAdapter } from '../../supabase/functions/_shared/paige-context/adapters/game-plan';
import { composeOperatingSnapshot, projectOperatingSnapshot, resolveSnapshotPeriod } from '../../supabase/functions/_shared/paige-context/snapshot';
import { readBusinessMetric } from '../../supabase/functions/_shared/analytics-metrics/read';
import { businessReviewRecordLinks } from '../../supabase/functions/_shared/paige-context/business-review-chat';
import { readRecordLinks } from '../../supabase/functions/_shared/paige-turn/record-links';
import { resolveCanonicalRecordLink } from '../../supabase/functions/_shared/canonical-app-url';
import { validateMissionTargetSnapshot, type MissionTargetSnapshot } from '../../supabase/functions/_shared/business-mission-targets/presentation';
import type { MissionTarget } from '../../supabase/functions/_shared/business-mission-targets/contract';
import type { MetricResult } from '../../supabase/functions/_shared/analytics-metrics/metric-contract';
const tenant = '11111111-1111-4111-8111-111111111111', mission = '33333333-3333-4333-8333-333333333333';
const now = Date.parse('2026-10-14T12:00:00Z');
const identity = { actorId: 'test-owner', tenantId: tenant, workspaceId: tenant, role: 'owner', actAsClientId: null, accountShape: 'solo' as const, scopeEpoch: tenant };
const resolved = resolveSnapshotPeriod({ key: 'last_7_days', now: new Date(now), timezone: 'UTC' });
if ('reason' in resolved) throw Error(resolved.reason);
const period = resolved.period;
const base: MissionTarget = { id: '22222222-2222-4222-8222-222222222222', tenant_id: tenant, mission_id: mission, title: 'Grow active clients', revision: 1, state: 'active',
  metric: { key: 'business.active_clients_current', version: '1.0.0', unit: 'count', value_kind: 'count', currency: null, dimensions: {}, range_key: 'month', semantics: 'current_snapshot', business_time_zone: null },
  period: { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z', time_zone: 'UTC' }, comparison: 'at_least', desired_value: '10', upper_value: null };
function harness() {
  const targets = [base, { ...base, id: '44444444-4444-4444-8444-444444444444', period: { ...base.period, start: '2026-10-02T00:00:00Z' } }];
  const review = { resolved_tenant_id: tenant, as_of: new Date(now).toISOString(), sample_limit: 6, has_more: false,
    mission_counts: { total: 1, active: 1, proposed: 0, paused: 0, blocked: 0, completed: 0, stopped: 0, without_targets: 0 },
    target_counts: { total: 2, active: 2, paused: 0, retired: 0 },
    targets: targets.map(target => ({ mission: { id: mission, title: 'Grow the business', revision: 3, state: 'active' }, target: { ...target, created_by: 'PRIVATE_ACTOR' } })) };
  const calls: string[] = []; let sequence = 0, active: MetricResult | null = null, workspace = tenant, denied = false, partial = false;
  const caller = { rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push(name);
    if (name === 'current_user_tenant_id') return { data: workspace, error: null };
    if (name === 'get_business_mission_review') return denied ? { data: null, error: { code: '42501' } } : { data: review, error: null };
    if (name === 'issue_analytics_evidence_bundle') {
      active = { metric_key: String(args?.p_metric_key), metric_version: '1.0.0', owner_department: 'client_experience', label: 'Active clients', definition: 'Current scoped active clients', formula: 'Count active clients',
        range: { key: String(args?.p_range_key), start: String(args?.p_range_start), end: String(args?.p_range_end), bounds: '[start,end)', timezone: 'UTC', semantics: 'current_snapshot' },
        dimensions: {}, values: { kind: 'count', count: 12 }, unit: 'count', source_refs: ['public.clients'], as_of: new Date(now).toISOString(),
        freshness: { queried_at: new Date(now).toISOString(), source_updated_through: null }, coverage: { state: partial ? 'partial' : 'complete', candidate_count: partial ? 14 : 12, contributing_count: 12, excluded_count: partial ? 2 : 0 },
        exclusions: partial ? [{ reason: 'Unknown records', count: 2 }] : [], truth_state: partial ? 'PARTIAL' : 'LIVE', caveats: partial ? ['Two records could not be included.'] : [],
        source_revision_ref: 'sr_v1_' + 'a'.repeat(64), account_epoch: tenant, account_epoch_ref: 'ae_v1_' + 'b'.repeat(64),
        evidence_ref: 'aneb_v1_' + String(++sequence).padStart(64, '0'), reference_expires_at: new Date(now + 900000).toISOString() } as MetricResult;
      return { data: active, error: null };
    }
    return args?.p_evidence_ref === active?.evidence_ref ? { data: active, error: null } : { data: null, error: { code: '42501' } };
  } };
  const adapter = createGamePlanSnapshotAdapter(caller, { tenantId: tenant }, () => now);
  const read = () => adapter.read({ identity, period, now: new Date(now) });
  const compose = () => composeOperatingSnapshot({ identity, period, domains: ['game_plan'], adapters: [adapter], now: new Date(now), currentScopeEpoch: () => workspace });
  return { caller, calls, review, read, compose, workspace: (value: string) => { workspace = value; }, deny: () => { denied = true; }, partial: () => { partial = true; } };
}
describe('one shared Game Plan review', () => {
  it('shares issued actuals across concurrent consumers without inventing epochs, zero or receipts', async () => {
    const h = harness();
    const [domain, metric] = await Promise.all([h.read(), readBusinessMetric(h.caller, { tenantId: tenant }, {
      metric_key: base.metric.key, period: 'custom', range_key: 'month', range_start: '2026-10-03T00:00:00Z', range_end: new Date(now).toISOString(),
    }, () => now)]);
    expect(metric.status).toBe('available'); expect(domain.status).toBe('available');
    expect(domain.data?.mission_targets?.map(row => row.observation)).toEqual([
      expect.objectContaining({ state: 'available', actual: '12', variance: '2', attainment: 'met' }),
      expect.objectContaining({ state: 'available', actual: '12', variance: '2', attainment: 'met' }),
    ]);
    expect(h.calls.filter(name => /analytics_evidence/.test(name))).toEqual(Array.from({ length: 3 }, () => ['issue_analytics_evidence_bundle', 'resolve_analytics_evidence_reference']).flat());
    expect(JSON.stringify(domain)).not.toContain('PRIVATE_ACTOR');
    const snapshot = await h.compose(), projection = projectOperatingSnapshot(snapshot);
    expect(snapshot.domains.game_plan.status).toBe('available');
    expect(projection).toContain('Actual "12"; variance "2"; attainment at target now');
    expect(projection).not.toContain(tenant); expect(projection).not.toContain('aneb_v1_');
    expect(projection).toContain('not execution proof');
  });
  it('retains a partial actual while withholding variance and attainment', async () => {
    const h = harness(); h.partial();
    const snapshot = await h.compose();
    expect(snapshot.domains.game_plan.data?.mission_targets?.[0].observation).toMatchObject({ state: 'partial', actual: '12', variance: null, attainment: 'unknown' });
    expect(projectOperatingSnapshot(snapshot)).toContain('variance unverified; attainment unverified');
  });
  it('persists semantic Play references and resolves them only in the current account', async () => {
    const snapshot = await harness().compose();
    const live = businessReviewRecordLinks(snapshot);
    const reloaded = readRecordLinks(JSON.parse(JSON.stringify(live)));
    expect(reloaded).toEqual([{ destination: 'executive', record_id: null }, { destination: 'business_game_plan', record_id: mission }]);
    expect(resolveCanonicalRecordLink({ actor: 'account', tier: 'solo', account: '42', destination: reloaded[1].destination, recordId: reloaded[1].record_id }))
      .toEqual({ path: `/solo/42/command-center/business-game-plan?play=${mission}`, status: 'exact' });
    expect(resolveCanonicalRecordLink({ actor: 'account', tier: 'solo', account: '43', destination: reloaded[1].destination, recordId: reloaded[1].record_id })?.path)
      .toBe(`/solo/43/command-center/business-game-plan?play=${mission}`);
  });
  it('keeps empty numeric targets separate from saved nonnumeric direction', async () => {
    const h = harness(); h.review.targets = []; h.review.target_counts = { total: 0, active: 0, paused: 0, retired: 0 }; h.review.mission_counts.without_targets = 1;
    const result = await h.read();
    expect(result.data?.headline.find(m => m.key === 'game_plan.plays')?.value).toBe(1);
    expect(result.data?.headline.find(m => m.key === 'game_plan.targets')?.value).toBe(0);
    expect(h.calls).not.toContain('issue_analytics_evidence_bundle');
  });
  it('refuses mismatched totals before reading or presenting target actuals', async () => {
    const h = harness(); h.review.target_counts.total = 1;
    expect(await h.read()).toMatchObject({ status: 'degraded', reason: 'mission_review_invalid', data: null });
    expect(h.calls).not.toContain('issue_analytics_evidence_bundle');
  });
  it('drops owner records after scope loss and refuses owner-only aggregates for denied callers', async () => {
    const switched = harness(); switched.workspace('foreign');
    expect((await switched.read()).data).toBeNull();
    const denied = harness(); denied.deny();
    expect(await denied.read()).toMatchObject({ status: 'degraded', reason: 'mission_owner_required', data: null });
    expect(denied.calls).toEqual(['get_business_mission_review']);
  });
  it('preserves the target definition but retires expired performance evidence at the browser boundary', async () => {
    const result = await harness().read(), row = result.data!.mission_targets![0];
    expect(validateMissionTargetSnapshot(row, tenant, now + 900000)).toMatchObject({ target: { desired_value: '10' }, observation: { state: 'unavailable', reason: 'evidence_unverified' } });
  });
  it.each(['foreign', 'producer_extra', 'negative_count', 'partial_attainment'])('rejects malformed %s nested target projections', async kind => {
    const row = structuredClone((await harness().read()).data!.mission_targets![0]) as MissionTargetSnapshot;
    if (kind === 'foreign') row.target.tenant_id = mission;
    if (kind === 'producer_extra') Object.assign(row.target.metric, { private_payload: 'NEVER_PROJECT' });
    if (row.observation.state === 'unavailable') throw Error('Expected issued fixture');
    if (kind === 'negative_count') row.observation.actual = '-1';
    if (kind === 'partial_attainment') row.observation.state = 'partial';
    expect(validateMissionTargetSnapshot(row, tenant, now)).toBeNull();
  });
});
