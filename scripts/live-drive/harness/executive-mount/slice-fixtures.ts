// DEVELOPMENT ONLY. Synthetic input for the real component/CSS, never an RPC or acceptance result.
import type { BusinessOperatingSnapshot, DomainSnapshot } from '../../../../supabase/functions/_shared/paige-context/snapshot';
import type { MissionTargetSnapshot } from '../../../../supabase/functions/_shared/business-mission-targets/presentation';

const now = Date.now();
export function withTargetAndFinanceFixtures(snapshot: BusinessOperatingSnapshot, state: string, includeFinance: boolean): BusinessOperatingSnapshot {
  const targets: MissionTargetSnapshot[] = state === 'empty' ? [] : [{
    mission: { id: '33333333-3333-4333-8333-333333333333', title: 'Grow the recurring service business', revision: 3, state: 'active' },
    target: { id: '22222222-2222-4222-8222-222222222222', tenant_id: snapshot.tenant_id, mission_id: '33333333-3333-4333-8333-333333333333', revision: 1, state: 'active', title: 'Active clients target',
      metric: { key: 'business.active_clients_current', version: '1.0.0', unit: 'count', value_kind: 'count', currency: null, dimensions: {}, range_key: 'month', semantics: 'current_snapshot', business_time_zone: null },
      period: { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z', time_zone: 'UTC' }, comparison: 'at_least', desired_value: '10', upper_value: null },
    observation: { state: 'partial', actual: '12', variance: null, attainment: 'unknown', period_complete: false, as_of: new Date(now).toISOString(), source_revision_ref: 'sr_v1_' + 'a'.repeat(64), reference_expires_at: new Date(now + 3600000).toISOString(), caveats: ['Synthetic partial coverage. Attainment remains unverified.'] },
  }];
  const domain = (key: 'game_plan' | 'finance', patch: Partial<DomainSnapshot>): DomainSnapshot => ({
    domain: key, owner: key === 'game_plan' ? 'business_missions' : 'finance', period: snapshot.period,
    as_of: new Date(now).toISOString(), coverage: 'partial', freshness: 'snapshot', headline: [], risks: [], changes: [], outcomes: [], upcoming: [], goal_links: [],
    sources: [{ system: 'synthetic fixture', adapter: 'development-only' }], ...patch,
  });
  const gamePlan = domain('game_plan', { mission_targets: targets, coverage_note: 'Synthetic target projection; no saved customer record or executed work.' });
  const finance = domain('finance', { finance_evidence: { tenant_id: snapshot.tenant_id, eligible_sources: state === 'empty' ? 0 : 1, sources: state === 'empty' ? [] : [{
    company_id: '30000000-0000-4000-8000-000000000001', company_label: 'Example Services — original company source label', company_version: 1,
    binding_id: '50000000-0000-4000-8000-000000000001', binding_revision: 2, provider: 'plaid', state: 'available', coverage: 'partial', pages_complete: false,
    snapshot_version: 3, source_observed_at: '2026-10-18T08:00:00Z', synchronized_at: '2026-10-18T08:02:00Z',
    observation_id: '60000000-0000-4000-8000-000000000001', receipt_run_id: '70000000-0000-4000-8000-000000000001', normalized_digest: 'a'.repeat(64),
    accounts_count: 1, accounts: [{ native_id: 'synthetic-account', label: 'Original operating account label', product: 'deposit', currency: 'USD', current_balance: '900719925474099312345.123456', available_cash: '0', available_credit: null, credit_limit: null }],
  }] } });
  return { ...snapshot, requested: [...snapshot.requested, 'game_plan', ...(includeFinance ? ['finance' as const] : [])],
    domains: { ...snapshot.domains, game_plan: { status: 'available', data: gamePlan }, ...(includeFinance ? { finance: { status: 'available' as const, data: finance } } : {}) } };
}
