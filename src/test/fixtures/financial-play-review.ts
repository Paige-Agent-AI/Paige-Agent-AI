// Controlled render inputs only. Never imported by a product entry point.
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from './business-review';
import type { MissionTargetSnapshot } from '../../../supabase/functions/_shared/business-mission-targets/presentation';
import type { BusinessOperatingSnapshot } from '../../../supabase/functions/_shared/paige-context/snapshot';

export function financialPlayTarget(): MissionTargetSnapshot {
  const now = Date.now();
  return {
    mission: { id: '33333333-3333-4333-8333-333333333333', title: 'Grow sustainable services', revision: 2, state: 'active' },
    target: { id: '22222222-2222-4222-8222-222222222222', tenant_id: TEST_REVIEW_TENANT,
      mission_id: '33333333-3333-4333-8333-333333333333', revision: 1, state: 'active', title: 'Synthetic recorded-receipts target',
      metric: { key: 'sales.cash.recorded_received', version: '1.0.0', unit: 'currency_minor', value_kind: 'currency_totals', currency: 'usd',
        dimensions: {}, range_key: 'month', semantics: 'event_timestamp_cohort', business_time_zone: null },
      period: { start: new Date(now - 86_400_000).toISOString(), end: new Date(now + 86_400_000).toISOString(), time_zone: 'UTC' },
      comparison: 'at_least', desired_value: '10000', upper_value: null },
    observation: { state: 'available', actual: '8000', variance: '-2000', attainment: 'not_met', period_complete: false,
      as_of: new Date(now).toISOString(), reference_expires_at: new Date(now + 60_000).toISOString(),
      source_revision_ref: 'sr_v1_' + 'a'.repeat(64), caveats: ['Synthetic fixture; recorded receipts are not bank deposits.'] },
  };
}

export function financialPlayReview(targets = [financialPlayTarget()]): BusinessOperatingSnapshot {
  const snapshot = structuredClone(TEST_BUSINESS_REVIEW);
  const base = snapshot.domains.operations!;
  if (base.status !== 'available') throw new Error('Synthetic domain fixture unavailable');
  return { ...snapshot, requested: ['game_plan'], domains: { game_plan: { status: 'available', data: { ...base.data, domain: 'game_plan', owner: 'business_missions',
    mission_targets: targets, headline: [], risks: [], coverage: 'partial',
    coverage_note: 'Synthetic review sample; additional saved targets may exist.',
    sources: [{ system: 'business_missions', adapter: 'synthetic-render-only' }] } } } };
}
